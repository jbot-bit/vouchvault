# VouchVault — Claude guide

Telegram reputation bot, v9 shape. **Members post vouches as normal group messages** (free text, no wizard, no templated bot output). Bot mirrors every group message into a backup channel via `forwardMessage` for takedown resilience. Members DM `/lookup @username` to search the legacy V3 archive; admins get the full audit (private NEGs + `private_note`). Admin commands manage the group, freeze accounts, replay legacy data, run lexicon moderation.

## Commands

- `npm test` — runs the full suite (Node `--test` + `--experimental-strip-types`, no build).
- `npx tsc --noEmit` — type-check (CI runs this).
- `node --experimental-strip-types --check <file>` — quick syntax-only check on a single script.
- No build step. `.ts` runs directly via `--experimental-strip-types` in Node 22 (engines `>=20`).
- `npm test` runs an explicit list of test files in `package.json`. **When you add a new `*.test.ts`, append it to the `test` script** or it will not run.

## Project layout

- `src/core/` — pure logic: helpers, parsers, storage, validators. Renamed from `src/mastra/` (commit 62fb7b1) — never reintroduce the old path.
- `src/server.ts` — webhook entry. Wraps `processTelegramUpdate` in a 25s race so a slow handler can't trigger Telegram's retry loop. Also exposes `/healthz` and `/readyz`.
- `src/telegramBot.ts` — Telegram update handlers, command routing, member-post mirror, DM `/lookup`, admin commands. **No DM wizard** (deleted in v9 phase 3).
- `src/core/tools/telegramTools.ts` — every outbound Telegram call. Don't add new send logic elsewhere.
- `src/core/mirrorPublish.ts` + `src/core/mirrorStore.ts` — v9 backup-channel mirror: pure decision/config helpers + DB writes for `mirror_log`.
- `src/core/lookupRateLimit.ts` — per-user token bucket for member DM `/lookup`.
- `src/core/logger.ts`, `src/core/typedTelegramErrors.ts`, `src/core/withTelegramRetry.ts` — observability + Telegram I/O scaffolding (see sections below).
- `src/core/chatGoneHandler.ts`, `src/core/memberVelocity.ts` — takedown-resilience: chat-gone admin paging + brigade-detection alert (see "Takedown resilience" below).
- `migrations/` — drizzle-kit SQL. Append a new file; do not edit historical migrations.
- `scripts/` — one-off ops (`replayLegacyTelegramExport.ts`, `setTelegramWebhook.ts`, `configureTelegramOnboarding.ts`, `replayToTelegramAsForwards.ts`).
- `DEPLOY.md` — Railway deploy + post-deploy commands (§9–10). Single source of truth for the deploy-time runbook.
- `docs/runbook/opsec.md` — OPSEC posture (Request-to-Join, member permissions, backup group), takedown migration procedure, SQL→export-JSON DR recipe, member-velocity response playbook. §18 group-type posture (stay private_group), §19 bot privacy-mode posture (lexicon + v9 mirror need privacy-OFF), §20 identity-surface audit (pre-launch + quarterly), §21 v9 backup-channel mirror posture.
- `.env.example` — canonical env-var list with comments. `.env.local` is per-machine (gitignored), filled by hand.
- `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md` — **v9 spec (current).** Canonical for the member-post + bot-mirror architecture.
- `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` — V3 spec (historical, superseded by v9 in publish-path scope).
- `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md` — takedown-resilience spec (chat-gone, member-velocity, /readyz getMe, OPSEC).
- `docs/superpowers/plans/2026-04-27-vouchvault-v9-simplification.md` — v9 implementation plan (5 phases, all merged at the time of writing).
- `docs/superpowers/plans/2026-04-25-vouchvault-redesign.md`, `docs/superpowers/plans/2026-04-26-takedown-resilience.md` — V3 + takedown-resilience plans; checkboxes are **stale**, do not trust them as a "done" signal — derive completion from git history + file existence.

## TypeScript posture (strict)

- `strict: true` and `noUncheckedIndexedAccess: true`. Index access returns `T | undefined` — assert with `!` (after a length check), or guard with `if (x === undefined) continue;`.
- Tests live alongside the file under test (e.g. `src/core/archive.ts` ↔ `src/core/archiveUx.test.ts`).

## Spec-locked text (do not edit without spec change)

These functions render copy anchored to v9 (member-post + bot-mirror architecture). Updating their bodies requires updating the v9 spec first:

- `buildWelcomeText` — `src/core/archive.ts`
- `buildPinnedGuideText` — `src/core/archive.ts`
- `buildBotDescriptionText` — `src/core/archive.ts`
- `buildBotShortDescription` — `src/core/archive.ts`

Tests in `src/core/archiveUx.test.ts` cover these byte-stable. They describe the v9 flow: members post in group, DM `/lookup @user` to search legacy, native group search for new content. **Any return to "submit a vouch via DM wizard" wording is a regression** — the wizard was deleted in v9 phase 3.

## Group post format

