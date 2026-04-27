# VouchVault impenetrable architecture — implementation plan

**Date:** 2026-04-26 / 2026-04-27 (consolidated execution plan)
**Status:** active. Driven by `/superpowers:executing-plans`.
**Spec:** `docs/superpowers/specs/2026-04-26-vouchvault-impenetrable-architecture-v6.md`
**V3 amendment:** §V3.5 in `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md`
**Branch:** `feat/v4-hardening-search-rename`

## Context

V3 was taken down by a 2,234-msg templated-bot spam-ring fingerprint. v6 architecture eliminates the publish-fingerprint vector via free-form prose body, adds channel-as-archive recovery, multi-bot failover, account-age gating, member-list export, and mass-forward replay. All commits env-var-gated for backwards compat.

## Per-commit task breakdown

### Commit 1.5 — Lexicon expansion + FP-rate gate ✅ (shipped)

- [x] Add compound `BUY_STEM` + `SOLICIT_CONTACT_CTA` rule to `src/core/chatModerationLexicon.ts` (variant B per KB:F2.18)
- [x] Create `src/core/chatModerationLexicon.test.ts` (compound source-tag attribution tests)
- [x] Create `scripts/measureLexiconFP.ts` (operator FP-gate script)
- [x] Add `npm run measure:lexicon-fp` to package.json
- [x] Verify FP gates: TBC26 = 0 marginal, QLD Vouches = 0 marginal, QLD Chasing = 165 marginal

### Commit 1 — opsec.md additions ✅ (shipped)

- [x] §10 TBC26 mirror posture (5-bot stack, distribution, growth pacing, account hygiene)
- [x] §11 channel-pair operator setup + canonical recovery procedure
- [x] §12 5-phase bot rollout (A→E)
- [x] §13 adversary-aware ops + bot rotation + ToS literacy + TBC monitoring habit
- [x] §14 member-list export protocol
- [x] Note admin bot privacy mode OFF (correction to v6 §3.1)

### Commit 2 — V3.5 spec amendment + plan file ✅ (shipped)

- [x] Append V3.5 amendment to V3 spec covering new locked-text builders, prose body, account-age guard, channel relay, multi-bot dispatch, DB schema
- [x] Create this plan file in superpowers writing-plans format

### Commit 3 — DB schema + idempotency + member-tracking

- [ ] Write `migrations/0009_impenetrable_v6.sql`:
  - [ ] `vouch_entries` add `channel_message_id INTEGER` nullable, `body_text TEXT` nullable
  - [ ] `processed_telegram_updates` add `bot_kind TEXT`; composite unique on `(bot_kind, update_id)`; backfill existing rows to `bot_kind='ingest'`
  - [ ] New table `users_first_seen (telegram_id BIGINT PK, first_seen TIMESTAMP NOT NULL DEFAULT NOW())`
- [ ] `src/core/storage/db.ts` pool max 5 → 10
- [ ] `src/core/storage/processedUpdates.ts` — `markUpdateProcessed(updateId, botKind)` signature change
- [ ] Create `src/core/userTracking.ts` (`getUserFirstSeen`, `recordUserFirstSeen`)
- [ ] Create `src/core/storage/processedUpdates.test.ts` (composite uniqueness)
- [ ] Create `src/core/userTracking.test.ts`
- [ ] Add new tests to package.json
- [ ] Verify: `npx tsc --noEmit` + `npm test`

### Commit 4 — Channel relay (publish + capture)

- [ ] Create `src/core/relayPublish.ts` + `.test.ts` — `publishToChannelAndCapture(channelId, body, entryId) → {channel_message_id}`
- [ ] Create `src/core/relayCapture.ts` + `.test.ts` — handler matching `is_automatic_forward: true` against pending DB rows by `forward_from_message_id`
- [ ] `.env.example` add `TELEGRAM_CHANNEL_ID`, `VV_RELAY_ENABLED`
- [ ] `src/server.ts` extend `/healthz` with `channel.stale_relay_rows` count
- [ ] Wire into existing publish flow gated by `VV_RELAY_ENABLED=true`
- [ ] Add new tests to package.json
- [ ] Verify: `npx tsc --noEmit` + `npm test`

### Commit 5 — Locked text + chat-moderation refactor (5a, shipped)

Scoped down from v6 §11 commit 5 to the additive, low-risk subset. The
wizard refactor + multi-bot dispatch are deferred to commit 5b (below)
because they touch the V3 DM state machine and webhook routing.

- [x] `src/core/archive.ts`: V3.5 locked-text builders added as **new
      functions** alongside the existing V3 builders (no V3 shape changes):
  - [x] `buildVouchProsePromptText`
  - [x] `buildPreviewTextV35` (new — V3 `buildPreviewText` unchanged)
  - [x] `buildPublishedDraftTextWithUrl` (new — V3 `buildPublishedDraftText` unchanged)
  - [x] `buildLookupBotShortDescription`, `buildLookupBotDescription`
  - [x] `buildAdminBotShortDescription`, `buildAdminBotDescription`
  - [x] `buildAccountTooNewText`
  - [x] `buildModerationWarnText`
- [x] `src/core/archiveUx.test.ts`: locked-text assertions for every new builder
- [x] `src/core/chatModeration.ts`: refactor inline DM strings to call
      `buildModerationWarnText`. Reads `TELEGRAM_ADMIN_BOT_USERNAME` env
      var to point users at the admin bot when configured
