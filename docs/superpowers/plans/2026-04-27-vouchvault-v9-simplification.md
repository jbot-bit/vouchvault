# VouchVault v9 simplification — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md`

**Goal:** Strip the DM wizard + templated bot publish path. Members post vouches as normal group messages. Bot mirrors every group message into a backup channel via `forwardMessage`. DM `/lookup` opens to members for legacy V3 archive search. Net result: ~30% smaller `telegramBot.ts`, ~50% smaller `archive.ts`, V3 templated-publish vector structurally impossible.

**Decisions locked (spec §10):** mirror via `forwardMessage` (not `copyMessage`). DB row creation for new member-posted vouches deferred — `/lookup` returns legacy data only in v9 v1.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node `node:test`, drizzle-orm, Postgres, pino, Telegram Bot API via `src/core/tools/telegramTools.ts`.

**Conventions (per CLAUDE.md):**
- Tests live alongside source: `src/core/<name>.ts` ↔ `src/core/<name>.test.ts`.
- New `*.test.ts` must be appended to `scripts.test` in `package.json` or it won't run.
- Commits: `feat(scope): ...` / `fix(scope): ...` / `docs(scope): ...` / `refactor(scope): ...`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't push without explicit ask.
- Each phase below = one PR. Merge in order; system stays working between phases.

---

## File structure summary

| File | Phase | Status | Responsibility |
|---|---|---|---|
| `migrations/0014_mirror_log.sql` | 1 | **Create** | `mirror_log` table for forward idempotency |
| `src/core/mirrorPublish.ts` | 1 | **Create** | Pure helper: `shouldMirror`, mirror-log read/write |
| `src/core/mirrorPublish.test.ts` | 1 | **Create** | Pure helper tests |
| `src/core/tools/telegramTools.ts` | 1 | Modify | Add `forwardTelegramMessage` wrapper |
| `src/telegramBot.ts` | 1, 2, 3 | Modify | Wire mirror; open DM `/lookup`; delete wizard |
| `src/server.ts` | 1 | Modify | Add backup-channel validation in `/readyz` |
| `src/core/bootValidation.ts` | 1 | Modify | Validate `TELEGRAM_BACKUP_CHANNEL_ID` + bot is post-permitted |
| `src/core/bootValidation.test.ts` | 1 | Modify | Cover new validation |
| `.env.example` | 1 | Modify | `TELEGRAM_BACKUP_CHANNEL_ID` |
| `package.json` | 1 | Modify | Append `mirrorPublish.test.ts` |
| `src/telegramBot.ts` | 2 | Modify | Open DM `/lookup` to members; rate-limit |
| `src/core/lookupRateLimit.ts` | 2 | **Create** | Token-bucket for member lookups |
| `src/core/lookupRateLimit.test.ts` | 2 | **Create** | Unit tests |
| `src/core/archive.ts` | 3 | Modify | Delete `buildArchiveEntryText`, `fmtVouchHeading`, `buildPreviewText`, `buildPublishedDraftText`, wizard prompts; rewrite welcome/pinned/profile copy |
| `src/core/archivePublishing.ts` | 3 | Delete or trim | Templated publish orchestration |
| `src/core/relayPublish.ts` | 3 | Delete | Templated channel-relay (mirror replaces it) |
| `src/core/archiveUx.test.ts` | 3 | Modify | Drop wizard tests; update locked-text tests |
| `src/core/callbackData.test.ts` | 3 | Modify | Drop wizard callback prefixes |
| `docs/runbook/opsec.md` | 4 | Modify | §18–§20 updated to v9 reality; add mirror-channel section |
| `DEPLOY.md` | 4 | Modify | Drop wizard onboarding; add mirror-channel setup; revise post-deploy §9–10 |
| `CLAUDE.md` | 5 | Modify | Remove DM-flow state machine refs; add member-post+bot-mirror summary; trim spec-locked text section |

---

## Phase 1 — Mirror channel via `forwardMessage` (wizard still on)