There is no canonical bot-output format anymore. v9 deleted the templated `POS Vouch > @target` publish path. Members post vouches as plain group messages in their own words.

Legacy V3 entries live in the DB only (`status='published'`, `published_message_id IS NULL`) — never sent to Telegram. They surface only via `/lookup @username`, rendered by `buildLookupText` in `src/core/archive.ts`.

Date format for rendered dates is `dd/mm/yyyy` (`fmtDate`). JSON checkpoints, review-skip records, and `lastProcessedOriginalDate` keep ISO `yyyy-mm-dd` — do not unify the two.

## Legacy import quirks

- Manual-repost wrappers (`FROM: @user / id\nDATE: dd/mm/yyyy\n\n<body>`) are unwrapped in `parseLegacyExportMessage` to override the export-level sender + timestamp. `DELETED ACCOUNT` becomes a synthetic `legacy_<numericId>` reviewer.
- `botSenders` (env: `LEGACY_BOT_SENDERS`) is checked **only** against the export-level @username, before unwrap. The unwrapped reviewer is intentionally not re-checked — see the comment in `legacyImportParser.ts` near `tryUnwrapManualRepostHeader`.
- Sentiment/target/multi-target/caption/from_id fallback are all already wired (chunk 6 of the V3 plan).

## Telegram callback_data

Telegram caps `callback_data` at 64 bytes UTF-8. There is a test (`callbackData.test.ts`) that asserts every callback string the bot can build stays under that. **If you add a new callback prefix or templated callback_data, add it to that test** — silent overflow is hard to debug because Telegram drops the update without a clear error.

## Storage / DB

- Postgres + drizzle. Pool init lives in `src/core/storage/db.ts`. `max: 10` — matches three bots × `setWebhook`'s `max_connections: 10` plus headroom; migrator pool is separate. Don't bump further without a reason. (Was 5 pre-v6; bumped in commit `0c18138`.)
- Idempotent webhook delivery via `processed_telegram_updates` table — never bypass `reserveTelegramUpdate` / `completeTelegramUpdate`. Composite unique on `(bot_kind, update_id)` since v6 (migration 0009): per-bot `update_id` sequences don't collide. `bot_kind` defaults to `'ingest'` so single-bot callers work unchanged.
- v9 mirror idempotency via `mirror_log` (migration 0014). Unique on `(group_chat_id, group_message_id)` — webhook retries don't produce duplicate channel forwards.
- New schema work goes through a new `migrations/<n>_*.sql` file; regenerate snapshot via drizzle-kit.
- Admin actions (and denied attempts) are logged to `admin_audit_log` via `recordAdminAction`. Every new admin command must call it.

## Telegram I/O

- All outbound calls go through `src/core/tools/telegramTools.ts`. Public sends (`sendTelegramMessage`, `editTelegramMessage`, `deleteTelegramMessage`, `forwardTelegramMessage`, `answerTelegramCallbackQuery`) auto-wrap `callTelegramAPI` with `withTelegramRetry` (one retry on 429, honouring `retry_after`). Don't `fetch` Telegram directly from elsewhere; route new methods through `callTelegramAPI`.
- Failures throw typed errors from `src/core/typedTelegramErrors.ts`: `TelegramRateLimitError` (429), `TelegramForbiddenError` (403 blocked / not-a-member), `TelegramChatGoneError` (400 chat not found), `TelegramApiError` (everything else). Branch with `instanceof`, never on `error.message`.
- **Before changing any Telegram method call**, verify against `docs/runbook/telegram-references.md` and the linked Bot API docs. Field names get deprecated; `allowed_updates` is server-side state that needs `npm run telegram:webhook` to refresh; bots can't initiate DMs. The references doc is the canonical first stop — don't reason from memory.

## Logging

- `src/core/logger.ts` exports `createLogger()` which returns a pino logger with redact paths for `*.token`, `*.secret`, `*.password`, `*.api_key`, `*.authorization`. `LOG_LEVEL` env var controls level (`info` default).
- The pino logger is what `server.ts` passes into `processTelegramUpdate`; downstream handlers receive it as `LoggerLike`. **Always** use pino's `logger.info({ ...ctx }, "msg")` form — putting the object first makes its fields structured (and redacted) in the JSON output. The msg-first form `logger.info("msg", { ctx })` silently drops the object as a printf-interpolation arg, so structured fields disappear from logs and redaction stops applying.

## Long messages

- `buildLookupText` and `buildRecentEntriesText` route through `withCeiling` in `src/core/archive.ts` to stay under Telegram's 4096-char ceiling (3900 safety margin) with an `…and N more.` tail. New long-list builders should do the same.

## Chat moderation (v6)

