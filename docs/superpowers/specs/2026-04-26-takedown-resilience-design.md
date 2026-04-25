# VouchVault — Takedown-Resilience Hardening

**Status:** v1
**Owner:** @jbot-bit
**Date:** 2026-04-26
**Builds on:** `2026-04-25-vouchvault-redesign-design.md` (V3)

## 0. One-paragraph summary

This chunk hardens VouchVault and its host group against Telegram's increasingly aggressive 2026 takedown enforcement, without changing how the community feels day-to-day. Pavel Durov's ongoing French criminal case (12+ charges, 10-year sentences each, mandatory cooperation conditions) has driven Telegram's daily takedowns from a 10–30K baseline to 80–140K (peaks >500K), with most actions automated and human appeal slow or denied. The risk to a private community like VouchVault isn't bot use itself; it's a combination of (a) coordinated mass-report attacks, (b) ML keyword fingerprinting trained on marketplace patterns, and (c) bot-platform visual signature. This spec lands the smallest credible code surface that materially increases survivability — defensive infrastructure plus a one-word copy fix — and documents the manual hardening posture and disaster-recovery procedure separately. Audience interaction (reactions) happens organically via Telegram's native UI without any additional code.

## 1. Goals & non-goals

### Goals

- Detect when the bot's host group has been killed and surface it to admins immediately rather than silently failing.
- Detect bot-account-level Telegram problems (rate-limit, full ban) separately from group-level problems via `/readyz`.
- Surface early warning signs of coordinated brigading (member-velocity alert).
- Lower the bot's ML-keyword fingerprint by one borderline word.
- Document the manual hardening posture and disaster-recovery procedure as a runbook so any admin can execute either without code changes.
- Trim the bot's visible BotFather command menu to a minimal neutral set.

### Non-goals (this chunk)

- **Recording reaction counts in the DB.** Native Telegram reactions on bot posts already work; community gets the audience-signal value for free. Recording is deferred until we have a feature (digest, `/me` reaction-totals) that needs the data.
- **`/me`, `/digest`, `/respond` commands.** All deferred to a follow-up chunk.
- **Automated migration to a backup group.** Re-pointing the bot is a redeploy with a changed env var, documented in the runbook. No new admin command.
- **Live-DB-to-export-JSON helper script.** Replaced by a documented `psql` recipe in the runbook.
- **`exactOptionalPropertyTypes`, multi-language, web-app, leaderboards, dispute flow** — all stay deferred per the V3 spec §20.

### Success criteria

- A group takedown does not result in silent bot failure; admins are paged within one webhook cycle.
- A `getMe` failure (bot account banned, network partition) does not register as `/readyz` 200.
- Member-velocity alert fires for a synthetic test of 5+ joins or 3+ leaves in a 60-min window, and is suppressed for 60 min after firing.
- The locked V3 welcome / pinned guide / bot description copy contains zero terms in the marketplace ML cluster (verify, verified, trusted, seller, etc.).
- Anyone with admin DB access can produce a Telegram-export-shaped JSON of live entries using only the documented `psql` recipe.
- The bot's BotFather command menu lists only commands a regular member should reasonably see.

## 2. Threat model (informational)

Source: research synthesis, April 2026. See §9 for citations.

The threats are ranked by realistic frequency and impact for a small private community:

1. **Coordinated mass-report attack.** Mass-report-as-a-service is openly sold on Telegram. 50–100 accounts hitting Report on a target group reliably produces takedown action within 24–48 hours. Reports under the DMCA category have an 89% success rate within 72 hours regardless of underlying merit.
2. **ML keyword/pattern hit.** Telegram's automated moderation is trained on the dropbot/marketplace ecosystem the platform is legally compelled to suppress. Communities sharing vocabulary clusters with that ecosystem have an elevated false-positive rate, with documented cases of legitimate communities (e.g. It's FOSS, October 2025) deleted overnight without successful appeal.
3. **Insider report.** A member negatively vouched, or a former admin, hits Report from inside.
4. **Behavioral fingerprint** (vendor-claimed, weakly sourced). Uniform timing, identical message structure, lack of human variance.

