# Inline vouch cards — design

**Date:** 2026-05-01
**Status:** spec, pre-implementation
**Supersedes part of:** v9 spec (`2026-04-27-vouchvault-v9-simplification-design.md`) §read-paths only — adds an in-group + cross-chat read surface; member-posted free-text vouches stay the canonical write path.

---

## 1. Goal

Give SC45 members a **searchable, in-group, low-friction** way to look up a user's vouch history without recreating V3's bulk-templated bot-publish vector.

Achieved by stacking two surfaces:

1. **Inline mode** (`@VouchVaultBot @target` in any chat) — Telegram-native, member-attributed, bot publishes zero group messages.
2. **In-group `/lookup @target`** — fallback for clients without inline UX, replies in the group thread.

Both render the **same vouch card** shape, sourced from the legacy V3 archive in the DB.

---

## 2. Non-goals

- No new write path. Members continue to post vouches as plain group messages (v9 architecture). The card is read-only.
- No bulk-publish, no scheduled summaries, no announcements. Bot publishes *only* in response to a member action (slash command, inline query).
- No HMAC / cryptographic signing on the card body — Telegram's `via_bot` field is already cryptographically enforced server-side and is sufficient.
- No federation / cross-group sync. Cards are rendered from the SC45-resident DB only.

---

## 3. Threat model

### V3 lesson (recap)
V3 was killed by **2,234 bot-authored, structurally-identical, templated messages in 24h** (`POS Vouch > @target`). Classifier signals: volume + structural repetition.

### What this spec defends against

