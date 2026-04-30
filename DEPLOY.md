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

For the v9 backup-channel mirror (recommended): create a private Telegram channel, add the bot as admin with **post messages** permission, and set:

```
VV_MIRROR_ENABLED=true
TELEGRAM_CHANNEL_ID=<channel id, -100… form>
```

The bot will forward every member-posted message in `TELEGRAM_ALLOWED_CHAT_IDS` into the channel via `forwardMessage` (idempotent, real-time). The channel becomes the durable replica used by `npm run replay:to-telegram` for takedown recovery. See `docs/runbook/opsec.md` §21.

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

The script reads `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` and registers `setWebhook` with `allowed_updates: ["message","edited_message","callback_query","my_chat_member","chat_member","chat_join_request"]`, `max_connections: 10`, `drop_pending_updates: true`.

`chat_member` (added in the takedown-resilience chunk) feeds the member-velocity alert; the bot must be a group admin to receive these updates. If you skip this step after upgrading, the brigade detector silently never fires.

`chat_join_request` (added in v8.0 commit 3) is required for the one-shot invite-link capture flow (`npm run invite:new`). Per Bot API spec, the bot must have the `can_invite_users` administrator right in the chat to receive these updates. If you skip the webhook re-registration after upgrading, `npm run invite:new` will still mint links but the bot will never see who used them — the `invite_links.used_by_telegram_id` column stays NULL.

Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — `last_error_message` should be empty and `allowed_updates` should list all six types: `message`, `edited_message`, `callback_query`, `my_chat_member`, `chat_member`, `chat_join_request`.

## Step 10 — Bot identity, commands, pinned guide

```
npm run telegram:onboarding -- --guide-chat-id <chat-id> --pin-guide
```

This pushes the trimmed BotFather slash menu (`/start`, `/cancel`, `/help` only — admin commands stay typed-only and off the popup), the bot description, and the pinned guide. Re-run after any spec-locked copy change.

## Step 11 — BotFather privacy setting

In `@BotFather`: `/setprivacy` → choose your bot → **Disable**.

This is required for v6 lexicon moderation **and** the v9 backup-channel mirror — the bot must receive every group message + edit to scan against the lexicon and to forward member posts into `TELEGRAM_CHANNEL_ID`. The asymmetry vs TBC's privacy-ON bots is documented in `docs/runbook/opsec.md` §19; do not flip this back to Enable while either feature is on, or both will silently stop working.

## Step 11b — Inline vouch cards (2026-05-01)

Inline mode (`@VouchVaultBot @target`) lets SC45 members drop a member-attributed vouch card from the legacy archive into chat. Required steps after deploying the inline-cards feature branch:

1. **Re-register webhook** — `npm run telegram:webhook`. Adds `inline_query` and `chosen_inline_result` to `allowed_updates`. Without this, inline silently never fires (same gotcha as v8.0 `chat_join_request`).
2. **BotFather `/setinline`** — choose your bot → enable → set placeholder `username to look up — e.g. daveyboi`.
3. **BotFather `/setinlinefeedback`** — enable. Lets us track which cards actually get inserted (vs just previewed) for abuse detection.
4. **Backfill member registry** — `npm run sc45:backfill-members`. One-shot seed of admins; regular members auto-register on first post in SC45.
5. **Group permissions** — verify SC45 member permission "Send via inline bots" is ON. Off → inline insertion silently fails for members.

Optional env vars (defaults are sane):
- `TELEGRAM_BOT_ID` — numeric bot id; lets the forgery detector bypass the boot-time `getMe` call.
- `FORGERY_FREEZE_THRESHOLD` (default `3`) — strikes before auto-freeze.
- `FORGERY_FREEZE_WINDOW_HOURS` (default `168` — 7 days) — strike-window.

## Step 11a — Pre-launch identity-surface audit

Run the §20 checklist in `docs/runbook/opsec.md` end-to-end before going live: group title + description (§20.1), bot username + display name + about (§20.2), backup-channel mirror env (§20.3), edit-rate posture (§20.4). Then run the §21 mirror posture check (bot is channel admin with post permission; `mirror_log` is being written). Each item maps to a classifier-targeting signal isolated by the 2026-04-27 survivor/dead Suncoast comparison. Re-run quarterly and after any group migration (§4 of the OPSEC runbook).

Group-type posture (§18: stay `private_group`, do not voluntarily upgrade to supergroup) is enforced by operator behaviour, not code — read §18 once before launch and again before changing any group-level setting.

## Step 12 — Smoke test

See spec §16.5.

## Step 13 — Vendetta-resistant posture: legacy NEG cleanup (one-time, post-deploy)

**Skip this step on fresh post-V3 deployments.** Replay-as-DB-only (spec `docs/superpowers/specs/2026-04-26-unified-search-archive-design.md`) means legacy entries are imported to the DB only — no group post is ever sent for any legacy entry, including legacy public NEGs from earlier groups. There are no legacy public NEG posts in the new host group, so nothing to clean up.

This step only applies if you are deploying to a group that *already contains* historical public NEG posts (e.g. an in-place upgrade of V3 itself, which is no longer the supported path):

1. List the legacy public NEG entry ids:

   ```
   psql "$DATABASE_URL" -tAc "SELECT id FROM vouch_entries WHERE result='negative' AND status='published' AND published_message_id IS NOT NULL ORDER BY id"
   ```

2. For each id, run `/remove_entry <id>` from an admin account in the host group. The bot deletes the group post and transitions the row to `removed`.

3. Verify the SQL query above returns empty.

Re-running `/remove_entry` on an already-removed entry is idempotent. Removing a NEG also clears Caution status on its target if it was the only NEG.

## Step 14 — Chat moderation enablement (after deploy)

After the chat-moderation v4 deploy (no migration required), do this once:

1. **Refresh the webhook** so Telegram delivers `edited_message` updates:
   ```
   npm run telegram:webhook
   npm run telegram:webhook -- --info
   ```
   Confirm `allowed_updates` in the info output includes `edited_message`.
2. **Verify bot is admin** in every chat in `TELEGRAM_ALLOWED_CHAT_IDS`. Railway logs at boot show `chatModeration: bot status in <id>: administrator` per chat. If any chat shows anything other than `administrator` or `creator`, promote the bot in Telegram → group settings → Administrators. The bot only needs `can_delete_messages` for v6 moderation (no ban/restrict permission required — the bot doesn't auto-ban).
3. **Verify privacy mode is OFF.** In BotFather: `/mybots` → select bot → Bot Settings → Group Privacy → Turn off. Without this, the bot only sees commands, not all member messages — chat moderation can't fire.
4. **Enable member chat in any group you want moderated.** In Telegram → group settings → Permissions → enable "Send messages" for members. Recommended: also enable Slow Mode (30 seconds) and disable "Send media", "Send links", and "Send polls". Telegram-native restrictions reduce attack surface; the bot lexicon catches the rest.
5. The bot starts moderating automatically on the next member message in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`. No bot-side config.
6. Watch `admin_audit_log` for `command='chat_moderation:delete'` rows for the first week. If a phrase is over-firing, edit `src/core/chatModerationLexicon.ts` `PHRASES` and push.

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