- [x] `.env.example`: multi-bot env vars staged in commit 4

### Commit 5b — Wizard prose + account-age guard + channel relay

**Architecture revision (2026-04-27):** v6 originally specced multi-bot
(ingest + lookup + admin) and 4 forum topics. Both dropped per user
direction. Impenetrability comes from the **channel-as-recovery-asset
pattern + member-list export + account-age guard + prose body** — not
from bot count. Splitting bots is plumbing, not structural redundancy at
our scale.

Final v6 stack:

- 1 custom bot (ingest, with admin commands + moderation built in)
- 2 off-the-shelf (captcha + sangmata)
- Forum-mode supergroup linked to a channel
- 3 topics: Vouches (General, auto-forward target) | Chat | Banned Logs
- Native Telegram search handles discovery; `/search` and `/recent`
  stay in ingest as V3-archive shims and become redundant after the
  operator runs `npm run replay:to-telegram` to backfill legacy.

Done sub-commits:

- [x] **5b-1** — `awaiting_prose` DraftStep + `validateVouchProse` /
      `classifyVouchProseMessage` / `buildVouchProseRejectionText` +
      migration 0012 (vouchDrafts.body_text). 12 tests.
- [x] **5b-2** — `extractUpdateUserId` pure helper +
      `recordUserFirstSeen` fired-and-forgotten in
      `processTelegramUpdate` after the idempotency reservation. 9 tests.
- [x] **5b-3** — Account-age guard at wizard start; prose-collection
      step wired into all three → preview transitions when
      `VV_RELAY_ENABLED=true`; new `awaiting_prose` text handler.

Remaining:

- [ ] **5b-4** — Channel relay publish + capture wiring under
      `VV_RELAY_ENABLED`. State machine: `pending` →
      `channel_published` → `published`. `classifyAutoForward` matches
      the auto-forwarded supergroup message back to the channel-side
      row by `forward_origin.message_id`. Confirm action picks up
      `bodyText` from the draft and routes through
      `publishToChannelAndCapture` instead of the V3 direct-supergroup
      path.
- [ ] **5b-5** — Update CLAUDE.md + opsec.md + v6 spec to reflect the
      simplification (single ingest bot, 3-topic plan, native-search-
      as-canonical read path, no separate lookup or admin bot in v6).

Dropped (out of scope for v6 set-and-forget):

- ❌ Multi-bot dispatch (3-path webhook)
- ❌ `src/core/lookupBot.ts`
- ❌ `src/core/adminBot.ts`
- ❌ `multiBotDispatch.test.ts`
- ❌ `TELEGRAM_LOOKUP_TOKEN` / `TELEGRAM_ADMIN_TOKEN` env vars

If a specific failure mode justifies splitting bots later, provision
the new bot then with a fresh spec/plan. Don't pre-build it.

### Commit 6 — Member-list export script

- [ ] Create `scripts/exportMemberContacts.ts` (CSV to stdout: `telegram_id, username, first_seen, last_seen`)
- [ ] Add `npm run export:members` to package.json
- [ ] Verify: script runs against local DB and produces well-formed CSV

### Commit 7 — Mass-forward replay capability

- [ ] Write `migrations/0010_replay_log.sql`:
  - [ ] `replay_log (id BIGSERIAL PK, replay_run_id UUID, source_chat_id BIGINT, source_message_id INTEGER, destination_chat_id BIGINT, destination_message_id INTEGER, replayed_at TIMESTAMPTZ DEFAULT NOW())`
  - [ ] Unique on `(replay_run_id, source_chat_id, source_message_id, destination_chat_id)`
- [ ] Create `src/core/replayToTelegram.ts` + `.test.ts` — `replayChannelArchive(sourceChannelId, destinationChatId, options)`. Uses Bot API `forwardMessages` (plural, 100/call), throttle ≤25 msgs/sec, idempotent via `replay_log`
- [ ] Create `scripts/replayToTelegramAsForwards.ts` (operator CLI)
- [ ] Add `npm run replay:to-telegram` to package.json
- [ ] Add new tests to package.json
- [ ] Verify: idempotency (rerun skips), rate-limit handling, batch boundaries

## Verification gates

Per-commit:
- `npx tsc --noEmit` clean
- `npm test` all green

Backwards-compat (operator hasn't done multi-bot setup yet):
- With `VV_RELAY_ENABLED=false`, `TELEGRAM_LOOKUP_TOKEN` unset, `TELEGRAM_ADMIN_TOKEN` unset → bot behaves byte-identically to pre-change

End-to-end (after commits 4 + 5 + 7):
- Reviewer DMs ingest bot → wizard → channel publish → auto-forward → DB row at `status='published'` with both `channel_message_id` and `supergroup_message_id`
- `/search @vendor` from supergroup → lookup bot responds
- Admin DM `/freeze @user` → freeze applies, audit row tagged with admin bot's identity
- Account first-seen <24h → wizard rejects with `buildAccountTooNewText()`
- `npm run export:members` produces CSV
- `npm run replay:to-telegram --destination-chat-id <id>` re-publishes archive

## Stop conditions

Stop after firm goals (1.5, 1, 2, 3) if:
- Test failures cascade beyond simple fixes
- Context is tightening
- An assumption breaks that requires re-spec

Resume from this plan via `/superpowers:executing-plans` in a fresh session.