Telegram's official policy describes "all such reports are also checked by human moderators" but the daily takedown volume (averaging 110K, peaks >500K) makes meaningful human review of every action mathematically impossible. The pipeline is AI-first with humans sampled in. Appeals exist (`recover@telegram.org`, `@SpamBot`, in-app support) but are slow and largely ineffective for restoring deleted groups.

Telegram bots are **not** a moderation trigger themselves. Bot-platform-shaped *visual signature* (many inline buttons per post, identical templated entries, deep-link onboarding flows clustered with marketplace vocabulary) increases the report attack surface and the ML fingerprint score.

## 3. Items in this chunk

### 3.1 Vocabulary fix

**Problem.** The V3-locked welcome / pinned guide / bot description copy contains the word **verify** in the phrase `Log and verify local-business service experiences with the community.` This word is in the marketplace ML cluster (verify, verified, certified, approved). The rest of the locked copy is already clean (no seller, buyer, deal, escrow, payment, vendor, merchant, trusted, premium, certified, guarantee, warranty, exchange, crypto, etc.).

**Change.** Replace `verify` with `review`:

```
- Log and verify local-business service experiences with the community.
+ Log and review local-business service experiences with the community.
```

Affects three V3-locked functions in `src/core/archive.ts`:

- `buildWelcomeText`
- `buildPinnedGuideText`
- `buildBotDescriptionText`

`buildBotShortDescription` does not use this phrase; no change.

**Spec amendment.** This is a permitted edit to V3-locked text per `CLAUDE.md` (locked-copy edits require a spec change first). This document is that spec change. Locked-text tests in `src/core/archiveUx.test.ts` must be updated in the same commit.

**Bot identity refresh.** Bot description and short description are pushed to BotFather via `npm run telegram:onboarding`. This must be re-run after deploy so BotFather reflects the change.

### 3.2 `/readyz` `getMe` probe

**Problem.** `/readyz` currently checks DB connectivity only. A Telegram-side problem (bot token revoked, account-level ban, hard rate limit) returns 200 because the DB is fine.

**Change.** Add a Telegram `getMe` call to `/readyz`. If it succeeds, return 200 as today. If it fails for any reason, return 503 with `{ ok: false, error: <message> }`. Honour the existing 5-second connection budget; `getMe` should not introduce its own timeout beyond a guard against hung sockets.

The probe runs after the existing DB probe and is gated behind a `process.env.TELEGRAM_BOT_TOKEN?.trim()` check so local environments without the token don't break.

### 3.3 `TelegramChatGoneError` → admin DM

**Problem.** When the bot tries to post to a chat that has been deleted by Telegram or otherwise made unreachable, the typed `TelegramChatGoneError` (shipped in V3 chunk 18.1) propagates up through the webhook handler. It is caught by the generic 500-handler and logged, but admins are not paged and the bot retries on the next update.

**Change.** The existing `chat_settings.status` column already has values `'active' | 'kicked' | 'migrated_away'`. Add a fourth value, `'gone'`, with semantics "the chat returned `chat not found` from Telegram, presumed deleted." **No migration required.**

In `src/telegramBot.ts:processTelegramUpdate`, the outer `try/catch` adds a branch:

```ts
} catch (error) {
  if (error instanceof TelegramChatGoneError) {
    await handleChatGone(chatIdFromContext, logger);
    return; // do not re-throw; update is "handled" from Telegram's view
  }
  // ... existing release + rethrow ...
}
```

The new helper `handleChatGone(chatId, logger)` (in a new small module `src/core/chatGoneHandler.ts`) does:

