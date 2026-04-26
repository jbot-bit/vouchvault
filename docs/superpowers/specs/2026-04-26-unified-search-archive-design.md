# Unified search archive — design v1

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1), `docs/superpowers/specs/2026-04-26-chat-moderation-design.md` (v6)
**Driven by:** the actual takedown analysis of Suncoast V3 — bulk-replay-on-day-2 produced 2,234 templated bot messages in 24 hours, a textbook spam-ring fingerprint that Telegram's ML auto-classifies for takedown.

## 1. Context

The legacy replay flow as it stands today is the takedown vector for fresh groups:
- A new group is created with low historical content.
- Operator runs `npm run replay:legacy` to publish months of legacy vouches.
- The bot dumps thousands of templated `<b>POS Vouch &gt; @target</b>` messages into the group within hours.
- Telegram's ML reads: brand-new group + extreme content velocity + 99%+ same-sender + identical-template-repeated → spam-ring → ban.

V3's empirical data: 2,234 messages on day 2, 96.5% of the group's lifetime traffic. Banned shortly after. QA (still alive) had organic 23-msgs/day average over 419 days and never hit the spam-fingerprint.

**The fix is to stop bulk-publishing legacy entries to the group entirely.** Members access the legacy archive via a new `/search` discovery command that queries the unified DB. New live vouches publish to the group as today (POS/MIX) or stay private (NEG per v1.1) and are also queryable via `/search`. The legacy/live distinction disappears at the query layer — there's just "the archive."

## 2. Goals

1. **Replay never bulk-publishes to the group.** Legacy entries are imported to the DB and never produce a Telegram group post. Spam-ring fingerprint impossible.
2. **Members can find any vouch in the archive** via `/search` — by target, by tag, by reviewer.
3. **Privacy preserved.** Same filter discipline as `/recent` / `/profile` (post-`5a15cac`/`81421c6`): private NEGs and legacy NEGs are excluded from member-visible search; admins see everything via `/lookup`.
4. **Smallest diff that gets there.** One new command, three new query functions, one replay-script flag flip. No new tables, no new schema columns.

## 3. Non-goals

- Free-text body search. Legacy bodies aren't stored in the DB (only structured fields); live posts have no body either. Search is on structured fields only.
- Admin filter additions (`/search frozen:true`, `/search since:date`). v2 if they prove needed.
- Date-range filtering. v2.
- Result-type filtering (`/search result:positive`). The default privacy filter excludes NEG anyway, so positive/mixed-only is the only member-visible state. v2 if needed.
- Pagination across responses. Cap results at 20 per query with a `…and N more. Refine your search.` footer.
- A `/by_reviewer` standalone command — folded into `/search by:@x`.
- Separate replay command for "DB-only mode" — replay just changes its default behaviour.

## 4. Design

### 4.1. Replay = DB-only

`scripts/replayLegacyTelegramExport.ts` is the only entry point that publishes legacy entries today. Change behaviour: it inserts entries into `vouch_entries` and **does not call `publishArchiveEntryRecord`**.

Legacy rows get:
- `status = 'published'` (so the existing query-time filters still find them)
- `publishedMessageId = NULL` (no group post exists)
- `source = 'legacy_import'` (already set today; this is the discriminator we use in queries)
- `legacy_source_message_id` (already set today; preserves replay idempotency)

This DB shape collides with the v1.1 private-NEG shape (`status='published' AND publishedMessageId IS NULL`). The discriminator that distinguishes them is `source`:

| Row shape | source | publishedMessageId | Meaning |
|---|---|---|---|
| Live POS/MIX | `live` | INT (real Telegram message id) | Visible in group + searchable |
| Live NEG (private, v1.1) | `live` | NULL | Audit-only, not in group, not searchable for members |
| Legacy import (any result) | `legacy_import` | NULL | DB archive, queryable via /search (POS/MIX) or /lookup (admin sees NEG) |

### 4.2. Query layer — three new functions

Add to `src/core/archiveStore.ts`:

```ts
export async function searchEntriesByTarget(targetUsername: string, limit: number)
export async function searchEntriesByTag(tag: EntryTag, limit: number)
export async function searchEntriesByReviewer(reviewerUsername: string, limit: number)
```

All three apply the same **member-visible privacy filter**:

```sql
status = 'published'
AND result IN ('positive', 'mixed')   -- exclude all NEG (private + legacy NEG)
AND (
  published_message_id IS NOT NULL    -- live POS/MIX
  OR source = 'legacy_import'         -- legacy POS/MIX
)
```

Each query orders by `created_at DESC, id DESC` and limits to `limit`.

`getRecentArchiveEntries(limit)` already exists; **its filter is updated** to match the new predicate (drop the bare `publishedMessageId IS NOT NULL` from `5a15cac` and add the `result != 'negative'` clause + `source = 'legacy_import'` exception). After the change, `/recent` and `/search` see the same data.

