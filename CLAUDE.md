# VouchVault — Claude guide

Telegram reputation bot. Group launches a DM flow, reviewer submits a vouch (target + result + tags), bot publishes a clean entry back to the group. Admin commands manage the group, freeze accounts, replay legacy data.

## Commands

- `npm test` — runs the full suite (Node `--test` + `--experimental-strip-types`, no build).
- `npx tsc --noEmit` — type-check (CI runs this).
- `node --experimental-strip-types --check <file>` — quick syntax-only check on a single script.
- No build step. `.ts` runs directly via `--experimental-strip-types` in Node 22 (engines `>=20`).
- `npm test` runs an explicit list of test files in `package.json`. **When you add a new `*.test.ts`, append it to the `test` script** or it will not run.

## Project layout

- `src/core/` — pure logic: archive/post format, parsers, storage, helpers. Renamed from `src/mastra/` (commit 62fb7b1) — never reintroduce the old path.
- `src/server.ts` — webhook entry. Wraps `processTelegramUpdate` in a 25s race so a slow handler can't trigger Telegram's retry loop. Also exposes `/healthz` and `/readyz`.
- `src/telegramBot.ts` — Telegram update handlers, command routing, DM flow state machine.
- `src/core/tools/telegramTools.ts` — every outbound Telegram call. Don't add new send logic elsewhere.
- `src/core/logger.ts`, `src/core/typedTelegramErrors.ts`, `src/core/withTelegramRetry.ts` — observability + Telegram I/O scaffolding (see sections below).
- `src/core/chatGoneHandler.ts`, `src/core/memberVelocity.ts` — takedown-resilience: chat-gone admin paging + brigade-detection alert (see "Takedown resilience" below).
- `migrations/` — drizzle-kit SQL. Append a new file; do not edit historical migrations.
- `scripts/` — one-off ops (`replayLegacyTelegramExport.ts`, `setTelegramWebhook.ts`, `configureTelegramOnboarding.ts`, `smokePost*.ts`).
- `DEPLOY.md` — Railway deploy + post-deploy commands (§9–10). Single source of truth for the deploy-time runbook.
- `docs/runbook/opsec.md` — OPSEC posture (Request-to-Join, member permissions, backup group), takedown migration procedure, SQL→export-JSON DR recipe, member-velocity response playbook.
- `.env.example` — canonical env-var list with comments. `.env.local` is per-machine (gitignored), filled by hand.
- `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` — V3 spec (canonical).
- `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md` — takedown-resilience spec (chat-gone, member-velocity, /readyz getMe, OPSEC).
- `docs/superpowers/plans/2026-04-25-vouchvault-redesign.md`, `docs/superpowers/plans/2026-04-26-takedown-resilience.md` — V3 + takedown-resilience plans; checkboxes are **stale**, do not trust them as a "done" signal — derive completion from git history + file existence.

## TypeScript posture (strict)

- `strict: true` and `noUncheckedIndexedAccess: true`. Index access returns `T | undefined` — assert with `!` (after a length check), or guard with `if (x === undefined) continue;`.
- Tests live alongside the file under test (e.g. `src/core/archive.ts` ↔ `src/core/archiveUx.test.ts`).

## V3-locked text (do not edit without spec change)

These functions render copy locked by spec V3. Updating their bodies requires updating the spec first:

- `buildWelcomeText` — `src/core/archive.ts`
- `buildPinnedGuideText` — `src/core/archive.ts`
- `buildBotDescriptionText` — `src/core/archive.ts`
- `buildBotShortDescription` — `src/core/archive.ts`

Tests `welcome text uses locked v3 wording` / `pinned guide text uses locked v3 wording` / `bot profile text uses the locked v3 copy` in `src/core/archiveUx.test.ts` will fail loudly if you drift.

## Group post format

Live + legacy entries share one shape. The verdict (positive/mixed/negative) is encoded inline in the heading as a `POS` / `MIX` / `NEG` prefix — there is no separate `Vouch:` line.

```
<b>POS Vouch &gt; @target</b>     ← whole line bold; PREFIX = POS / MIX / NEG
<b>From:</b> <b>@reviewer</b>
<b>Tags:</b> Good Comms, On Time
<b>Date:</b> 02/11/2025           ← legacy only — original post date, not the repost date
<code>#42</code>                  ← tap-to-copy entry id (always present, last line)
```

Built by `fmtVouchHeading(result, targetUsername)` + literal `From:` / `Tags:` lines + optional `Date:` line + always-present `<code>#id</code>` reference token in `buildArchiveEntryText`. `buildPreviewText` adds a `<b><u>Preview</u></b>` heading line above this block. `buildPublishedDraftText` (the in-DM "Posted to the group" confirmation) shows the same heading line beneath the checkmark.

There is no `(repost)` footer — the `Date:` line alone signals an archive entry. Do not reintroduce it without spec approval.

Date format is `dd/mm/yyyy` for **rendered** dates only (`fmtDate` in `archive.ts`). JSON checkpoints, review-skip records, and `lastProcessedOriginalDate` keep ISO `yyyy-mm-dd` — do not unify the two.

## Legacy import quirks