| # | Threat | Defense |
|---|---|---|
| T1 | Forge a card from blank text | Detector: regex match on card shape + `via_bot.id !== OUR_BOT_ID` → delete + audit + DM warn. |
| T2 | Edit a real card after inline insertion | `edited_message` watcher: if `via_bot.id == OUR_BOT_ID` and content changed → delete + audit + DM warn. |
| T3 | Lookalike-bot impersonation (e.g. `@VouchVau1tBot`) | Detector compares `via_bot.id` (numeric) not username; lookalike has different id → fails check. |
| T4 | Compromised intake (write fake vouch into DB then render real card) | Out of scope here — defended by the v9 architecture (no write path; legacy DB is read-only). Re-evaluate if a `/vouch` write command is ever added. |
| T5 | Forwarded forgery (fake card forwarded into SC45 from elsewhere) | Same detector applies — forwarded messages preserve their `via_bot` field; if missing or non-ours, deleted. |
| T6 | Reply / quote-reply with manipulated quote | Reply message itself is checked independently; quoted block is informational only. |
| T7 | Volume-based classifier flag | Per-user rate limit on inline + slash-command lookups (reuse `lookupRateLimit.ts`); inline cache_time=0 to keep responses fresh; total volume bounded by member curiosity (TBC-comparable: ~50–100/day in active groups, vs V3's 2,234). |
| T8 | Telegram backend compromise | Out of scope (not our threat model). |

### What this spec does NOT defend against

- **Off-group screenshots and copy-paste images.** Cards rendered as PNGs/screenshots in other Telegrams or off-platform are out of our reach. Public guidance ("real cards say `via @VouchVaultBot`") is the only mitigation.
- **Inline cards generated for legitimate but disputed targets.** "Was that vouch fair?" is a moderation question, not a forgery question.
- **Privacy attacks on look-ups themselves.** Member querying `@VouchVaultBot @sarah` exposes that they looked sarah up. Same surface as DM `/lookup` — already in v9 threat model. Privacy policy URL (Phase 3 compliance gap) closes the loop documentation-wise.

---

## 4. Card shape

```
📋 @<target> — <pos_count> ✅ · <neg_count_or_mix> ⚠️ (<total> over <span>)

· <dd/mm/yyyy> @<reviewer1> — "<excerpt>" ✅
· <dd/mm/yyyy> @<reviewer2> — "<excerpt>" ⚠️
· <dd/mm/yyyy> @<reviewer3> — "<excerpt>" ✅

<footer_phrase>
```

### Constraints
- **Length:** ≤ 800 chars (Telegram inline result body) and ≤ 3900 chars hard cap (reuse `withCeiling` helper). Long histories truncate to 3 most-recent excerpts; footer says `…N more — DM /lookup @<target> for full audit`.
- **Glyphs:** `📋`, `—` (em-dash, U+2014), `·` (middot, U+00B7), `✅`, `⚠️`. **Strict regex match on these exact characters** in the detector — sloppy forgers using `-` or `*` fail to trigger our detector AND fail to look authentic.
- **Member view vs admin view:** identical for inline (members can't trigger admin view in-chat). Full admin audit (private NEGs + `private_note`) stays DM-only via `/lookup`.

### Footer rotation
To reduce structural repetition, the footer line rotates across a small pool (deterministic, seeded by `(target_id, current_day_bucket)` so the same query in the same day returns the same card — Telegram caches inline results regardless, see §6.4):

- `_via @VouchVaultBot · DM /lookup for full audit_`
- `_full audit: DM the bot · /lookup @<target>_`
- `_more in DM — /lookup @<target>_`
- `_via @VouchVaultBot_`

This is cosmetic; the `via_bot` field is the actual unforgeability primitive.

---

## 5. Architecture

### 5.1 New code surface

| File | Responsibility |
|---|---|
| `src/core/inlineCard.ts` | Pure renderer: `(targetUsername, archiveRows) → cardText`. Glyph constants, footer pool, length capping via `withCeiling`. Test-friendly. |
| `src/core/inlineQueryHandler.ts` | Handles `inline_query` updates from Telegram. Parses query, runs archive lookup, calls `inlineCard.render`, calls `answerInlineQuery` via telegramTools. Rate-limits via `lookupRateLimit`. |
| `src/core/forgeryDetector.ts` | Pure helper: `(message) → { isForgery, kind, reason }`. Kinds: `forge_from_blank`, `edit_of_real_card`, `lookalike_bot`. |
| `src/core/forgeryEnforcement.ts` | Orchestration: receives detector verdict, deletes, DMs warn, audit-logs, escalates to freeze on N-strikes-in-7d. |
| `src/core/tools/telegramTools.ts` | **Add** `answerInlineQuery`, `getMyName` (boot-time bot id capture). Both routed through `callTelegramAPI`. |

### 5.2 Touched code

| File | Change |
|---|---|
| `src/telegramBot.ts` | (a) Add `inline_query` branch in `processTelegramUpdate`, gated by member-registry + chat_type check. (b) Add `chat_member` handler that upserts/removes from `sc45_members` registry. (c) Add forgery-detector hook into `handleGroupMessage` (after lexicon mod, before mirror) and into the `edited_message` branch. (d) Open `/lookup @user` to in-group execution (today: DM-only for members). |
| `src/server.ts` | Add `inline_query` and `chosen_inline_result` to the webhook race-handling pathway (already passes through `processTelegramUpdate`, just needs the branch). |
| `scripts/setTelegramWebhook.ts` | Add `inline_query` and `chosen_inline_result` to `allowed_updates`. |
| `src/core/lookupRateLimit.ts` | Add `recordInlineLookup` / `checkInlineLookup` using same token bucket; consider separate bucket key namespace (`inline:` prefix) so inline + DM lookups don't share quota. |

### 5.3 New DB

Migration `0015_inline_cards.sql`:

```sql
CREATE TABLE forgery_strikes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  kind TEXT NOT NULL,        -- 'forge_from_blank' | 'edit_of_real_card' | 'lookalike_bot'
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX forgery_strikes_user_recent ON forgery_strikes (user_id, detected_at DESC);

CREATE TABLE sc45_members (
  user_id BIGINT PRIMARY KEY,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_status TEXT NOT NULL,    -- 'member' | 'administrator' | 'creator' | 'restricted'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mirror_log ADD COLUMN via_bot_id BIGINT;  -- for §6.12 historical purge
```

Used for:
- N-strikes-in-7d freeze escalation.
- Admin `/forgeries` command (paginated recent-forgery audit).

The `admin_audit_log` already records every delete/freeze/DM — `forgery_strikes` is the user-keyed denormalisation for fast strike-count queries.

### 5.4 Bot-id discovery

Detector compares `via_bot.id` numerically. We need our bot's id at boot:

- Add `getMyName()` call in `server.ts` boot path (next to `logBotAdminStatusForChats`).
- Cache in module-scope `OUR_BOT_ID: number`.
- Persist to env hint `TELEGRAM_BOT_ID=` (optional) for fast boot when getMe is rate-limited.

### 5.5 Inline mode capabilities

`@BotFather → /setinline` → enable. Set placeholder: `username to look up`.
`@BotFather → /setinlinefeedback` → enabled for `chosen_inline_result` updates (lets us track which cards actually got inserted, vs just previewed — useful for abuse detection).

---

## 6. Edge cases & nuances

### 6.1 Card for non-existent / unknown user
Inline returns a single non-insertable hint result: "No record for @target" with `input_message_content` set to a polite "no record" line. Member can still insert it if they want, but the card structure is different (no counts/excerpts) so the detector's strict regex doesn't trigger.

### 6.2 Empty query (`@VouchVaultBot ` with nothing after)
Return one hint result: "Type a username, e.g. `@daveyboi`". Not insertable.

### 6.3 Query without `@` prefix
Strip `@` if present, otherwise treat the raw token as the username. Lower-case + trim before DB lookup.

### 6.4 Telegram inline cache
`answerInlineQuery({ cache_time: 0 })`. Rationale: legacy data is mostly static (V3 import is read-only), but we want fresh counts the day a new vouch lands in SC45. Cache cost is negligible since archive rows are indexed.

Document tradeoff: every inline keystroke from a member hits our bot. With the rate limiter (per-user 1/5s) total volume stays low.

### 6.5 Inline scope — SC45 members only

Telegram inline mode is API-global by default, but we restrict via server-side gating on `answerInlineQuery`:

1. **Member gate on `from.id`:** maintain a `sc45_members` registry (populated from `chat_member` updates we already subscribe to; seeded by a one-shot `getChatAdministrators` + member-walk at deploy). Inline queries from `from.id ∉ registry` get a single non-insertable hint result: "Inline lookups are SC45-only. DM the bot to /lookup." Non-members can't insert any card.

2. **`chat_type` filter:** only respond to `chat_type ∈ {sender, supergroup}`. Skip `private` (third-party DMs), `group` (basic groups — SC45 is supergroup), and `channel` entirely. `sender` means the user is querying in the bot's own DM (allowed for self-testing).

3. **Residual API limitation (documented, accepted):** Telegram's `inline_query` payload does not include the destination `chat_id`. So a SC45 member typing `@VouchVaultBot @target` in *another* supergroup they happen to be in will still get results. We can't tell which supergroup. Mitigations:
   - The forgery detector covers SC45 only (the only place we read messages). Cards leaked into other groups are visually authentic (`via_bot=ours`) — they're not forgeries, just disclosure leaks.
   - This is the same residual surface as a member screenshotting a card and sharing it. Off-platform reach is out of scope.
   - If this becomes a real abuse pattern, future hardening could add a `chosen_inline_result` audit log + `inline_message_id` reachback for non-text result types — deferred until needed.

4. **Member-registry maintenance:**
   - On `chat_member` update with `new_chat_member.status ∈ {member, administrator, creator, restricted}` for an SC45 chat → upsert into registry.
   - On `chat_member` update with `new_chat_member.status ∈ {left, kicked}` → remove.
   - Migration `0015` adds `sc45_members` table: `(user_id BIGINT PRIMARY KEY, joined_at TIMESTAMPTZ NOT NULL, last_seen_status TEXT NOT NULL)`.
   - Boot-time backfill: `npm run sc45:backfill-members` calls `getChatAdministrators` (admins only — Telegram doesn't expose a full member-list API). Regular members are auto-registered the first time they post in SC45 (cheap upsert in `handleGroupMessage`, before mirror). Combination of admin-seed + first-post-auto-add + ongoing `chat_member` events covers every active member within their first message.
   - **Seeding gap (documented, accepted):** a member who joined SC45 before the registry shipped AND who never posts AND never generates a `chat_member` event remains absent from the registry until they do one of the above. They'll see "DM the bot to /lookup" instead of inline results — graceful degradation, not a break. The `/lookup` DM path is unaffected.

### 6.6 Forwarded real cards
A forwarded real card preserves `via_bot.id == OUR_BOT_ID`. We allow forwards. The detector ignores messages where `forward_origin` is set AND `via_bot.id == OUR_BOT_ID` — that's a legitimate forward of our content.

### 6.7 Forwarded forgery
Forwarded forgery has `via_bot` empty (or set to the forger's bot). Detector kills it on entry to SC45.

### 6.8 Card edit attack — content unchanged
Telegram fires `edited_message` even for trivial edits (typo fix). To avoid false positives on non-content edits (e.g., user adds a reaction emoji at the end), we hash the canonical card body at insertion time (via `chosen_inline_result`) and compare on edit. **No-op edits skip enforcement**; content edits trigger delete.

Deferred until v2 if `chosen_inline_result` storage proves too noisy. v1: any edit → delete, no FP analysis. (Per user direction: "they won't edit much.")

### 6.9 Slow mode / group permission interactions
SC45 has slow mode 30s. Inline-mode `via @bot` insertions are subject to slow mode like any other message. Members blocked by slow mode just wait — no special handling needed.

If group-level "Send via inline bots" permission is OFF, inline insertion silently fails for the member. Documented in `DEPLOY.md` post-merge: ensure SC45 member permissions allow inline bots.

### 6.10 Inline rate limit: per-user vs per-chat
Per-user (Telegram `from.id`). A spammer can't fire 100 lookups even by switching chats. Bucket: 1 query / 5s, burst 3.

### 6.11 Card content hash
For the edit-attack defense in §6.8 and for `forgery_strikes.content_hash`, hash spec:
```
hash = sha256(card_body_normalised).slice(0, 16)
```
Where `card_body_normalised` strips the rotating footer and any zero-width chars Telegram might add. 16 hex chars = 64 bits, plenty for collision-free per-day-per-user buckets.

### 6.12 Bulk historical purge
One-shot admin command `/purge_forgeries` scans `mirror_log` for messages matching the card-shape regex with no `via_bot=ours` (we'd need to capture `via_bot` in the mirror — small migration to add `via_bot_id BIGINT` column to `mirror_log`). Deletes from group + audit-logs in bulk. Useful if the detector ships after the feature has been live for a while and forgeries have accumulated.

Add `mirror_log.via_bot_id` in the same migration (`0015`).

### 6.13 N-strikes-in-7d freeze threshold
**Default: 3 forgeries in 7 days → auto-freeze.** Tunable via env `FORGERY_FREEZE_THRESHOLD` (default `3`) and `FORGERY_FREEZE_WINDOW_HOURS` (default `168`). Strict enough to catch repeat offenders, lenient enough that one curious "what if I try this" doesn't burn a real member.

### 6.14 Public guidance
Pinned guide in SC45 gets a one-line addition: *"Real vouch cards say 'via @VouchVaultBot' under the bot's name. Anything else is fake — DM an admin."* Updates `buildPinnedGuideText` in `src/core/archive.ts` (spec-locked text — this spec is the spec-change).

### 6.15 BotFather command menu
`/lookup` already in the menu (set by `npm run telegram:onboarding`). No menu changes needed — inline mode doesn't surface in the slash-command popup.

### 6.16 Inline placeholder text
Set via BotFather. Suggested: `username to look up — e.g. daveyboi`.

### 6.17 Telegram username changes between vouch and lookup
Legacy archive rows are keyed by `target_telegram_id` AND `target_username` (snapshot at vouch time). Lookup by username matches on the most recent username snapshot but should also resolve via `target_telegram_id` if the user's @ has changed since. **Existing `/lookup` semantics are correct here — no spec change.**

### 6.18 Forgery in DMs to the bot
If a user DMs the bot a fake card, we don't care — only the bot sees it. No detector runs. (DMs to the bot from non-admin users are already mostly limited to `/lookup` and `/forgetme`.)

---

## 7. Rollout plan

1. **Phase 1 — detector first (defensive):**
   - Ship `forgeryDetector` + `forgeryEnforcement` in the existing message + edited_message handlers.
   - Detection regex matches the card shape we'll use.
   - Hard mode from day 1: delete + DM warn + audit + strike count.
   - Mirror log gets `via_bot_id` column.

2. **Phase 2 — inline + in-group /lookup (offensive):**
   - Inline handler + card renderer.
   - Open `/lookup @user` to in-group.
   - Webhook re-registration with new `allowed_updates`.
   - BotFather `/setinline` + `/setinlinefeedback`.
   - Pinned-guide update.

3. **Phase 3 — historical sweep + admin tooling:**
   - `/forgeries` admin command (paginated recent-forgery audit).
   - `/purge_forgeries` one-shot historical sweep.

Phases 1 and 2 can ship in either order — Phase 1 first means we detect any pre-existing forgery attempts; Phase 2 first means the feature is live before the detector. Recommend **Phase 1 first** so the detector is armed before we introduce the structured card shape that forgers can copy.

---

## 8. Testing

- `inlineCard.test.ts` — pure renderer tests (length, truncation, glyph stability, footer rotation determinism).
- `forgeryDetector.test.ts` — every threat row in §3: blank-forge, edit-of-real, lookalike-bot, forwarded-real (allow), forwarded-forge (kill), reply with manipulated quote, no-op edit on real card.
- `inlineQueryHandler.test.ts` — empty query, no-record query, valid query, rate-limit hit.
- `lookupRateLimit.test.ts` — extend with inline-namespace bucket tests.
- Integration: dry-run against test group `-1003958981628` before SC45 cutover.

---

## 9. Compliance gap interaction

This spec creates new data-access patterns over the legacy V3 archive (already covered by existing privacy posture). It does **not** create new write paths, so V3 PII audit (Phase 3 compliance gap) scope is unchanged. `/forgetme` (also Phase 3) will need to clear strike rows for the requesting user — minor add when we ship that.

---

## 10. Out of scope (future)

- Inline result voting / upvotes (Telegram has the API, but this is feature creep).
- Multi-language card text.
- Cross-group federation of vouch data.
- Per-vouch detail expansion via `callback_data` (could ship later — current 64-byte limit is enough for `vc:<target_id>:<page>` paging).
- Edit-attack content-hash refinement (§6.8) — deferred to v2.

---

## 11. Compatibility

- **Bot privacy mode:** must stay OFF (already required for v9 mirror + lexicon mod). Inline mode itself is unaffected by privacy mode.
- **Existing `/lookup` DM flow:** unchanged. In-group `/lookup` is additive.
- **v9 mirror:** unchanged. Inline insertions in SC45 are member-attributed messages → mirrored normally.
- **Webhook `allowed_updates`:** adds two fields. Operators must run `npm run telegram:webhook` post-deploy to refresh server-side state, otherwise inline never fires (silent failure mode, same as the v8.0 `chat_join_request` rollout).