### 4.3. `/search` command — single discovery surface

Member-callable in both group and DM contexts. Argument parser:

| Invocation | Behaviour |
|---|---|
| `/search` | recent 20 entries from unified archive, ordered by date desc |
| `/search @username` | entries where `@username` is the target (≤20) |
| `/search tag:good_comms` | entries with `good_comms` in `selectedTags` (≤20) |
| `/search by:@reviewer` | entries written by `@reviewer` (≤20) |
| `/search help` or `/search ?` | help text describing the four forms above |

Argument parser lives in `src/core/searchQuery.ts` (new pure module, DB-free) so it can be unit-tested in isolation. It returns a discriminated union:

```ts
export type SearchQuery =
  | { kind: "recent" }
  | { kind: "by_target"; targetUsername: string }
  | { kind: "by_tag"; tag: EntryTag }
  | { kind: "by_reviewer"; reviewerUsername: string }
  | { kind: "help" }
  | { kind: "invalid"; reason: string };
```

The handler in `telegramBot.ts` calls the parser, dispatches to the appropriate `archiveStore` query, and renders via existing `buildRecentEntriesText` (with a small extension for filter-context heading text — e.g. "Recent entries for tag: Good Comms").

### 4.4. `/recent` becomes an alias

`/recent` is kept as a one-line alias for `/search` (no args). The welcome / pinned guide updates to mention `/search` as the primary command, with `/recent` mentioned as the same thing for muscle-memory.

Operationally identical for members; renaming is purely about the bot's documented surface centring on a single discovery command.

### 4.5. `/profile @x` is unchanged

`/profile @x` still gives the structured trust card (counts, status, last 5 entries). It's a thin wrapper specialised for one target. `/search @x` returns the same data with up to 20 entries instead of 5 — useful when members want more history.

### 4.6. Legacy NEG handling

Legacy NEG entries (imported with `result='negative'`, `source='legacy_import'`) are **not visible in `/search`** because the predicate excludes `result='negative'`. They surface only via `/lookup @x` (admin-only).

This matches v1.1's vendetta-resistant posture: members never see NEG entries (legacy or live) in any feed-shaped surface; admins see them via the audit command.

### 4.7. Privacy filter unification

After this change, every member-callable read path uses the same predicate. Defence-in-depth:

| Surface | Function | Predicate |
|---|---|---|
| `/search` (no args) and `/recent` | `getRecentArchiveEntries` | full predicate |
| `/search @x` | `searchEntriesByTarget` | full predicate + target match |
| `/search tag:X` | `searchEntriesByTag` | full predicate + tag match |
| `/search by:@y` | `searchEntriesByReviewer` | full predicate + reviewer match |
| `/profile @x` (recent list) | `getProfileSummary.recent` | full predicate + target match |
| `/profile @x` (counts) | `getProfileSummary.counts` | counts ALL NEG too (drives Caution) |
| `/lookup @x` (admin) | `getArchiveEntriesForTarget` | no privacy filter; admin-only |

The single full predicate is the only place to change moderation behaviour going forward.

### 4.8. Tag/reviewer query implementation

`selectedTags` is stored as `TEXT` (a JSON-serialised array). The tag-filter query uses `LIKE '%"<tag>"%'` against the column — fast enough for the project's scale (~thousands of rows, not millions). Tag value is validated via `isEntryTag` before reaching the query, so SQL-injection risk is zero (only enum values pass through).

Reviewer query is a straight `eq(reviewerUsername, …)` after `normalizeUsername`.

## 5. Architecture

| Unit | Purpose | New / modified |
|---|---|---|
| `src/core/searchQuery.ts` | Parse `/search` args into a `SearchQuery` discriminated union | **Create** |
| `src/core/searchQuery.test.ts` | Parser unit tests | **Create** |
| `src/core/archiveStore.ts` | Add `searchEntriesByTarget`, `searchEntriesByTag`, `searchEntriesByReviewer`. Update `getRecentArchiveEntries` predicate. Update `getArchiveEntriesForTarget` to accept the same predicate option (for /search @x re-use). | Modify |
| `src/telegramBot.ts` | Wire `/search` command in DM and group dispatchers. Alias `/recent` to `/search` no-args. | Modify |
| `src/core/archive.ts` | `buildRecentEntriesText` accepts an optional heading override (e.g. "Recent entries for tag: Good Comms") | Modify |
| `scripts/replayLegacyTelegramExport.ts` | Skip the publish step entirely. Legacy entries get inserted via `createArchiveEntry`, then `setArchiveEntryStatus(id, "published")` is called directly to flip the row to published-with-null-message-id. | Modify |
| `src/core/archive.ts` welcome / pinned guide | Mention `/search` as the primary discovery command; `/recent` listed as alias | Modify (V3-locked tests update with this commit) |
| `docs/runbook/opsec.md` | Add §6c describing the unified archive + replay-as-DB-only fix as the response to the V3 takedown vector. Update §5 (SQL→export-JSON DR recipe) to clarify the recipe is now DB-only-replay-compatible. | Modify |
| `DEPLOY.md` | Step 13 (legacy NEG cleanup) becomes obsolete — note this. New replay-procedure callout. | Modify |