- Manual-repost wrappers (`FROM: @user / id\nDATE: dd/mm/yyyy\n\n<body>`) are unwrapped in `parseLegacyExportMessage` to override the export-level sender + timestamp. `DELETED ACCOUNT` becomes a synthetic `legacy_<numericId>` reviewer.
- `botSenders` (env: `LEGACY_BOT_SENDERS`) is checked **only** against the export-level @username, before unwrap. The unwrapped reviewer is intentionally not re-checked — see the comment in `legacyImportParser.ts` near `tryUnwrapManualRepostHeader`.
- Sentiment/target/multi-target/caption/from_id fallback are all already wired (chunk 6 of the V3 plan).

## Telegram callback_data

Telegram caps `callback_data` at 64 bytes UTF-8. There is a test (`callbackData.test.ts`) that asserts every callback string the bot can build stays under that. **If you add a new callback prefix or templated callback_data, add it to that test** — silent overflow is hard to debug because Telegram drops the update without a clear error.

## Storage / DB

- Postgres + drizzle. Pool init lives in `src/core/storage/db.ts`. `max: 5` is deliberate — it matches `setWebhook`'s `max_connections: 10` and headroom for the migrator. Don't bump without a reason.
- Idempotent webhook delivery via `processed_telegram_updates` table — never bypass `markUpdateProcessed`.
- New schema work goes through a new `migrations/<n>_*.sql` file; regenerate snapshot via drizzle-kit.
- Admin actions (and denied attempts) are logged to `admin_audit_log` via `recordAdminAction`. Every new admin command must call it.

## Telegram I/O

- All outbound calls go through `src/core/tools/telegramTools.ts`. The four public sends (`sendTelegramMessage`, `editTelegramMessage`, `deleteTelegramMessage`, `answerTelegramCallbackQuery`) auto-wrap `callTelegramAPI` with `withTelegramRetry` (one retry on 429, honouring `retry_after`). Don't `fetch` Telegram directly from elsewhere; route new methods through `callTelegramAPI`.
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
- Lexicon updates = edit `PHRASES` (or `REGEX_PATTERNS`) in the lexicon module + push. Railway redeploys; new container has the new lexicon. No admin command, no hot-reload.
- `runChatModeration` is wired into `handleGroupMessage` (first thing after migration handling) and `processTelegramUpdate`'s `edited_message` branch. Bot self-skip prevents moderating its own published vouches even if they coincidentally match.
- Admin-rights visibility: `logBotAdminStatusForChats` runs fire-and-forget at boot in `server.ts` and logs the bot's admin status per allowed chat. Without admin rights with `can_delete_messages`, moderation silently fails — boot log is the only signal.
- Test approach: pure helpers unit-tested; orchestration verified manually via the e2e checklist in `DEPLOY.md` §14. The `chat_moderation:delete` audit rows in `admin_audit_log` are the runtime evidence.

## Takedown resilience

Recovery from a Telegram-side group takedown is **manual**: change `TELEGRAM_ALLOWED_CHAT_IDS` to a backup group, redeploy, then run the post-deploy commands in `DEPLOY.md` §9–10. Optional DB replay into the new group via the SQL → Telegram-export-JSON recipe in `docs/runbook/opsec.md`. The runtime detection (chat-gone admin paging, member-velocity alerts, `/readyz` getMe probe) is in code; OPSEC posture and migration steps are in `docs/runbook/opsec.md`.

## Unified search archive (replay-as-DB-only)

Spec: `docs/superpowers/specs/2026-04-26-unified-search-archive-design.md`. V3's takedown was caused by bulk-replaying ~2,234 templated bot messages in 24h, which produced a spam-ring fingerprint Telegram's ML auto-classified for ban. The current design eliminates that vector:

- `scripts/replayLegacyTelegramExport.ts` writes legacy entries to the DB only; **no Telegram sends**. Rows land with `status='published'` and `published_message_id IS NULL`.
- `/search @username` (formerly `/profile`) is the read path. It surfaces the unified archive: live POS/MIX (with a real `published_message_id`), legacy POS/MIX (`source='legacy_import'`), and a derived `Caution` status when any NEG exists (private NEGs included in the count, never in the per-entry list).
- `/recent` shares the same privacy predicate as `/search`. Both exclude all NEG (private + legacy) at the query layer; the predicate lives in `getProfileSummary` and `getRecentArchiveEntries` in `src/core/archiveStore.ts`.
- Member-visible recent list expanded from 5 → 20 entries.
- `/profile` no longer exists. Anywhere bot-side or doc-side that mentions `/profile` is stale and should be fixed to `/search`.

## Environment caveats

- Repo lives in OneDrive. `git diff` / `git add` can hit `mmap` errors on large diffs (Windows). If a `git add` fails with `mmap`, retry, or stage in smaller batches.
- Telegram chat IDs (test/live/V3-export-source) — see auto-memory; do not hardcode.

## Conventions for new commits

- Commit subject: `feat(scope): ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...`, `test: ...`. Match recent history (`git log --oneline -20`).
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't squash unrelated changes; one logical change per commit.
- Don't push without an explicit ask.
