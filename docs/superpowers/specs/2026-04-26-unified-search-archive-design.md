# Unified search archive — design v1.1 (simplest path)

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1), `docs/superpowers/specs/2026-04-26-chat-moderation-design.md` (v6)
**Driven by:** the V3 takedown analysis — bulk-replay-on-day-2 produced 2,234 templated bot messages in 24 hours, a textbook spam-ring fingerprint that Telegram's ML auto-classifies for takedown.

**Revision:** v1.1 collapses v1's `/search` design (which had tag/reviewer filters and replaced /recent) to the minimum viable shape: rename the existing `/profile` command to `/search`, expand its recent-entries section from 5 to 20 rows, and stop the replay script from publishing to the group. No new query functions, no new command parser, no new tests for argument forms.

## 1. Context

The legacy replay flow as it stands today is the takedown vector for fresh groups. V3's empirical data: 2,234 messages on day 2 (96.5% of the group's lifetime traffic), banned shortly after. QA (still alive) had organic 23-msgs/day average over 419 days and never hit the spam-fingerprint.

This spec eliminates the velocity surge by removing the publish step from replay. Legacy entries become DB-only archive, queryable via the existing `/profile @x` command (renamed to `/search @x` for accurate naming) which already does @username search. Members find any vouch in the archive via that command; new live vouches publish to the group as today (POS/MIX) or stay private (NEG per v1.1) and are also queryable via the same command.

## 2. Goals

1. **Replay never bulk-publishes to the group.** Legacy entries are imported to the DB and never produce a Telegram group post. Spam-ring fingerprint impossible.
2. **Members can find any vouch by @username via `/search`.** That's the rename of the existing `/profile` command — same handler, same DB query, same renderer, same group/DM availability.
3. **Privacy preserved.** Same filter discipline as `5a15cac`/`81421c6`: private NEGs and legacy NEGs excluded from member-visible search; admins see everything via `/lookup`.
4. **Smallest diff.** A rename, a constant change (5→20), one replay-script behaviour flip. No new commands, no new query functions, no new tests for command parsers.

## 3. Non-goals

- A separate `/search` command alongside `/profile`. The user explicitly chose rename, not addition.
- Tag-filter or reviewer-filter search. The user said "@username would be easiest" — drop the rest.
- Free-text body search. Legacy bodies aren't stored.
- Pagination across responses. Cap at 20 entries with "…and N more" tail (already supported by `withCeiling`).
- New tables, schema columns, or migrations.
- Backward-compat alias for `/profile`. Clean rename; old name removed.

## 4. Design

### 4.1. Replay = DB-only

`scripts/replayLegacyTelegramExport.ts` skips the publish step. Legacy entries inserted via `createArchiveEntry` get their status flipped directly to `published` with `publishedMessageId = null`, mirroring v1.1's private-NEG shape.

The discriminator that distinguishes legacy archive rows from private NEGs is `source`:

| Row shape | source | publishedMessageId | Meaning |
|---|---|---|---|
| Live POS/MIX | `live` | INT (real Telegram message id) | Visible in group + searchable |
| Live NEG (private, v1.1) | `live` | NULL | Audit-only |
| Legacy import (any result) | `legacy_import` | NULL | DB archive, queryable |