1. `setChatGone(chatId)` via a new helper in `chatSettingsStore.ts`, idempotent, writes `status='gone'`.
2. **If the row was newly transitioned to `'gone'`** (i.e. it wasn't already `'gone'`), DM every entry in `TELEGRAM_ADMIN_IDS` with: `Group <chatId> appears to have been deleted by Telegram. Bot has stopped posting there. See docs/runbook/opsec.md for migration steps.`
3. Records an `admin_audit_log` entry with `command='system.chat_gone'`, `targetChatId=<chatId>`.
4. Existing handler-side guards that already check `isChatKicked` are extended (or replaced with a unified `isChatDisabled(chatId)` that returns true for both `kicked` and `gone`) so subsequent updates short-circuit before any outbound call.

The "newly transitioned" check makes the DM idempotent — repeated `chat not found` errors from queued webhook updates do not page admins twice.

**Identifying the offending chat.** `TelegramChatGoneError` carries the API-level error description but not the `chat_id` we attempted to post to. The catch site needs to know it. Two options at implementation time:
- Pass the `chatId` through the error (extend the typed error class with an optional `chatId` field, populated by the `withTelegramRetry`-wrapped sends).
- Inspect the originating update payload and use `payload.message?.chat?.id` etc.

The first option is cleaner and is the chosen approach. This is a minor refinement to `typedTelegramErrors.ts` and the four public sends in `telegramTools.ts`.

### 3.4 Member-velocity alert

**Problem.** A coordinated brigading attack typically shows up as a wave of `my_chat_member` updates in a short window — either many new members joining (to report from inside) or existing members leaving en masse (after seeing a coordinated complaint). The bot already subscribes to `my_chat_member` for the supergroup-migration / kicked-bot logic; this is a layer on top of that.

**Change.** Add an in-process rolling-window counter:

- For each `(chatId, kind)` where `kind ∈ {'join', 'leave'}`, store an in-memory array of timestamps from the last 60 minutes. Old entries are pruned on every push.
- On `my_chat_member` update where the *member* (not the bot itself) changed status, push a timestamp into the appropriate array.
- After each push, if the array length crosses a threshold (`5+` joins or `3+` leaves in the window), DM all admins with: `Member-velocity alert in <chatId>: <N> joins / <M> leaves in last 60 min. Possible brigading. See docs/runbook/opsec.md.`
- After firing, suppress further alerts for the same `(chatId, kind)` for 60 minutes (in-memory `nextAlertAfter[chatId+kind] = now+60min`).

State is in-memory only and resets on deploy. This is intentional — the alert is a heuristic, and a fresh window after deploy is acceptable. No DB changes.

`my_chat_member` updates for *user* members (not the bot) require the existing `allowed_updates: [..., "my_chat_member"]` plus `"chat_member"` in the webhook config. **Adding `"chat_member"` to `allowed_updates` is part of this chunk.** This requires the bot to be a group admin, which it already is.

**Test.** Synthetic unit test: feed N fake `my_chat_member` updates into the velocity tracker, assert alert fires and is suppressed correctly.

### 3.5 Bot command menu cleanup

**Problem.** `scripts/configureTelegramOnboarding.ts` registers a list of commands via `setMyCommands`. Anything in that list shows up in the BotFather `/` menu inside Telegram, contributing to the bot's visible footprint. Admin-only commands should never be in this list.

**Change.** Audit and reduce the `setMyCommands` payload to the minimal user-facing set:

- `/start` — DM-only welcome
- `/cancel` — abandon current vouch flow
- `/help` — short usage reminder

Admin commands (`/freeze`, `/unfreeze`, `/frozen_list`, `/remove_entry`, `/recover_entry`, `/profile`, `/lookup`, `/pause`, `/unpause`, `/admin_help`) are removed from the menu. They continue to work when typed; they just don't appear in the BotFather slash-popup. Admins know them or run `/admin_help`.

If the current menu already matches this set, no change beyond verification.

### 3.6 OPSEC runbook

**New file.** `docs/runbook/opsec.md`. Plain documentation, no code. Sections:

1. **Threat model** — short version of §2 above.
2. **Manual Telegram-side hardening checklist:**
   - Group set to private supergroup with **Request-to-Join + manual admin approval**.
   - Member permissions: cannot add new members, cannot change group info, cannot pin messages.
   - Slow mode enabled (configurable, recommend 10s).
   - Restrict media: members may post text and reactions only; only admins post images/files (reduces ML keyword density risk on member-uploaded content).
   - Group avatar / name / description: keep generic and community-flavoured, no marketplace language.
   - Invite link rotation: retire old links every 30 days, distribute new via the bot's existing `/start` deep link.
3. **Backup group setup:**
   - Pre-create a second private supergroup with identical settings.
   - Pre-invite admins.
   - Document that "if you ever see the live group go, switch to <link>." (Distribute through bot DM, not external channels.)
4. **Migration procedure (live group → backup group):**
   - Update `TELEGRAM_ALLOWED_CHAT_IDS` in Railway Variables to the backup group's chat ID.
   - Service auto-redeploys.
   - Run `npm run telegram:onboarding -- --guide-chat-id <new-id> --pin-guide` to install the pinned guide and command menu in the new group.
   - Run `npm run telegram:webhook` to refresh the webhook (no URL change, but `getWebhookInfo` confirms health).
   - Optional: replay live DB entries into the new group via the SQL-to-JSON recipe (next section) plus `npm run replay:legacy`.
5. **SQL-to-export-JSON recipe (DR):**
   - A documented `psql` query that selects `vouch_entries` rows and shapes them into a Telegram-export-style JSON via `jsonb_build_object`.
   - Pipe to a file: `psql $DATABASE_URL -tAc "<query>" > export.json`.
   - Wrap in the export envelope (`{ "name": "Recovery", "type": "private_supergroup", "id": <id>, "messages": [...] }`) by hand or via a documented `jq` invocation.
   - Run `npm run replay:legacy export.json -- --target-chat-id <new-id> --throttle-ms 3100` to rehydrate.
   - **Important caveats:** legacy entries already replayed once will not be re-replayed (idempotency via `legacy_source_message_id`). Live entries posted directly via the DM flow are absent from the JSON; they must be exported separately or considered acceptable loss.
6. **Member-velocity alert response:**
   - When the alert fires, admins should: pause new vouches via `/pause`, review the join/leave list in Telegram's group log, identify whether new joins look like coordinated accounts, and either kick + ban or wait it out.
7. **Appeals contact:**
   - `recover@telegram.org`, `@SpamBot`, in-app support. Expected response time 1–7 days. Permanent bans are difficult to reverse.

## 4. Architecture & data flow

No architectural change. Small additions:

- New value `'gone'` for the existing `chat_settings.status` column. **No migration.**
- New helper `setChatGone(chatId)` in `chatSettingsStore.ts` (mirrors `setChatKicked`).
- New helper `isChatDisabled(chatId)` in `chatSettingsStore.ts` returning true for `status ∈ {'kicked', 'gone', 'migrated_away'}`. Existing `isChatKicked` callers migrate to this where the broader semantic applies.
- New module `src/core/chatGoneHandler.ts` exporting `handleChatGone(chatId, logger)`.
- New in-memory module `src/core/memberVelocity.ts` exporting `recordMemberEvent(chatId, kind)` and used from the existing `my_chat_member`/`chat_member` handler.
- New `TelegramChatGoneError` catch in `processTelegramUpdate`'s outer `try/catch`.
- `TelegramChatGoneError` (and `TelegramApiError` baseclass) gain an optional `chatId?: number` field, populated by the four public sends in `telegramTools.ts` from the input `chatId`.

Outbound Telegram calls keep going through `src/core/tools/telegramTools.ts` and the existing `withTelegramRetry` wrapper. The new error handling wraps the outer try/catch, not the inner retry loop, so the existing single-retry behaviour on rate-limits is preserved before the typed error propagates.

## 5. Test plan

| File | What it asserts |
|---|---|
| `src/core/memberVelocity.test.ts` (new) | 5 joins in 60 min triggers alert; 6th does not re-trigger; suppression expires after 60 min; leaves count separately. |
| `src/core/archiveUx.test.ts` (existing, updated) | "review" in the three locked-copy outputs; "verify" no longer present. |
| `src/core/chatGoneHandler.test.ts` (new) | Newly transitioned `'gone'` row triggers admin DM exactly once; subsequent `handleChatGone` calls for the same chat are no-ops. |
| Manual / smoke | `/readyz` returns 503 when `TELEGRAM_BOT_TOKEN` is invalid; returns 200 when valid; existing DB-down branch still 503. |
| Manual / smoke | Synthetic `TelegramChatGoneError` (e.g. via a non-existent chat ID injected as the launcher chat) DMs admins exactly once and sets `disabled_at`. |

No e2e test for the full takedown flow — that would require simulating a Telegram-side group deletion, which is out of scope.

## 6. Migration & rollout

- No migration required (`status='gone'` reuses existing `chat_settings.status` column).
- After deploy, run `npm run telegram:onboarding -- --guide-chat-id <id>` once to push the updated bot description and the trimmed slash-command menu to BotFather.
- After deploy, run `npm run telegram:webhook` once to add `chat_member` to `allowed_updates`.
- Manual hardening checklist (`opsec.md` §2) is the operator's responsibility; nothing in the code enforces Request-to-Join etc.
- Backup group setup is a one-time manual step; document the chosen backup chat ID privately in `.env.local` for future reference (commented-out, not loaded).

## 7. Out of scope (deferred to next chunks)

- **Reactions recording in DB** — defer until a feature needs it.
- **`/me` DM command** — defer.
- **`/digest` admin DM command** — defer.
- **`/respond` for vouch targets** — defer; revisit after observing whether native reactions give targets enough audience signal.
- **Automated migration command (`/migrate_to`)** — defer; manual env-var change suffices for v1.
- **Live-DB-to-export-JSON helper script** — replaced by the documented `psql` recipe in the runbook.
- **`exactOptionalPropertyTypes`, multi-language, web-app, leaderboards, dispute flow** — remain deferred per V3 §20.

## 8. Open questions

None at spec time. Implementation may surface specifics around:

- Exact `setMyCommands` payload set (verify against current `configureTelegramOnboarding.ts`).
- Whether `chat_member` updates require the bot to be a group admin (Telegram doc says yes; bot already is).
- Whether the BotFather menu changes propagate per-language; if so, repeat the call for each set language.

These are implementation details, resolvable while writing the plan.

## 9. Sources

- [Wikipedia — Arrest and indictment of Pavel Durov](https://en.wikipedia.org/wiki/Arrest_and_indictment_of_Pavel_Durov)
- [NBC News — Durov charged by French prosecutors](https://www.nbcnews.com/tech/tech-news/telegram-ceo-pavel-durov-charged-french-prosecutors-rcna168603)
- [Pravda France — 12+ charges, 10-year sentences (April 2026)](https://france.news-pravda.com/en/world/2026/04/20/93305.html)
- [Telegram official Spam FAQ](https://telegram.org/faq_spam)
- [Telegram Moderation Overview](https://telegram.org/moderation)
- [Check Point Research — Telegram Crackdown 2026](https://blog.checkpoint.com/research/telegrams-crackdown-in-2026-and-why-cyber-criminals-are-still-winning/)
- [Cybernews — record takedown numbers 2025–26](https://cybernews.com/security/telegram-channels-takedown-criminal-activity/)
- [It's FOSS — legitimate community ban case study](https://itsfoss.com/news/telegram-unfair-community-ban/)
- [Bot API — message reactions](https://core.telegram.org/bots/api#messagereactionupdated)
- [Bot API — chat_member updates](https://core.telegram.org/bots/api#chatmemberupdated)
- VouchVault V3 spec: `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md`