- `src/core/chatModerationLexicon.ts` carries the empirically-derived lexicon (PHRASES + REGEX_PATTERNS) and the pure helpers (`normalize`, `findHits`). No DB imports — safe to load in any context.
- `src/core/chatModeration.ts` carries the orchestration: `runChatModeration` (audit + delete + best-effort DM warn) and `logBotAdminStatusForChats` (boot helper). Imports DB + Telegram.
- Policy: lexicon hit → delete the message + DM warn. **No bans, no mutes, no strikes.** Hostile actors who keep posting hits keep having their posts vanish; operators handle persistent abusers manually via Telegram-native UI.
- Bot exemptions: `is_bot` flag + id-equals-bot + `via_bot` set → skip moderation entirely (so the bot doesn't moderate its own vouch posts or inline-bot relays).
- Admin sender → audit row tagged `(admin_exempt)`, no enforcement.
- Lexicon updates have two paths:
  - **Static** (commit-time): edit `PHRASES` / `REGEX_PATTERNS` in the lexicon module + push. Railway redeploys.
  - **Live-trainable** (admin-curated, runtime): `learned_phrases` table (migration 0016). `/teach <phrase>` adds, `/untrain <phrase>` or the `/learned` Remove button soft-deletes. `runChatModeration` checks the static lexicon first, then `getActiveLearnedPhrasesCached()` (60s in-mem TTL; invalidated on add/remove so admin edits propagate immediately within the process). Pure validator + phrase-pass live in `chatModerationLexicon.ts` (`validateLearnedPhrase`, `findHitInPhrases`). Soft-delete keeps the audit trail — every learned phrase is editable / reversible.
- `runChatModeration` is wired into `handleGroupMessage` (first thing after migration handling) and `processTelegramUpdate`'s `edited_message` branch. Bot self-skip prevents moderating its own published vouches even if they coincidentally match.
- Admin-rights visibility: `logBotAdminStatusForChats` runs fire-and-forget at boot in `server.ts` and logs the bot's admin status per allowed chat. Without admin rights with `can_delete_messages`, moderation silently fails — boot log is the only signal.
- Test approach: pure helpers unit-tested; orchestration verified manually via the e2e checklist in `DEPLOY.md` §14. The `chat_moderation:delete` audit rows in `admin_audit_log` are the runtime evidence.

## Takedown resilience

Recovery from a Telegram-side group takedown is **manual**: change `TELEGRAM_ALLOWED_CHAT_IDS` to a backup group, redeploy, then run the post-deploy commands in `DEPLOY.md` §9–10. Optional DB replay into the new group via the SQL → Telegram-export-JSON recipe in `docs/runbook/opsec.md`. The runtime detection (chat-gone admin paging, member-velocity alerts, `/readyz` getMe probe) is in code; OPSEC posture and migration steps are in `docs/runbook/opsec.md`.

## v9 architecture summary

Spec: `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md`. v9 strips the templated bot-publish path that caused V3's takedown (2,234 bulk-templated messages in 24h). The current design eliminates that vector structurally — there are no bot-authored vouch posts at all.

- **Members post vouches as normal group messages.** Free text, member-authored, varied wording. TBC's survival shape (KB:F2.5).
- **v9 backup-channel mirror.** `maybeMirrorToBackupChannel` in `src/telegramBot.ts` calls `forwardTelegramMessage` for every member-posted message in `TELEGRAM_ALLOWED_CHAT_IDS`, into `TELEGRAM_CHANNEL_ID`. Idempotent via `mirror_log`. Gated by `VV_MIRROR_ENABLED=true`. Channel becomes a durable replica for takedown recovery.
- **Legacy import is DB-only.** `scripts/replayLegacyTelegramExport.ts` writes legacy V3 entries to the DB; **no Telegram sends**. Rows land with `status='published'` and `published_message_id IS NULL`. **Never reintroduce a publish step here** — this is the V3 takedown vector.
- **Recovery tool.** `scripts/replayToTelegramAsForwards.ts` (`npm run replay:to-telegram`) uses Bot API `forwardMessages` to replay the backup channel into a fresh recovery group after a takedown. Throttled to ≤25 msgs/sec, idempotent via `replay_log`. Operator-only; not wired into the webhook flow.
- **Read paths.** New content: native Telegram search (top-of-group bar). Legacy archive: `/lookup @user` works in DM for any member (POS + MIX, `private_note` hidden) and in group/DM for admins (full audit including private NEGs and `private_note`). Member DM `/lookup` is rate-limited to one per `LOOKUP_INTERVAL_MS` (5s) per user via `src/core/lookupRateLimit.ts`.
- `/search` and `/recent` no longer exist (removed in v8.0 commit 2). Any reference to them is stale.
- The DM wizard, `archivePublishing.ts`, `relayPublish.ts`, `relayCapture.ts`, and the `archiveLauncher` were deleted in v9 phase 3. Don't reintroduce.

## Environment caveats

- Repo lives in OneDrive. `git diff` / `git add` can hit `mmap` errors on large diffs (Windows). If a `git add` fails with `mmap`, retry, or stage in smaller batches.
- Telegram chat IDs (test/live/V3-export-source) — see auto-memory; do not hardcode.

## Conventions for new commits

- Commit subject: `feat(scope): ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...`, `test: ...`. Match recent history (`git log --oneline -20`).
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't squash unrelated changes; one logical change per commit.
- Don't push without an explicit ask.
