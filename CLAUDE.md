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
- `migrations/` — drizzle-kit SQL. Append a new file; do not edit historical migrations.
- `scripts/` — one-off ops (`replayLegacyTelegramExport.ts`, `setTelegramWebhook.ts`, `smokePost*.ts`).
- `DEPLOY.md` — Railway deploy + runbook.
- `.env.example` — canonical env-var list with comments.
- `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` — V3 spec (canonical).
- `docs/superpowers/plans/2026-04-25-vouchvault-redesign.md` — V3 plan; checkboxes are **stale**, do not trust them as a "done" signal — derive completion from git history + file existence.

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

## Group post format (after the format port)

Live + legacy entries share one shape, with bold field labels:

```
<b>From:</b> <b>@reviewer</b>
<b>For:</b> <b>@target</b>
<b>Vouch:</b> <b>Positive</b>
<b>Tags:</b> Good Comms, On Time
<b>Date:</b> 02/11/2025          ← legacy only

<i>(repost)</i>                    ← legacy only
```

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

## Logging

- `src/core/logger.ts` exports `createLogger()` which returns a pino logger with redact paths for `*.token`, `*.secret`, `*.password`, `*.api_key`, `*.authorization`. `LOG_LEVEL` env var controls level (`info` default).
- The pino logger is what `server.ts` passes into `processTelegramUpdate`; downstream handlers receive it as `LoggerLike`. Prefer pino's `logger.info({ ...ctx }, "msg")` form — putting the object first makes its fields structured (and redacted), not part of the message string.

## Long messages

- `buildLookupText` and `buildRecentEntriesText` route through `withCeiling` in `src/core/archive.ts` to stay under Telegram's 4096-char ceiling (3900 safety margin) with an `…and N more.` tail. New long-list builders should do the same.

## Environment caveats

- Repo lives in OneDrive. `git diff` / `git add` can hit `mmap` errors on large diffs (Windows). If a `git add` fails with `mmap`, retry, or stage in smaller batches.
- Telegram chat IDs (test/live/V3-export-source) — see auto-memory; do not hardcode.

## Conventions for new commits

- Commit subject: `feat(scope): ...`, `fix: ...`, `refactor: ...`, `docs: ...`, `chore: ...`, `test: ...`. Match recent history (`git log --oneline -20`).
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't squash unrelated changes; one logical change per commit.
- Don't push without an explicit ask.
