# Deploy VouchVault on Replit — step by step

_Target: Replit Deployment (Autoscale or Reserved VM), Postgres-backed, Telegram webhook live. Everything is on `main` — no feature branches to pick from._

## What you need before you start

- [ ] Telegram bot token from `@BotFather` (`/newbot`).
- [ ] A Replit account. **Autoscale** works on any paid tier; **Reserved VM** is the always-warm option (~$7/mo entry tier).
- [ ] Your target Telegram group's chat ID (add the bot to the group, hit `https://api.telegram.org/bot<TOKEN>/getUpdates`, copy the negative number).
- [ ] Your own Telegram user ID (for admin commands — send anything to `@userinfobot`).

## Step 1 — Import the repo

1. Replit → **Create Repl** → **Import from GitHub**.
2. URL: `https://github.com/jbot-bit/vouchvault` (defaults to `main`).
3. Replit reads `.replit` and sets up Node 20 automatically. `onBoot = "npm install"` runs on first load.

## Step 2 — Attach Postgres

In the Repl sidebar → **Tools** → **Integrations** → **Postgres** → "Set up database". Replit provisions an instance and injects `DATABASE_URL` into the workspace Secrets.

## Step 3 — Add the remaining secrets

In the workspace **Secrets** tab, add:

- `TELEGRAM_BOT_TOKEN` — from BotFather.
- `TELEGRAM_ALLOWED_CHAT_IDS` — comma-separated. Start with your single target group's ID.
- `TELEGRAM_ADMIN_IDS` — comma-separated Telegram user IDs. At least your own.
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` — any random opaque string (e.g. `openssl rand -hex 32`). Telegram will send this as a header on every webhook request and the server rejects mismatches.

You can skip `PUBLIC_BASE_URL` for now — you'll fill it in after the first deploy gives you a public URL.

## Step 4 — Sanity-check locally in the Repl shell

```bash
npm install       # already ran at onBoot, but harmless to re-run
npm test          # 22/22 should pass
npm run db:init   # creates vouches/launchers/drafts/processed_updates tables
```

If `db:init` succeeds you know the Postgres wiring works.

Run the server to make sure it binds:

```bash
npm run dev
```

Open the webview; the root `/` returns "VouchVault Telegram bot is running." `/healthz` returns `{"ok":true}`. Ctrl-C when you've seen both.

## Step 5 — Deploy

1. Sidebar → **Deploy** (rocket icon).
2. Pick a type:
   - **Autoscale** (cheapest) — scales to zero when idle. Cold starts on the first webhook after a quiet period, ~1–2s. Fine for a chat bot; Telegram retries webhooks.
   - **Reserved VM** — always on (~$7/mo entry). Pick this if you can't tolerate any cold-start lag and want "running forever" behavior.
3. `.replit` already has the right commands:
   - Build: `npm run build` (which is `npm test` — gates the deploy on a clean test run).
   - Run: `npm run start`.
4. **Before hitting Deploy**, go to the deployment's **Secrets** tab and copy every secret from Step 3. The Deployment has a separate secrets store from the workspace — missing secrets here is the #1 cause of "works in dev, 500s in prod".
5. Hit Deploy. First build takes ~1 minute; there's no bundler, just `npm install` + `npm test`.
6. When it's live, Replit shows the public URL on the Deploy page. **Copy it.** That's your `PUBLIC_BASE_URL`.

## Step 6 — Register the webhook + configure onboarding

Back in the Repl shell (workspace side), set `PUBLIC_BASE_URL` in Secrets to the URL from Step 5, then:

```bash
npm run telegram:webhook
```

That script reads `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, and `TELEGRAM_WEBHOOK_SECRET_TOKEN` from the environment and calls Telegram's `setWebhook` endpoint. Verify:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

The URL should point at your deploy and `last_error_message` should be empty.

Now pin the group guide and register onboarding copy:

```bash
npm run telegram:onboarding -- --guide-chat-id <your-group-chat-id> --pin-guide
```

Bot name, description, command list, and the pinned guide all get set in one shot.

## Step 7 — Smoke test from Telegram

1. In the allowed group, the bot should respond to the launcher button.
2. DM the bot and send one `@targetusername` — it should walk you through the button flow.
3. Complete the flow — a new vouch entry should appear in the group, and the launcher message should refresh under it.
4. Tail the deploy's **Logs** tab in Replit. You'll see a JSON line on boot (`{"ok":true,"port":5000,...}`) and `console.info` lines for each request.

If you see all of that, the deploy works.

## Troubleshooting

| Symptom                                       | Likely cause                                                                                   | Fix                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getWebhookInfo` shows a `last_error_message` | Deploy isn't reachable, or secret mismatch                                                     | Confirm `PUBLIC_BASE_URL` is exactly what Replit shows; re-run `npm run telegram:webhook`.                                                                                              |
| Webhook returns 403                           | `TELEGRAM_WEBHOOK_SECRET_TOKEN` header doesn't match env                                       | Re-run `npm run telegram:webhook` — it writes the same secret to Telegram that the server verifies.                                                                                     |
| Webhook returns 500                           | Missing env var or Postgres unreachable                                                        | Tail logs for the specific `is required.` message; check deploy Secrets.                                                                                                                |
| Bot silently ignores messages                 | `TELEGRAM_ALLOWED_CHAT_IDS` doesn't include the group ID, or the user is DMing without a draft | Non-private chats outside the allowlist are dropped on purpose. Add the chat ID and redeploy (or restart the deploy to pick up the secret).                                             |
| "table does not exist" errors                 | `db:init` never ran on the prod database                                                       | `ensureDatabaseSchema()` runs automatically at server start, but if it was skipped for any reason, run `npm run db:init` in the shell with the prod `DATABASE_URL` in your environment. |
| `DATABASE_URL` undefined on deploy            | Postgres integration attached to workspace but not to Deployment                               | See Step 5.4 — Deploy Secrets is a separate tab. Copy the var over and redeploy.                                                                                                        |
| Autoscale cold-start lag annoying in practice | Feature, not a bug                                                                             | Switch deployment type to Reserved VM, or set a warm-instance minimum in Autoscale settings.                                                                                            |

## Already known, non-blocking

See `HANDOFF.md` → "Known gaps / follow-ups" for the list (dep pinning, drizzle migrations vs. schema push, logging upgrade, `src/mastra/` rename).
