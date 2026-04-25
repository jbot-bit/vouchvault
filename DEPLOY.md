# Deploy VouchVault on Railway

## What you need

- Telegram bot token from `@BotFather`.
- Railway account (Hobby plan, $5/mo).
- Your target Telegram group's chat ID (negative integer).
- Your Telegram user ID for admin commands.

## Step 1 — Sign in & subscribe

1. https://railway.com — sign in with the GitHub account that has access to `jbot-bit/vouchvault`.
2. Subscribe to **Hobby**.

## Step 2 — Connect GitHub

Install the Railway GitHub app and grant access to the `vouchvault` repo. (https://docs.railway.com/guides/github-autodeploys.)

## Step 3 — Create the project + Postgres

1. New Project → Deploy PostgreSQL.
2. Wait for the Postgres service to provision; confirm `DATABASE_URL` exists in its Variables tab.

## Step 4 — Add the bot service

In the same project: **+ New** → GitHub Repo → `jbot-bit/vouchvault`.

Service Settings:

- **Build Command**: leave empty.
- **Start Command**: `npm start`
- **Service Variables** (under Environment tab):
  - `NIXPACKS_NODE_VERSION=22`

## Step 5 — Set secrets (Variables tab on the bot service)

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_ALLOWED_CHAT_IDS=<comma list>
TELEGRAM_ADMIN_IDS=<comma list>
TELEGRAM_WEBHOOK_SECRET_TOKEN=<openssl rand -hex 32>
NODE_ENV=production
```

Optional: `TELEGRAM_BOT_USERNAME`, `LEGACY_BOT_SENDERS`, `LOG_LEVEL`.

## Step 6 — Generate the public URL

Service Settings → Networking → **Generate Domain**. Copy the `*.up.railway.app` URL. Set it as `PUBLIC_BASE_URL` in Variables. The service will auto-redeploy.

## Step 7 — Apply baseline migration on existing prod DB (one-time)

If the DB already has the schema from the legacy `ensureDatabaseSchema()` boot DDL (i.e. you're cutting over from Replit with a `pg_dump` restored DB), tell drizzle-kit the baseline migration is already applied:

```sql
-- run via `psql $DATABASE_URL`
INSERT INTO __drizzle_migrations (hash, created_at)
SELECT entries->>'tag', extract(epoch from now()) * 1000
FROM jsonb_array_elements((SELECT pg_read_file('migrations/meta/_journal.json')::jsonb->'entries')) entries
WHERE entries->>'tag' LIKE '0000_%';
```

(For a brand-new DB, skip this — drizzle-kit will apply 0000 normally on the first `db:migrate`.)

## Step 8 — Migrate the database

From a one-off Railway "Run Command" or local shell with `DATABASE_URL` set:

```
npm run db:migrate
```

Expected: `{"ok": true, "migrations": "applied"}`.

## Step 9 — Register the Telegram webhook

```
npm run telegram:webhook
```

The script reads `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` and registers `setWebhook` with `allowed_updates: ["message","callback_query","my_chat_member"]`, `max_connections: 10`, `drop_pending_updates: true`.

Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — `last_error_message` should be empty.

## Step 10 — Bot identity, commands, pinned guide

```
npm run telegram:onboarding -- --guide-chat-id <chat-id> --pin-guide
```

## Step 11 — BotFather privacy setting

In `@BotFather`: `/setprivacy` → choose your bot → **Disable**.

## Step 12 — Smoke test

See spec §16.5.

## Migrating data from an existing Replit deployment

```
# From local with both DATABASE_URLs available
pg_dump --no-owner --no-acl --clean --if-exists "$REPLIT_DATABASE_URL" \
  | psql "$RAILWAY_DATABASE_URL"
```

Then run Step 7 above to seed `__drizzle_migrations` with the baseline marker.

## Rotation

- **Bot token**: BotFather `/revoke` → set new `TELEGRAM_BOT_TOKEN` in Variables → service auto-redeploys → `npm run telegram:webhook`.
- **Webhook secret**: rotate `TELEGRAM_WEBHOOK_SECRET_TOKEN` → redeploy → `npm run telegram:webhook`.

## Runbook

- **Vouches stuck publishing**: SQL `SELECT id FROM vouch_entries WHERE status='publishing' AND updated_at < now() - interval '5 minutes'` → admin runs `/recover_entry <id>` per row.
- **Need to halt**: `/pause` from any admin.
- **Restore from backup**: Railway Postgres → Settings → Backups → Restore.