**Goal of phase:** every group message gets forwarded to the backup channel, idempotently. Wizard remains live; ship-able as-is. Reversible if `forwardMessage` behaves unexpectedly.

### Task 1.1: Migration + mirror-log table
- [ ] Create `migrations/0014_mirror_log.sql`:
  - Columns: `group_chat_id BIGINT NOT NULL`, `group_message_id BIGINT NOT NULL`, `channel_message_id BIGINT NOT NULL`, `forwarded_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
  - `UNIQUE(group_chat_id, group_message_id)` — idempotency key.
- [ ] Regenerate drizzle snapshot via `npx drizzle-kit generate` (or matching command in `package.json`).

### Task 1.2: Telegram tool wrapper
- [ ] In `src/core/tools/telegramTools.ts`, add `forwardTelegramMessage({ fromChatId, toChatId, messageId })`. Wraps `callTelegramAPI('forwardMessage', ...)` with `withTelegramRetry`. Returns `{ message_id }` of the new channel post.
- [ ] Throws typed errors per `typedTelegramErrors.ts` (403 if bot not in channel, 400 if message-gone).

### Task 1.3: Mirror module
- [ ] Create `src/core/mirrorPublish.ts`:
  - `shouldMirror(update)` → boolean. Returns true if message is a non-bot, non-via_bot member post in an allowed group.
  - `recordMirror(db, { groupChatId, groupMessageId, channelMessageId })` → upsert with conflict-do-nothing.
  - `wasAlreadyMirrored(db, { groupChatId, groupMessageId })` → boolean check before forwarding.
- [ ] Create `src/core/mirrorPublish.test.ts` covering `shouldMirror` (skip bot senders, skip via_bot, accept members).

### Task 1.4: Wire mirror into update handler
- [ ] In `src/telegramBot.ts` `handleGroupMessage`, after `runChatModeration` (which may have deleted the message), check `shouldMirror`. If yes and not already mirrored, call `forwardTelegramMessage` then `recordMirror`. Best-effort — wrap in try/catch and log; do not block other handlers.
- [ ] Skip mirror if `runChatModeration` deleted the message (lexicon hit).

### Task 1.5: Boot validation
- [ ] Add env var `TELEGRAM_BACKUP_CHANNEL_ID` to `.env.example` with comment.
- [ ] In `src/core/bootValidation.ts`, validate the env var is set and parses as a negative integer (channel id).
- [ ] In `src/server.ts` `/readyz`, add a check that the bot has post permission in the backup channel (`getChatMember(channel, bot)` returns admin with `can_post_messages`).
- [ ] Update `src/core/bootValidation.test.ts`.

### Task 1.6: Test wiring
- [ ] Append `src/core/mirrorPublish.test.ts` to `scripts.test` in `package.json`.
- [ ] Run `npm test`. All green.
- [ ] Run `npx tsc --noEmit`. Clean.

### Task 1.7: Commit
- [ ] `feat(mirror): forward every group message to backup channel (v9 phase 1)`.
- [ ] PR open + CI green + merge.

---

## Phase 2 — Open DM `/lookup` to members

**Goal of phase:** any member can DM the bot `/lookup @user` and receive the legacy V3 archive entries (POS / MIX / public NEG only — no `private_note`, no admin-only NEG). Rate-limited to 1 lookup per 5 seconds per user.

### Task 2.1: Rate-limit module
- [ ] Create `src/core/lookupRateLimit.ts`:
  - In-memory token bucket keyed by `user_id`. 1 token capacity, refill 1 token per 5s.
  - `tryConsume(userId)` → `{ allowed: true } | { allowed: false, retryAfterMs: number }`.
- [ ] Create `src/core/lookupRateLimit.test.ts` covering refill timing, denial under burst.

### Task 2.2: Open DM `/lookup`
- [ ] In `src/telegramBot.ts` DM `/lookup` handler:
  - Remove admin-only gate.
  - Call `tryConsume(userId)`. If denied, reply `"Hold on — try again in N seconds."` and return.
  - Reuse existing `buildLookupText` rendering, but pass a `member` flavour that excludes `private_note` and admin-only NEGs.
- [ ] Group `/lookup` stays admin-only — no change.

### Task 2.3: Test wiring
- [ ] Append `src/core/lookupRateLimit.test.ts` to `scripts.test`.
- [ ] `npm test` + `npx tsc --noEmit`. Green.

### Task 2.4: Commit
- [ ] `feat(lookup): open DM /lookup to all members with rate-limit (v9 phase 2)`.
- [ ] PR + CI + merge.

---

## Phase 3 — Delete the wizard

**Goal of phase:** templated bot publishing ceases to exist. `/start` returns an explainer instead of starting a wizard. ~30% reduction in `telegramBot.ts`, ~50% reduction in `archive.ts`. **This is the biggest phase. Bisect via TDD: deletions first, then test updates, then verify.**

### Task 3.1: Delete templated builders in `archive.ts`
- [ ] Delete: `buildArchiveEntryText`, `fmtVouchHeading`, `buildPreviewText`, `buildPublishedDraftText`, all wizard prompt builders (`buildTargetPrompt`, `buildResultPrompt`, `buildTagsPrompt`, etc.), `buildVouchProsePromptText`.
- [ ] Keep: `withCeiling`, `buildLookupText`, `buildRecentEntriesText` (lookup still uses them), `fmtDate`.
- [ ] Rewrite `buildWelcomeText`: short, describes member-post + DM `/lookup` flow.
- [ ] Rewrite `buildPinnedGuideText`: same.
- [ ] Rewrite `buildBotDescriptionText` + `buildBotShortDescription`: bot is search + admin-tool, not publisher.

### Task 3.2: Delete templated publish path
- [ ] Delete `src/core/archivePublishing.ts` (or trim to nothing if it's pure templated-send orchestration).
- [ ] Delete `src/core/relayPublish.ts` — mirror via `forwardMessage` replaces this entirely.
- [ ] Remove all `VV_RELAY_ENABLED` references from code; deprecate the env var (leave entry in `.env.example` as `# (deprecated v9)` for one release, then remove).