**No new tables. No new schema columns. No new admin commands.** One new pure module (search-query parser) + three new query functions + one replay-script behaviour change.

## 6. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`.
   - `src/core/searchQuery.test.ts` — argument parser: `/search`, `/search @x`, `/search tag:Y`, `/search by:@z`, `/search ?`, malformed inputs.
   - Update `src/core/archiveUx.test.ts` — V3-locked welcome / pinned tests for new copy.
   - Add a small test in `src/core/profileCaution.test.ts` (or new file) confirming `searchEntriesByTarget` excludes private NEGs (using mock data shapes).
2. **End-to-end (manual, post-deploy):**
   - Replay a legacy export: confirm zero group posts appear; rows in DB have `source='legacy_import' AND publishedMessageId IS NULL`.
   - Submit a live POS vouch: appears in group as today; queryable via `/search @target`.
   - Submit a live NEG vouch: no group post; queryable via `/lookup @target` (admin); not in `/search` results.
   - `/search` (no args) shows recent live + legacy POS/MIX, ordered by date desc.
   - `/search @bobbiz` shows entries for that target, mix of legacy and live, NEGs excluded.
   - `/search tag:good_comms` shows entries with that tag.
   - `/search by:@alice` shows entries written by @alice.
   - `/search invalid_input` returns help text.
   - `/recent` returns same as `/search` (no args).
   - Member's `/lookup @x` is rejected (admin-only); admin's `/lookup @x` shows full audit list including NEGs and legacy NEGs.

## 7. Risks / accepted tradeoffs

- **Members lose the "scroll back through old vouches" UX.** Replaced by `/search`. Legitimate trust info is queryable; passive scrolling isn't. Aligned with v1.1's posture: trust info via query, not via feed scroll.
- **Tag query uses `LIKE` against a JSON-serialised text column.** O(n) scan in the worst case. At project scale (thousands of rows), this is sub-millisecond. If volume ever exceeds 100k rows, migrate `selectedTags` to `jsonb` with a GIN index.
- **`/search` adds one more command for members to learn.** Mitigated by `/recent` aliasing and the welcome/pinned guide centring on `/search`.
- **Legacy entries don't have tags** (the import parser doesn't extract them). `/search tag:X` will only return live entries (which have tags). Acceptable — legacy entries were originally free-text bodies; the structured tag information didn't exist in the source data.
- **DEPLOY.md §13 (legacy NEG cleanup) becomes obsolete** — replay no longer publishes anything, so there are no legacy public NEG posts to clean up. The §13 procedure becomes a no-op for fresh deployments. Documented as obsolete; not removed in case a partial-published deployment exists.

## 8. Out of scope (explicit)

- Free-text search (legacy bodies aren't stored).
- Date-range filters (v2 if needed).
- Pagination across responses (cap at 20).
- Reviewer-stats command (`/who_vouches` etc.).
- A separate "import" command — replay continues to use the existing `replayLegacyTelegramExport.ts`.
- Re-publishing legacy entries to the group on demand. The whole point is they don't publish.
- Migration of existing already-replayed legacy data. If the host group already has legacy public posts from a prior replay, those posts stay where they are; only new replays go DB-only. Operators can `/remove_entry` historical posts manually if desired (the existing DEPLOY §13 procedure).

## 9. Forward compatibility

This spec deliberately doesn't address:
- Multi-group archive scoping (treat all chats as one archive for now).
- Search across multiple groups (not relevant until multi-group future spec lands).
- Admin-only filters on `/search` (`/search frozen:true`, etc.).

When the multi-group future ships (sales group + chat group), the unified archive query layer is unchanged — additional groups don't add complexity to the query side. Replay behaviour is per-group at replay time; archive lives in shared DB.

## 10. Direct response to V3 takedown analysis

The empirical analysis (`Queensland Vouches` vs `Queensland Approved` data + Suncoast V3 day-2 surge) showed:
- Vocabulary alone doesn't differentiate banned vs alive groups.
- The discriminating signal for V3 was **content velocity + member velocity + templated-content + sender concentration on day 1-2**.
- The replay script created the velocity surge by publishing 2,234 messages in 24 hours.

This spec eliminates the velocity surge by removing the publish step from replay. Legacy entries become DB-only archive, queryable via `/search`, never visible to Telegram's classifier as bot-templated bulk content. The takedown vector is closed at its root rather than mitigated by throttle.
