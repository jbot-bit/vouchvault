# VouchVault Handoff

## Checkpoint Summary
- The live runtime has been cut over from the old Mastra/Inngest path to a plain Node webhook server at `src/server.ts`.
- The live vouch flow now supports:
  - group launcher deep link
  - DM draft start
  - target selection by typed `@username`
  - fallback target picker button via Telegram `request_users`
  - result/tags/publish via inline buttons
  - archive repost + launcher refresh
- The repo now builds/runs through `package.json` without Mastra runtime commands.

## Verified
- `npm install` completed and generated a fresh `package-lock.json`.
- `npm test` passes.
- `npm run build` passes.
- `node --experimental-strip-types scripts/configureTelegramOnboarding.ts --dry-run --guide-chat-id -1003958981628 --bot-username SEQmodbot` works.
- `node --experimental-strip-types scripts/setTelegramWebhook.ts --help` works.
- `node --experimental-strip-types scripts/replayLegacyTelegramExport.ts --help` works.

## Important Behavior
- Only the target `@username` should be typed by users. Everything after that is button-driven.
- Username input is hardened for:
  - empty input
  - links like `t.me/...`
  - extra words / whitespace
  - multiple `@`
  - invalid Telegram username shape
  - self-vouching
  - frozen targets
  - duplicate cooldown
- Onboarding copy now states:
  - legal marketplace only
  - no illicit activity
  - nothing against Telegram ToS

## Remaining Gaps
- Old Mastra/example files still exist in the repo but are no longer the live path.
- I did not run a live webhook-to-Telegram end-to-end smoke after the plain-server cutover from this environment.
- I did not run a full legacy replay against a real database after the plain-server cutover.
- The workspace still has a broken zero-byte `.git` file, so normal git commands fail here until git metadata is reinitialized or a temp repo is used for commit/push.

## Files That Matter Now
- `src/server.ts`
- `src/telegramBot.ts`
- `src/telegramTargetInput.ts`
- `src/mastra/archive.ts`
- `src/mastra/archiveStore.ts`
- `src/mastra/archivePublishing.ts`
- `src/mastra/archiveLauncher.ts`
- `scripts/configureTelegramOnboarding.ts`
- `scripts/setTelegramWebhook.ts`
- `scripts/replayLegacyTelegramExport.ts`

## Suggested Next Steps
1. Restore usable git metadata in this workspace or use a temp repo to commit and push the current snapshot.
2. Deploy on Railway with:
   - `DATABASE_URL`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_IDS`
   - `TELEGRAM_ADMIN_IDS`
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN`
   - `TELEGRAM_BOT_USERNAME`
3. Run:
   - `npm run telegram:webhook`
   - `npm run telegram:onboarding -- --guide-chat-id <group_id> --pin-guide`
4. Live-smoke the DM flow and launcher refresh in the test group.
5. Then run legacy replay dry-run, then live replay.