### Task 3.3: Delete wizard state machine
- [ ] In `src/telegramBot.ts`, delete the DM-wizard handler chain (state transitions, button callbacks, draft persistence).
- [ ] Replace DM `/start` with a brief explainer: post in @group, DM `/lookup @user` to search legacy. Link the host group invite.
- [ ] Delete callback handlers for wizard buttons (target/result/tags/preview/publish callbacks).

### Task 3.4: Update tests
- [ ] In `src/core/archiveUx.test.ts`: delete wizard prose, preview, published-draft tests. Update locked-text tests to assert new welcome/pinned/profile copy.
- [ ] In `src/core/callbackData.test.ts`: drop wizard callback prefixes from the under-64-byte coverage.
- [ ] Hunt down any other test referencing deleted builders. Delete or update.

### Task 3.5: Verify deletions are clean
- [ ] `npx tsc --noEmit` — should surface every dangling caller. Fix until clean.
- [ ] `npm test` — all green.
- [ ] Grep for `wizard`, `buildArchiveEntryText`, `relayPublish`, `archivePublishing` in `src/`. Should be zero hits except in deleted-file imports already cleaned up.

### Task 3.6: Commit
- [ ] `refactor(wizard): delete templated bot publish path (v9 phase 3)`. Big diff but mostly deletions.
- [ ] PR + CI + merge.

---

## Phase 4 — Runbook updates

**Goal of phase:** `docs/runbook/opsec.md` and `DEPLOY.md` reflect the v9 reality.

