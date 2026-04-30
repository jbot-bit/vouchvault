# Inline vouch cards — implementation plan

**Spec:** `docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md`
**Branch:** `feat/inline-vouch-cards`
**Depends on:** v9 spec read-paths only — additive over `2026-04-27-vouchvault-v9-simplification-design.md`.

**Goal:** Ship the SC45 inline vouch-card surface (`@VouchVaultBot @target`) plus in-group `/lookup` plus a forgery detector that arms the bot against V3-shape impersonation.

**Conventions (per CLAUDE.md):**
- Tests live alongside source. Every new `*.test.ts` MUST be appended to `scripts.test` in `package.json`.
- All Telegram I/O goes through `src/core/tools/telegramTools.ts` via `callTelegramAPI`. Public sends wrap with `withTelegramRetry`. Errors are typed (`TelegramRateLimitError`, `TelegramForbiddenError`, `TelegramChatGoneError`, `TelegramApiError`). Branch with `instanceof`, never on `error.message`.
- Migrations are append-only. New file `migrations/0015_inline_cards.sql`. Regenerate snapshot via drizzle-kit. Never edit historical migrations.
- Spec-locked text changes (`buildPinnedGuideText`) require the spec change to be committed first; `archiveUx.test.ts` byte-stable expectations update in the same commit.
- `callback_data` 64-byte cap is enforced by `src/core/callbackData.test.ts`. Add `vc:` prefixes to `KNOWN_CALLBACKS` when introduced.
- Webhook `allowed_updates` is server-side state. Operator must run `npm run telegram:webhook` after deploy or new update types silently never fire.
- Logging via pino: object first, message second (`logger.info({ ctx }, "msg")`). Never the printf form.
- Commit subjects: `feat(scope): ...`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. One logical change per commit; no push without explicit ask.

**Phase ordering:** Phase 0 (registry/migration) → Phase 1 (detector, armed before card shape exists in code) → Phase 2 (inline + in-group lookup, introduces card shape) → Phase 3 (admin tooling). Phase 0 is a strict prerequisite for both 1 (`mirror_log.via_bot_id`, `forgery_strikes`) and 2 (`sc45_members` member gate).

---

## File structure summary

| File | Phase | Status | Responsibility |
|---|---|---|---|
| `migrations/0015_inline_cards.sql` | 0 | **Create** | `forgery_strikes`, `sc45_members`, `mirror_log.via_bot_id`, `chosen_inline_results` |
| `src/core/sc45Members.ts` + `.test.ts` | 0 | **Create** | Pure status helpers + DB upsert/remove/has + LRU cache |
| `src/core/mirrorPublish.ts` + `.test.ts` | 0 | Modify | Capture `via_bot.id` into mirror payload |
| `src/core/mirrorStore.ts` | 0 | Modify | Persist `via_bot_id` column |
| `scripts/backfillSc45Members.ts` | 0 | **Create** | One-shot `getChatAdministrators` seed |
| `src/core/forgeryDetector.ts` + `.test.ts` | 1 | **Create** | Pure verdict module — all spec §3 threat rows + §3 "does NOT defend" rows as negative cases |
| `src/core/forgeryEnforcement.ts` + `.test.ts` | 1 | **Create** | Delete + DM warn + audit + N-strikes-in-7d freeze |
| `src/core/forgeryStore.ts` + `.test.ts` | 1 | **Create** | Strike writes, recent count, paginated read |
| `src/core/inlineCard.ts` + `.test.ts` | 2 | **Create** | Pure renderer; **glyph constants imported from `forgeryDetector.ts`** so detector + renderer can never desync |
| `src/core/inlineQueryHandler.ts` + `.test.ts` | 2 | **Create** | Parse query → member-gate → archive lookup → `answerInlineQuery` |
| `src/core/chosenInlineResultStore.ts` + `.test.ts` | 2 | **Create** | Persist content-hashes of inserted cards (groundwork for v2 edit-content compare; v1 only logs) |
| `src/core/forgeriesAdmin.ts` + `.test.ts` | 3 | **Create** | `/forgeries` paginated audit + `/purge_forgeries` historical sweep (dry-run by default) |
| `src/core/tools/telegramTools.ts` | 2 | Modify | Add `answerInlineQuery`, `getMe` |
| `src/core/lookupRateLimit.ts` + `.test.ts` | 2 | Modify | Add namespace-aware bucket (`dm:`, `inline:`, `group_lookup:`) |
| `src/core/archive.ts` + `archiveUx.test.ts` | 2 | Modify | Spec §6.14 line in `buildPinnedGuideText` |
| `src/telegramBot.ts` | 0–3 | Modify | Registry wire, forgery hooks, `inline_query` + `chosen_inline_result` branches, in-group `/lookup`, `/forgeries`, `/purge_forgeries`, callback handler |
| `src/server.ts` | 1 | Modify | Boot-time `getMe` capture into `OUR_BOT_ID` cache (env-hint fallback) |
| `scripts/setTelegramWebhook.ts` | 2 | Modify | Add `inline_query`, `chosen_inline_result` to `allowed_updates` |
| `src/core/callbackData.test.ts` | 3 | Modify | Add `vc:` prefixes to `KNOWN_CALLBACKS` |
| `package.json` | 0–3 | Modify | New `*.test.ts` files + `sc45:backfill-members` script |
| `.env.example` | 1,3 | Modify | `TELEGRAM_BOT_ID`, `FORGERY_FREEZE_THRESHOLD`, `FORGERY_FREEZE_WINDOW_HOURS` |
| `DEPLOY.md` | 0,2,3 | Modify | Backfill script note + `npm run telegram:webhook` reminder + BotFather `/setinline` + `/setinlinefeedback` + member-permission "Send via inline bots" |