**Member-visible privacy filter** (applied uniformly across `/search`, `/recent`, `/profile`'s recent list — anywhere a member can read entries):

```sql
status = 'published'
AND result IN ('positive', 'mixed')   -- exclude all NEG (private + legacy NEG)
AND (
  published_message_id IS NOT NULL    -- live POS/MIX
  OR source = 'legacy_import'         -- legacy POS/MIX
)
```

`getRecentArchiveEntries` and `getProfileSummary.recent` (the two places enforcing the filter today) update to this predicate. `getArchiveEntriesForTarget` (admin /lookup) keeps showing everything.

### 4.2. Rename `/profile` → `/search`

Same handler (`handleProfileCommand` → renamed `handleSearchCommand`), same query (`getProfileSummary`), same renderer (`buildProfileText`), same group + DM availability, same admin-action audit logging.

Materially: every place the bot uses the string `/profile`, replace with `/search`. The DB function and renderer keep their names internally (no need to rename `getProfileSummary` since the DB-side concept of "profile of a user" is still accurate).

### 4.3. Expand recent entries from 5 to 20

`buildProfileText` currently shows the last 5 entries below the trust card. Constant change: 5 → 20.

`getProfileSummary.recent` query already uses `.limit(5)`. Bump to `.limit(20)`.

The `withCeiling` long-message guard already protects against overflow when total text exceeds 4096 chars. With ~50 chars per entry × 20 entries ≈ 1000 chars, we're well under.

### 4.4. Welcome / pinned guide and admin help

Strings change in `archive.ts`:
- "Type `/profile @username`" → "Type `/search @username`" in welcome and pinned guide
- `/admin_help` block lists `/search @x — entry totals` (was `/profile @x`)

V3-locked tests in `archiveUx.test.ts` update accordingly. This spec authorises the V3-lock drift.

### 4.5. Bot commands menu

`scripts/configureTelegramOnboarding.ts` registers the bot's command menu via `setMyCommands`. `/profile` is currently in that list; replace with `/search`.

### 4.6. Architecture summary

| Unit | Change | Why |
|---|---|---|
| `scripts/replayLegacyTelegramExport.ts` | Skip the publish call; insert+set-status directly | Eliminates day-1 velocity surge → kills V3's takedown vector |
| `src/core/archiveStore.ts` `getRecentArchiveEntries` | Update filter to the unified predicate (allow legacy entries) | Members can now see legacy POS/MIX in /recent |
| `src/core/archiveStore.ts` `getProfileSummary` (recent list) | Update filter same; bump `.limit(5)` to `.limit(20)` | Show more history when querying a user |
| `src/telegramBot.ts` | Rename `/profile` to `/search` in DM + group dispatchers | Simpler discovery name |
| `src/telegramBot.ts` `handleProfileCommand` | Rename to `handleSearchCommand` (internal cleanup) | Code-side consistency |
| `src/core/archive.ts` welcome / pinned / admin_help | Replace `/profile` references with `/search` | Member-facing copy |
| `src/core/archiveUx.test.ts` | Update V3-locked tests for new copy | Test infrastructure |
| `scripts/configureTelegramOnboarding.ts` | Update commands list registration | Bot's BotFather-side command menu |
| `docs/runbook/opsec.md` | Note replay-as-DB-only is the V3 takedown response | Documentation |
| `DEPLOY.md` | Mark §13 (legacy NEG cleanup) obsolete for fresh deployments | Documentation |
| `GO-LIVE.md` | Update smoke-test commands to use `/search` | Operator runbook |
| `CLAUDE.md` | Mention `/search` as the discovery command | Future-Claude reference |

**No new files. No new tables. No new migrations.** Pure rename + constant tweak + replay-script behaviour change.

## 5. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`. Existing tests update for the rename + 20-entry expansion. No new test files.
2. **End-to-end (manual, post-deploy):**
   - Replay a legacy export: confirm zero group posts appear; rows in DB have `source='legacy_import' AND publishedMessageId IS NULL`.
   - `/search @bobbiz` in DM: returns trust card + up to 20 entries (legacy POS/MIX and live POS/MIX mixed by date desc).
   - `/search @bobbiz` in group: same.
   - `/search` (no `@`) returns existing "Use: /search @username." prompt.
   - Submit a live NEG; not visible in `/search` results to members; visible to admin via `/lookup`.
   - `/recent` returns recent live + legacy POS/MIX (legacy entries now visible because of the filter update).
   - `/profile @x` does NOT exist (rejected as unknown command since the rename).
   - Admin's command menu in BotFather lists `/search`, not `/profile`.

## 6. Risks / accepted tradeoffs

- **`/profile` muscle-memory breaks for existing operators / members.** Welcome guide updates to instruct on `/search`. Operators see the change in the BotFather command menu after onboarding script runs.
- **Tag/reviewer search not available.** Per user direction. v2 if needed; not currently a use case.
- **Legacy entries don't have tags** (the import parser doesn't extract them). `/search @x` results show legacy entries with empty tag lists — this matches today's behaviour for legacy entries already.
- **DEPLOY.md §13 (legacy NEG cleanup) becomes obsolete for fresh deployments.** Documented as obsolete; not removed in case a partial-published deployment exists where some legacy NEGs slipped through to the group before this spec landed.
- **Members can no longer scroll the group feed and see legacy entries.** Replaced by `/search @x`. Aligned with v1.1's posture: trust info via query, not via feed scroll.

## 7. Out of scope (explicit)

- Free-text search.
- Date-range / tag / reviewer filters.
- Pagination beyond the 20-row cap.
- A separate `/search` command alongside `/profile` (this spec renames; it doesn't add).
- Backward-compat alias for `/profile`.

## 8. Direct response to V3 takedown analysis

V3's empirical fingerprint at takedown time: brand-new group + 2,234 templated bot messages on day 2 + minimal sender diversity = textbook spam-ring fingerprint. Telegram's ML auto-classified and banned without needing a single hostile report.

This spec eliminates the velocity surge by removing the publish step from replay. Legacy entries become DB-only archive. The takedown vector is closed at root, not mitigated by throttle or doc warnings.