### Task 4.1: Update `docs/runbook/opsec.md`
- [ ] §18 (group-type posture): unchanged target (private_group), but update rationale — bot is no longer the primary content publisher; group-type choice now also reflects member-posting model.
- [ ] §19 (bot privacy-mode): reaffirm privacy-OFF (mirror needs message visibility, same as moderation).
- [ ] §20 (identity-surface audit): drop wizard-flow audit items; add mirror-channel audit (channel post permission, forward-shape verification).
- [ ] Add new section: **§21 Mirror channel posture** — backup channel id, post-permission check, recovery via `replay:to-telegram` from the channel.

### Task 4.2: Update `DEPLOY.md`
- [ ] Drop `npm run telegram:onboarding` if it set wizard-related bot description (otherwise keep, just confirm copy is post-v9).
- [ ] Add backup-channel setup section: create channel, add bot as admin with post permission, set `TELEGRAM_BACKUP_CHANNEL_ID`.
- [ ] §9–§10 (post-deploy): drop "verify wizard end-to-end"; add "verify mirror produces a forward in backup channel."
- [ ] §14 (e2e checklist): rewrite for v9 flow — member posts in group → forward appears in channel → moderation deletes lexicon hit and skips mirror → DM `/lookup` returns legacy data.

### Task 4.3: Commit
- [ ] `docs(runbook): align opsec + DEPLOY with v9 (phase 4)`.
- [ ] PR + merge (no code changes; CI still validates docs touched no broken refs).

---

## Phase 5 — `CLAUDE.md` update

**Goal of phase:** project guide tells the truth about v9 architecture so future-Claude doesn't keep rebuilding the wizard.

### Task 5.1: `CLAUDE.md` rewrite
- [ ] Top blurb: replace "Group launches a DM flow, reviewer submits a vouch (target + result + tags), bot publishes a clean entry back to the group" with v9 flow: "Members post vouches as normal group messages. Bot mirrors every group message into a backup channel for takedown resilience. DM `/lookup @user` searches the legacy V3 archive."
- [ ] Project-layout section: drop `archivePublishing.ts`, `relayPublish.ts` from the file list. Add `mirrorPublish.ts`, `lookupRateLimit.ts`.
- [ ] "Group post format" section: rewrite — there is no canonical bot-output format anymore; legacy entries are DB-only and rendered only via `/lookup`.
- [ ] "Spec-locked text" section: shrink to just the new welcome/pinned/profile builders. Drop deleted ones.
- [ ] "Telegram callback_data" section: drop wizard-callback discussion (still applies to remaining callbacks but the surface is small).
- [ ] "Storage / DB" section: add `mirror_log` to schema notes.
- [ ] "Telegram I/O" section: add `forwardTelegramMessage` to the public-sends list.
- [ ] Add new short section: **"v9 architecture summary"** — three sentences pointing at this spec + plan.

### Task 5.2: Commit
- [ ] `docs(claude): update project guide for v9 architecture (phase 5)`.
- [ ] PR + merge.

---

## Verification gates

After every phase, before merging:

- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] CI green on the PR
- [ ] Smoke-test the changed surface manually if it touches Telegram I/O

After phase 3 specifically:
- [ ] Manually verify in test group: post a message → forward appears in channel; lexicon hit → message deleted, no forward; DM `/lookup` from non-admin user returns legacy data, hits rate-limit on 2nd rapid call.

After phase 5:
- [ ] Re-read `CLAUDE.md` end-to-end. Anything still referring to the wizard is a bug.

---

## Rollback strategy

Each phase is one PR. Phases 1–3 are revertible by reverting the merge commit. Phase 1 alone is operationally safe to run in production without phases 2–3 (mirror runs alongside live wizard). Phase 2 is operationally safe without phase 3 (DM `/lookup` opens, wizard still works). Phase 3 is the point of no return for the wizard, but can be reverted by reverting the PR if `forwardMessage` mirror is shown insufficient.

If the new `forwardMessage` mirror produces unexpected classifier signal in observation, rollback path is: revert phase 3, mirror via templated send returns; or keep phase 3 and switch mirror from `forwardMessage` to `copyMessage` (one-line change in `forwardTelegramMessage`).