---

## Phase 0 — migration + member registry plumbing

**Goal:** ship schema + `sc45_members` registry + mirror `via_bot_id` capture. Zero behaviour change for existing surfaces.

### Task 0.1 — Migration `0015_inline_cards.sql`
- [ ] Create `migrations/0015_inline_cards.sql` per spec §5.3, with one addition not in the spec: `chosen_inline_results` table for §6.8 future content-hash comparisons (write-only in v1, no reads — but the column is cheaper to add now than a future migration).
  ```sql
  CREATE TABLE forgery_strikes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    chat_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    kind TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash TEXT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT false
  );
  CREATE INDEX forgery_strikes_user_recent ON forgery_strikes (user_id, detected_at DESC);

  CREATE TABLE sc45_members (
    user_id BIGINT PRIMARY KEY,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE chosen_inline_results (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    target_username TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    chosen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX chosen_inline_results_recent ON chosen_inline_results (user_id, chosen_at DESC);

  ALTER TABLE mirror_log ADD COLUMN via_bot_id BIGINT;
  ```
- [ ] Run `npx drizzle-kit generate`. Inspect snapshot diff — only these additions are allowed.
- [ ] Verify `migrations/meta/_journal.json` includes `0015_inline_cards` entry (the journal-drift bug from PR #13 is fixed but no CI guard exists — eyeball it).
- [ ] Smoke: `npm run db:migrate` against local DB returns `{"ok": true, "migrations": "applied"}`.

### Task 0.2 — Member registry helper
- [ ] Test first: `src/core/sc45Members.test.ts`:
  - `statusIsActive('member' | 'administrator' | 'creator' | 'restricted') === true`.
  - `statusIsActive('left' | 'kicked') === false`.
  - LRU cache: `markSeen(id)` then `recentlySeen(id)` returns true; cache caps at N (default 1024) with FIFO eviction. (Pure helper — no DB.)
- [ ] Create `src/core/sc45Members.ts`:
  - `statusIsActive(status: string): boolean`.
  - In-memory LRU `recentlySeen(userId): boolean` + `markSeen(userId): void`. Used by Task 0.4 to skip DB upsert on hot users.
  - DB: `upsertMember(db, { userId, status })`, `removeMember(db, userId)`, `isMember(db, userId): Promise<boolean>`. Insert SQL: `INSERT … ON CONFLICT (user_id) DO UPDATE SET last_seen_status = EXCLUDED.last_seen_status, updated_at = now()`.
  - `isMember` does a single indexed PK lookup; cheap. No cache needed for the read path.
- [ ] Append `sc45Members.test.ts` to `package.json` test list.

### Task 0.3 — Wire `chat_member` upsert
- [ ] In `src/telegramBot.ts` `handleChatMember`: branch on `new_chat_member.status`. Active → `upsertMember`; `left`/`kicked` → `removeMember`. Gate by `chat.id ∈ TELEGRAM_ALLOWED_CHAT_IDS`.
- [ ] Best-effort: try/catch; pino structured log; never throw out of the handler. Out-of-order events are last-write-wins on `updated_at` (acceptable per spec §6.5).

### Task 0.4 — First-post auto-add (with cache)
- [ ] In `handleGroupMessage`, **after** chat moderation, **before** the mirror call: skip when `from.is_bot === true` or `via_bot` is set; else if `recentlySeen(from.id)` → no-op; else `upsertMember(db, { userId: from.id, status: 'member' })` then `markSeen(from.id)`.
- [ ] Idempotent. Cache hit rate matters because every group message hits this path; the LRU keeps DB pressure ~constant regardless of message volume.

### Task 0.5 — Capture `via_bot_id` into mirror_log
- [ ] Update `src/core/mirrorPublish.ts` to include `viaBotId: message.via_bot?.id ?? null` in the payload passed to `recordMirror`.
- [ ] Update `src/core/mirrorStore.ts` to insert `via_bot_id`.
- [ ] Add a case to `mirrorPublish.test.ts` asserting `viaBotId` propagates. Existing tests stay green.

### Task 0.6 — Backfill script
- [ ] Create `scripts/backfillSc45Members.ts`:
  - For each `chatId ∈ TELEGRAM_ALLOWED_CHAT_IDS`, call `getChatAdministrators` via `callTelegramAPI`. Upsert each admin with `last_seen_status` from response.
  - Wrap with `withTelegramRetry`. Branch typed errors: `TelegramRateLimitError` retried automatically; `TelegramChatGoneError` → log and skip that chat; everything else → log + exit non-zero.
  - Log final counts: `logger.info({ chatId, upserted }, "backfill complete")`.
- [ ] Register `"sc45:backfill-members": "node --experimental-strip-types scripts/backfillSc45Members.ts"` in `package.json`.
- [ ] Add to `DEPLOY.md` post-deploy: run once after first deploy of phase 0.

### Task 0.7 — Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — `sc45Members.test.ts`, `mirrorPublish.test.ts` green.
- [ ] Manual smoke against test group `-1003958981628`:
  - Run `npm run sc45:backfill-members` → `sc45_members` table contains admins.
  - Post as a non-admin → row appears with `last_seen_status='member'`.
  - Post a second message → no extra DB write (LRU cache hit, observable as one `upsertMember` log line for the user, not two).

### Phase 0 risks / rollback
- **Risk:** drizzle-kit snapshot drifts unrelated tables. **Mitigation:** review the generated diff; only `0015_*` additions allowed.
- **Risk:** `chat_member` updates require `allowed_updates` to include `chat_member` — already configured in `setTelegramWebhook.ts` (per CLAUDE.md takedown-resilience section). Verify on deploy.
- **Risk:** OneDrive `mmap` errors on `git add` for the migration directory. **Mitigation:** stage in smaller batches if it hits.
- **Rollback:** `DROP TABLE forgery_strikes; DROP TABLE sc45_members; DROP TABLE chosen_inline_results; ALTER TABLE mirror_log DROP COLUMN via_bot_id;`. Safe — nothing reads them yet.

### Phase 0 ready-to-merge checklist
- [ ] Migration applied locally + on staging.
- [ ] All new `*.test.ts` files appended to `package.json`.
- [ ] Backfill script smoke-passes.
- [ ] `npx tsc --noEmit` + `npm test` clean.
- [ ] Commit: `feat(sc45): member registry + 0015 migration (inline-cards phase 0)`.

---

## Phase 1 — forgery detector + enforcement

**Goal:** detector armed before the inline card shape exists in code. V3-shape forgeries → delete + audit + DM warn + strike. 3-strikes-in-7d → freeze.

### Task 1.1 — Pure detector
- [ ] Test first: `src/core/forgeryDetector.test.ts`. Cover **every threat row in spec §3 + every "does NOT defend" row as a negative case**:
  - **T1 forge_from_blank** (positive): card-regex match + no `via_bot` → `kind: 'forge_from_blank'`.
  - **T2 edit_of_real_card** (positive): `edited_message` + `via_bot.id === OUR_BOT_ID` + content changed → `kind: 'edit_of_real_card'`. v1 treats any edit as a content change (per user direction "they won't edit much").
  - **T3 lookalike_bot** (positive): card-regex match + `via_bot.id` numeric mismatch → `kind: 'lookalike_bot'`.
  - **T5 forwarded forgery** (positive): `forward_origin` set + `via_bot` empty → forgery.
  - **T5 forwarded real** (negative): `forward_origin` set + `via_bot.id === OUR_BOT_ID` → not a forgery (spec §6.6).
  - **T6 reply with manipulated quote** (negative): detector runs against the message body only, not `quote.text`. Reply where own body is plain text but quote contains card glyphs → not a forgery.
  - **Bot-authored message** (negative): `from.is_bot === true` → skip entirely. Covers GroupHelp Pro outputs, our own bot's outputs, any third-party bot. Detector returns `null` early.
  - **Self-bot message** (negative): `from.id === OUR_BOT_ID` → skip (defense in depth on top of `is_bot`).
  - **No-card prose** (negative): message lacks the `📋` glyph → early-out before regex evaluation. Performance guard.
  - **Casual mention of "via @VouchVaultBot"** (negative): user typing `via @VouchVaultBot is sick` in prose → no card-regex match (regex requires the structured header line) → not a forgery.
  - **Zero-width injection** (positive): forger pads card with `​` / `⁠` to slip past regex → strip these before matching, then evaluate.
  - **No-op edit** (negative for v1): `edited_message` with `via_bot.id === OUR_BOT_ID` and identical body → v1 still triggers (per user direction); document the FP risk in §6.8 of the spec; v2 will compare against `chosen_inline_results.content_hash`.
  - **`OUR_BOT_ID` undefined at detection time** (defensive): detector treats `via_bot` as "not ours" only when `OUR_BOT_ID` is a known number. If `OUR_BOT_ID === undefined`, return `null` (fail open) — better to miss a forgery than delete a real card during boot before `getMe` resolves. Log a warn at detect time so this doesn't go unnoticed.
- [ ] Create `src/core/forgeryDetector.ts`:
  - Export `CARD_GLYPHS = { board: '📋', emDash: '—', middot: '·', pos: '✅', warn: '⚠️' }` as the **single source of truth** — `inlineCard.ts` imports these.
  - Export `CARD_REGEX` built from those constants. Strict: header `📋 @<word> — <int> ✅ · <int> ⚠️` followed by `\n· dd/mm/yyyy @\w+ — "..." (✅|⚠️)` repeated.
  - Export `stripZeroWidth(s: string): string`.
  - Export `detectForgery({ message, ourBotId, kind: 'message' | 'edited_message' }): { isForgery, kind, reason, contentHash } | null`. Pure, no DB, no I/O.
  - Export `hashCardBody(body: string): string` — `sha256(stripZeroWidth(body)).slice(0, 16)`.
- [ ] Append to `package.json`.

### Task 1.2 — Strike store
- [ ] Test first: `src/core/forgeryStore.test.ts` (DB-backed; pattern matches existing `mirrorStore.test.ts` if present, else mock the pool):
  - `recordStrike({ userId, chatId, messageId, kind, contentHash })` writes a row, returns id.
  - `countRecentStrikes(userId, withinHours)` returns count, excludes rows older than the window.
  - `listRecentStrikes({ limit, offset })` returns rows sorted by `detected_at DESC`.
- [ ] Create `src/core/forgeryStore.ts`. Use parameterised SQL through drizzle.

### Task 1.3 — Enforcement orchestrator
- [ ] Test first: `src/core/forgeryEnforcement.test.ts`:
  - Verdict → calls `deleteTelegramMessage` (mocked telegram dep).
  - `deleteTelegramMessage` failure: `TelegramApiError` "message to delete not found" (Telegram error code 400) → swallow, still record strike (someone may have raced us; the strike count is still correct).
  - Verdict → records strike row.
  - Verdict → DM warns offender via `sendTelegramMessage`. `TelegramForbiddenError` (user blocked the bot) → swallow.
  - Verdict → audit row via `recordAdminAction({ kind: 'forgery:delete', actor: 'system', target_user_id, content_hash })`.
  - Strike count `>= FORGERY_FREEZE_THRESHOLD` within `FORGERY_FREEZE_WINDOW_HOURS` → freeze action invoked once (idempotent — repeat calls within the window do not re-freeze an already-frozen user).
  - `from.is_bot === true` short-circuits before delete (defense-in-depth: detector already filters but the enforcement layer rechecks).
  - Concurrent enforcement on the same `(chat_id, message_id)`: idempotent — second invocation finds Telegram returns "not found", strike still recorded once because the orchestrator is keyed on `(chat_id, message_id, kind)` to dedup.
- [ ] Create `src/core/forgeryEnforcement.ts`:
  - `enforceForgery(deps, { update, verdict, logger })` — `deps = { db, telegram, audit, freeze }` for testability.
  - Branch typed errors via `instanceof`. `withTelegramRetry` already inside the public sends.
  - Read `FORGERY_FREEZE_THRESHOLD` / `FORGERY_FREEZE_WINDOW_HOURS` from env with defaults `3` / `168`.
  - Dedup guard: cache `(chat_id, message_id, kind)` in an in-memory LRU for ~60s so a burst of `edited_message` events from the same edit doesn't double-strike.

### Task 1.4 — Wire into update handlers
- [ ] In `src/telegramBot.ts` `handleGroupMessage`: after chat moderation, after first-post auto-add, **before** the mirror call: run `detectForgery({ message, ourBotId: OUR_BOT_ID, kind: 'message' })`. If verdict, call `enforceForgery` and **return early** — forgeries do not get mirrored.
- [ ] In `processTelegramUpdate` `edited_message` branch: same hook with `kind: 'edited_message'`. Forgery → enforce + return early before any other edit handling.
- [ ] If `OUR_BOT_ID` is undefined, log a warn but continue — detector returns `null` in that case so no enforcement runs.

### Task 1.5 — Boot-time bot-id capture
- [ ] In `src/server.ts` boot path (next to `logBotAdminStatusForChats`): call `callTelegramAPI('getMe', {})`, store `result.id` in module-scope `OUR_BOT_ID`. Wrap in try/catch — on failure, fall back to env hint `TELEGRAM_BOT_ID`. Warn-log if both missing.
- [ ] Export `getOurBotId(): number | undefined` from a small `src/core/botIdentity.ts` so the detector + enforcement can read it without circular imports through `telegramBot.ts`.
- [ ] Document `TELEGRAM_BOT_ID` (optional) in `.env.example`.

### Task 1.6 — Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — `forgeryDetector.test.ts`, `forgeryEnforcement.test.ts`, `forgeryStore.test.ts` green.
- [ ] Manual smoke against test group:
  - Post a text message containing the card shape with no `via_bot` → deleted within ~1s, DM warn arrives, `forgery_strikes` row + audit row appear.
  - Post the same content as a normal message (no card glyphs) → passes through.
  - Edit a non-bot-via message to add card glyphs → deleted via the edited_message branch.
  - Bot's own moderation DM arrives in a member's DM → not affected (DM messages don't hit `handleGroupMessage`).
  - Other bot's group message that coincidentally contains a `📋` → not deleted (`from.is_bot` short-circuits).

### Phase 1 risks / rollback
- **Risk:** false positive on legitimate text containing the exact glyph combo. **Mitigation:** strict regex requires the structured header + bullet shape, plus `from.is_bot` short-circuit. Tests cover the combinatorial space.
- **Risk:** `OUR_BOT_ID` unavailable at boot (Telegram getMe rate-limited). **Mitigation:** env hint + fail-open detector + warn log.
- **Risk:** burst of `edited_message` events double-strikes. **Mitigation:** LRU dedup in enforcement (Task 1.3).
- **Risk:** Forgery deleted but mirror already wrote it (race). **Mitigation:** detector runs before mirror in `handleGroupMessage` (Task 1.4 explicit ordering). For `edited_message`, the originally-mirrored message is the un-edited body; the edit-detected forgery is detected at edit time and deleted. Mirror does not re-fire on edits, so no extra cleanup needed — but future-proof: if someone wires mirror-on-edit, this assumption breaks.
- **Rollback:** comment out the two `enforceForgery` call sites; tables stay (harmless).

### Phase 1 ready-to-merge checklist
- [ ] All tests green (detector covers every spec §3 row).
- [ ] Manual smoke confirms delete + DM warn + audit + strike row.
- [ ] No regression in `chatModeration.test.ts` / `archiveUx.test.ts` / `mirrorPublish.test.ts`.
- [ ] `.env.example` updated with `TELEGRAM_BOT_ID`, `FORGERY_FREEZE_THRESHOLD`, `FORGERY_FREEZE_WINDOW_HOURS`.
- [ ] Commit: `feat(forgery): card-shape detector + enforcement (inline-cards phase 1)`.

---

## Phase 2 — inline handler + in-group `/lookup` + card renderer

**Goal:** members can `@VouchVaultBot @target` and get an inline result; in-group `/lookup @target` works; pinned-guide updated.

### Task 2.1 — Card renderer
- [ ] Test first: `src/core/inlineCard.test.ts`:
  - **Glyph stability**: assert UTF-8 byte sequences for every glyph constant (catches accidental unicode-class swaps).
  - **Glyph imports**: `inlineCard.ts` imports glyphs from `forgeryDetector.ts`. (Asserted via a direct import-equality check — both modules reference the same constants.)
  - **Length cap**: archive with 50 rows → result ≤ 800 chars and ≤ 3900 hard cap (via `withCeiling`); footer reads `…N more — DM /lookup @<target> for full audit`.
  - **3 most-recent excerpts** when truncating.
  - **Footer rotation deterministic** on `(targetId, dayBucket(now))` — same inputs → same footer; next-day bucket → potentially different.
  - **Date format `dd/mm/yyyy`** via existing `fmtDate`.
  - **Synthetic legacy reviewer** (`legacy_<numericId>`): renders without crash; the username column shows the synthetic name.
  - **Empty archive** (target has no rows): renderer returns `null` so the handler emits the no-record hint instead.
  - **content_hash returned** alongside `text` so `chosen_inline_result` can persist it.
- [ ] Create `src/core/inlineCard.ts`:
  - Imports `CARD_GLYPHS` from `forgeryDetector.ts`.
  - `renderInlineCard({ targetUsername, targetId, archiveRows, now }): { text, contentHash } | null`.
  - Uses `withCeiling` from `archive.ts` for the 3900 cap.

### Task 2.2 — Telegram tool additions
- [ ] In `src/core/tools/telegramTools.ts`:
  - `answerInlineQuery({ inlineQueryId, results, cacheTime, isPersonal, switchPmText, switchPmParameter })` routed through `callTelegramAPI` and wrapped with `withTelegramRetry`.
  - `getMe()` thin wrapper.
- [ ] Tests: if `telegramTools.ts` has existing mock-fetch tests (check `telegramDispatch.test.ts` pattern), add minimal happy-path coverage. Otherwise rely on integration coverage in handler tests.
- [ ] **10-second deadline:** Telegram rejects `answerInlineQuery` after ~10s. Handler must respond fast or drop. Document inline that any handler logic must complete in <8s; enforce via a soft `Promise.race` with a 7s deadline that responds with an empty results array if the lookup is slow.

### Task 2.3 — Inline query handler
- [ ] Test first: `src/core/inlineQueryHandler.test.ts`:
  - **Empty query** (whitespace-only) → single non-insertable hint "Type a username, e.g. `@daveyboi`" (spec §6.2).
  - **Non-member `from.id`** → single hint with `switch_pm_text: "DM the bot to /lookup"` (Telegram's redirect-to-DM mechanism — better UX than just text). Spec §6.5.
  - **`chat_type ∉ {sender, supergroup}`** → empty results (or hint-only). Spec §6.5.
  - **No-record query** → single non-insertable "No record for @target" hint (§6.1).
  - **Valid query** → one insertable result with rendered card; `cache_time: 0`; `is_personal: true`.
  - **Rate-limit hit** → single non-insertable hint "Slow down, try again in <N>s" with retryAfter from the bucket. Spec §6.10.
  - **Strips leading `@`, lowercases, trims** (§6.3). `@DAVEYBOI ` and `daveyboi` → same lookup.
  - **Slow archive** (mocked >7s) → handler responds with empty results before deadline; logs slow-lookup warning.
  - **Member-gate cache miss followed by hit**: first call hits DB `isMember`, second call within request lifecycle reuses the result (or each call hits DB — spec doesn't require caching at this layer; document and pick).
- [ ] Create `src/core/inlineQueryHandler.ts`:
  - `handleInlineQuery(deps, update, logger)` — `deps = { db, archive, telegram, rateLimit, isMember, render }`.
  - Reads from existing `archiveStore` (no new write paths).
  - Calls `answerInlineQuery({ cacheTime: 0, isPersonal: true })`.

### Task 2.4 — `chosen_inline_result` capture
- [ ] Create `src/core/chosenInlineResultStore.ts`:
  - `recordChoice({ userId, targetUsername, contentHash })` writes to `chosen_inline_results`.
- [ ] Wire into `processTelegramUpdate`: on `chosen_inline_result` event, parse `result_id` (encode `<targetId>:<contentHash>` in the result_id when answering), call `recordChoice`. Keeps the table populated for v2 edit-content compares without changing v1 enforcement.
- [ ] Test: `chosenInlineResultStore.test.ts` writes a row + reads it back.

### Task 2.5 — Rate-limiter namespace
- [ ] Test first: extend `src/core/lookupRateLimit.test.ts`:
  - `tryConsume('inline:' + userId)` and `tryConsume('dm:' + userId)` are independent buckets.
  - `tryConsume('group_lookup:' + userId)` is a third bucket.
- [ ] Modify `src/core/lookupRateLimit.ts` to namespace bucket keys. Existing API stays backward-compatible by keeping the default unprefixed key as `dm:`.
- [ ] **Decision (closes spec ambiguity §5.2):** in-group `/lookup` reuses the `inline:` bucket. Both are member-public-read surfaces — sharing avoids inviting a member to "burn" both quotas serially. Document in the file header.

### Task 2.6 — In-group `/lookup`
- [ ] In `src/telegramBot.ts` group-message branch: when `command === '/lookup'` from an SC45 member in an allowed group, run the lookup pathway (member flavour: no `private_note`, no admin-only NEGs) and reply in-thread.
- [ ] Use `inline:` rate-limit namespace per Task 2.5 decision.
- [ ] Reuse `buildLookupText` (member flavour) — do NOT use `inlineCard` rendering here; in-group `/lookup` has different formatting (full member-flavour audit, vs inline card's compact 3-excerpt summary).
- [ ] Group-permission edge: if the bot can't reply in group (forbidden), DM the member with the result. Best-effort; swallow `TelegramForbiddenError`.

### Task 2.7 — Webhook + bot routing
- [ ] In `src/telegramBot.ts` `processTelegramUpdate`: add `inline_query` and `chosen_inline_result` branches.
- [ ] In `scripts/setTelegramWebhook.ts`: append `"inline_query"`, `"chosen_inline_result"` to `allowed_updates`. Comment that BotFather `/setinline` + `/setinlinefeedback` must be enabled or these never fire.

### Task 2.8 — Pinned-guide copy
- [ ] Spec §6.14 line: *"Real vouch cards say 'via @VouchVaultBot' under the bot's name. Anything else is fake — DM an admin."*
- [ ] Test first: update `src/core/archiveUx.test.ts` byte-stable expectation for `buildPinnedGuideText`.
- [ ] Modify `src/core/archive.ts` `buildPinnedGuideText`. Per CLAUDE.md, the spec change is the spec change — the test update lands in the same commit.

### Task 2.9 — DEPLOY.md ops note
- [ ] Append to `DEPLOY.md` post-deploy:
  - Run `npm run telegram:webhook` — refreshes `allowed_updates` (otherwise inline silently never fires; same gotcha as v8.0 `chat_join_request`).
  - BotFather `/setinline` enable, placeholder `username to look up — e.g. daveyboi` (spec §6.16).
  - BotFather `/setinlinefeedback` enable (spec §5.5).
  - Group permissions: SC45 member permission "Send via inline bots" must be ON (spec §6.9). If OFF, inline insertion silently fails.

### Task 2.10 — Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — `inlineCard.test.ts`, `inlineQueryHandler.test.ts`, `chosenInlineResultStore.test.ts`, `lookupRateLimit.test.ts`, `archiveUx.test.ts` green.
- [ ] Manual smoke against test group:
  - SC45 member queries `@VouchVaultBot @somelegacy` from inside the test group → result shows; insertion lands with `via @VouchVaultBot` attribution.
  - Same query from a non-member account → only the "DM the bot to /lookup" hint, no insertable result.
  - Inline query in a third-party chat (different supergroup the test account is in) → results still appear (residual API limitation, spec §6.5); document this is expected.
  - In-group `/lookup @target` → member-flavour reply.
  - Burst 4 inline queries within 5s → 4th gets the rate-limit hint.
  - Edited inline-inserted card → Phase 1 detector deletes.
  - `chosen_inline_results` row appears after each insertion.

### Phase 2 risks / rollback
- **Risk:** spec-locked text update fails byte-stable test → fix in same commit.
- **Risk:** `cache_time: 0` increases bot load. **Mitigation:** per-user 1/5s rate limiter + indexed archive lookups.
- **Risk:** 10s `answerInlineQuery` deadline blown by slow archive → soft 7s deadline returns empty results gracefully.
- **Residual gap:** member typing in another supergroup they're in still gets results (Telegram doesn't expose destination chat_id in inline_query). Documented in spec §6.5; not a regression.
- **Rollback:** revert webhook `allowed_updates`, redeploy, run `npm run telegram:webhook`. Inline silently stops firing. Pinned guide can be re-updated by re-running `telegram:onboarding`.

### Phase 2 ready-to-merge checklist
- [ ] Inline-mode + in-group lookup smoke cases pass.
- [ ] Pinned-guide diff approved.
- [ ] DEPLOY.md updated.
- [ ] `package.json` test list contains every new file.
- [ ] Commit: `feat(inline): inline vouch cards + in-group /lookup (inline-cards phase 2)`.

---

## Phase 3 — admin tooling

**Goal:** admins audit forgeries (`/forgeries`) and run a safe historical sweep (`/purge_forgeries`, dry-run by default).

### Task 3.1 — `/forgeries` paginated audit
- [ ] Test first: `src/core/forgeriesAdmin.test.ts`:
  - Page 0 renders the most recent 10 strikes with `dd/mm/yyyy` dates, kind, user (id + last-known username if present), short content_hash.
  - `callback_data = vc:p:<page>` (next/prev). Assert each generated string ≤ 64 bytes — covered also by `callbackData.test.ts` once `vc:` is added to `KNOWN_CALLBACKS`.
  - Empty state ("no forgeries recorded.").
  - Edge: page beyond total → renders an empty page with a "back to first" button.
- [ ] Create `src/core/forgeriesAdmin.ts`:
  - `renderForgeriesPage({ rows, page, total })` pure renderer.
  - `handleForgeriesCommand(deps, message, logger)` — admin-gated; uses `forgeryStore.listRecentStrikes`.
  - `handleForgeriesCallback(deps, callbackQuery, logger)` — re-renders on `vc:p:N` clicks via `editTelegramMessage`.
  - All admin reads audit-logged via `recordAdminAction({ kind: 'forgery:list', ... })`.

### Task 3.2 — `/purge_forgeries` historical sweep (dry-run by default)
- [ ] Test first: extend `forgeriesAdmin.test.ts`:
  - Sweep `mirror_log` rows where `text` matches `CARD_REGEX` (re-export from `forgeryDetector`) and `(via_bot_id IS NULL OR via_bot_id != OUR_BOT_ID)`.
  - **Dry-run mode (default)**: returns `{ scanned, would_delete, sample: first 5 rows }`. No deletes, no strikes.
  - **Confirm mode** (`/purge_forgeries confirm`): for each match, `deleteTelegramMessage`, `recordStrike`, audit-log. Throttle ≤ 25 deletes/sec mirroring `replayToTelegramAsForwards.ts`.
  - Idempotency: rerunning confirm picks up only new matches (already-deleted messages return Telegram error 400 "not found" → swallow + still strike).
  - Permission edge: bot lacks `can_delete_messages` in some chat → log + skip + continue.
- [ ] Implementation in `src/core/forgeriesAdmin.ts`:
  - Batched `LIMIT 100 OFFSET ?` over `mirror_log`. Don't load the whole table.
  - Withdraw `withTelegramRetry` for 429 backoff.
  - Reply with summary `{ scanned, would_delete | deleted, errors }`.
  - Pre-Phase-0 forgeries (rows where `via_bot_id IS NULL` because the column didn't exist) are candidates only if regex matches; the regex is strict enough that false positives are rare.

### Task 3.3 — Wire commands + callback
- [ ] In `src/telegramBot.ts` admin command branches: add `/forgeries` and `/purge_forgeries [confirm]`. Both gated by existing `isAdmin` helper.
- [ ] Add `vc:p:*` to the `callback_query` branch.

### Task 3.4 — Callback test guardrail
- [ ] Modify `src/core/callbackData.test.ts`: add `vc:p:0`, `vc:p:99`, `vc:p:9999`, `vc:p:99999999` to `KNOWN_CALLBACKS`. Cap is asserted automatically.

### Task 3.5 — `/forgetme` interaction
- [ ] (Coordination note for Phase 3 compliance gap follow-up — this plan does NOT implement `/forgetme`.) When `/forgetme` ships, it must clear: `sc45_members`, `forgery_strikes`, `chosen_inline_results`, plus the existing legacy archive scope. Add a TODO in `forgeryStore.ts` + `chosenInlineResultStore.ts` referencing this so the future implementer doesn't miss the new tables.

### Task 3.6 — Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — `forgeriesAdmin.test.ts` green; `callbackData.test.ts` still green.
- [ ] Manual smoke:
  - Seed 3+ forgeries via Phase 1 path; admin runs `/forgeries` → paginated reply + prev/next works.
  - Admin runs `/purge_forgeries` (dry-run) → summary with sample.
  - Admin runs `/purge_forgeries confirm` → deletions in test group, audit + strike rows.
  - Admin runs `/purge_forgeries confirm` again → no-op (already deleted).

### Phase 3 risks / rollback
- **Risk:** regex false positive in `/purge_forgeries`. **Mitigation:** dry-run by default; `confirm` arg required.
- **Risk:** large `mirror_log` scan. **Mitigation:** batched query.
- **Rollback:** remove the two command branches; data tables stay.

### Phase 3 ready-to-merge checklist
- [ ] `/forgeries` pagination works in test group.
- [ ] `/purge_forgeries` dry-run + confirm both work.
- [ ] `callbackData.test.ts` updated.
- [ ] `package.json` test list contains `forgeriesAdmin.test.ts`.
- [ ] `/forgetme` TODOs added in the right places.
- [ ] Commit: `feat(admin): /forgeries audit + /purge_forgeries sweep (inline-cards phase 3)`.

---

## Cross-cutting concerns

### Performance budget
- `handleGroupMessage` per-message work added: first-post auto-add (LRU-cached, ~0 DB on hot path) + forgery detector (pure, early-out on missing `📋`). Net cost: <100µs typical, single PK lookup on cold cache miss.
- Inline path: `cache_time: 0` means every keystroke hits us. Rate limiter + indexed archive query keeps p99 < 200ms.

### Concurrency
- `chat_member` events out of order → last-write-wins on `updated_at`. Acceptable.
- Concurrent `edited_message` bursts → enforcement-layer LRU dedup keyed on `(chat_id, message_id, kind)` prevents double-strike.
- Concurrent forgery enforcement on the same message from two webhook deliveries → `processed_telegram_updates` idempotency table already prevents double-processing of the same `update_id`. Defense in depth.

### Privacy / GDPR posture
- New tables hold: user_id, status (sc45_members); user_id + content_hash (forgery_strikes); user_id + target_username + content_hash (chosen_inline_results). No raw message bodies.
- All three tables must be scoped by `/forgetme` when that ships (Task 3.5 TODO).
- Card content itself is rendered from the existing legacy archive — no new PII surface.

### Operational
- After Phase 0 deploy: run `npm run sc45:backfill-members`.
- After Phase 2 deploy: run `npm run telegram:webhook`; BotFather `/setinline` + `/setinlinefeedback`; verify "Send via inline bots" in SC45 member permissions.
- Env var changes (cumulative): `TELEGRAM_BOT_ID` (optional, recommended), `FORGERY_FREEZE_THRESHOLD=3`, `FORGERY_FREEZE_WINDOW_HOURS=168`. All have safe defaults.

### Supersede / cleanup
- Spec §6.8 (content-hash on edits) deferred to v2. `chosen_inline_results` table is populated in v1 but unread, so v2 is a pure read-side change.
- If post-launch metrics show forgery attempts trend to zero for >30 days, consider relaxing `FORGERY_FREEZE_THRESHOLD` to a higher number; do not remove the detector.

---

## Open questions / decisions captured

1. **In-group `/lookup` rate-limit namespace** → reuse `inline:` (Task 2.5 decision). Spec §5.2 ambiguity closed.
2. **`/purge_forgeries` dry-run default** → yes, `confirm` arg required for actual deletion (Task 3.2 decision).
3. **Edit-attack content-hash precision (spec §6.8)** → v1 deletes on any edit. Defer v2 content-hash compare; `chosen_inline_results` table populated in v1 to make v2 a pure read.
4. **Member registry seeding gap (spec §6.5)** → admin-seed + first-post-auto-add + `chat_member` events. Lurkers who never post fall back to DM `/lookup`. Documented; no plan action.
5. **`OUR_BOT_ID` source of truth** → boot-time `getMe` with env hint `TELEGRAM_BOT_ID` fallback (Task 1.5).
6. **Inline pagination** → not implemented in v1 (single-result inline is sufficient for the card UX). Telegram inline `offset` is supported by the API; defer.

---

## Critical files

- `C:\Users\joshd\OneDrive\VouchVault\src\telegramBot.ts` — touched in every phase.
- `C:\Users\joshd\OneDrive\VouchVault\src\core\tools\telegramTools.ts` — Phase 2 only.
- `C:\Users\joshd\OneDrive\VouchVault\migrations\0015_inline_cards.sql` — Phase 0.
- `C:\Users\joshd\OneDrive\VouchVault\src\core\forgeryDetector.ts` — Phase 1, single source of truth for `CARD_GLYPHS`.
- `C:\Users\joshd\OneDrive\VouchVault\src\core\inlineCard.ts` — Phase 2, imports glyphs from detector to keep them in sync.
- `C:\Users\joshd\OneDrive\VouchVault\package.json` — every phase.
- `C:\Users\joshd\OneDrive\VouchVault\DEPLOY.md` — Phases 0, 2, 3.
