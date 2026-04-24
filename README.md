# VouchVault

Structured Telegram vouch archive for a locked group workflow.

Users start from the group launcher, send only the target `@username` in DM, finish the rest with buttons, and the bot posts a clean archive entry back to the group. Legacy Telegram exports can be replayed into the archive in chronological order with resume checkpoints.

## What This Repo Does

- Runs a plain Node Telegram webhook bot on port `5000`
- Stores drafts, archive entries, launcher state, and processed updates in Postgres
- Keeps a persistent launcher message under the newest archive entry
- Replays legacy Telegram export JSON with idempotent checkpoints
- Configures bot onboarding copy, commands, and pinned guide
- Keeps the live flow constrained to `@username` input plus buttons

## Required Environment Variables

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `TELEGRAM_ADMIN_IDS`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `PUBLIC_BASE_URL`

Optional:

- `TELEGRAM_BOT_USERNAME`

## Railway Deploy

1. Create a Postgres database and set `DATABASE_URL`.
2. Deploy this repo as a Node service.
3. Set the environment variables from `.env.example`.
4. Railway will run `npm run build` and `npm run start`.
5. Set the Telegram webhook:

```bash
npm run telegram:webhook
```

6. Configure onboarding and pin the guide in the target group:

```bash
npm run telegram:onboarding -- --guide-chat-id -1003958981628 --pin-guide
```

If Railway exposes `RAILWAY_PUBLIC_DOMAIN`, the webhook script will use it automatically.

## Replit Deploy

1. Import this GitHub repo into Replit.
2. Add the environment variables from `.env.example`.
3. Publish it as a `Reserved VM`.
4. Replit will build with `npm run build` and run with `npm run start`.
5. After publish, set the Telegram webhook:

```bash
npm run telegram:webhook -- --base-url "$PUBLIC_BASE_URL"
```

6. Configure the group onboarding surfaces:

```bash
npm run telegram:onboarding -- --guide-chat-id -1003958981628 --pin-guide
```

## Legacy Replay

Dry run:

```bash
npm run replay:legacy -- ./path/to/export.json --target-chat-id -1003958981628 --dry-run
```

Live replay:

```bash
npm run replay:legacy -- ./path/to/export.json --target-chat-id -1003958981628
```

The replay writes:

- `<export>.legacy-import-review.json`
- `<export>.legacy-import-checkpoint.json`

If a replay fails mid-run, rerun the same command. Completed entries are skipped and pending rows resume from the stored checkpoint state.

## Useful Commands

```bash
npm test
npm run build
npm run db:init
npm run telegram:webhook -- --info
```
