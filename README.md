# VouchVault

A plain Node Telegram bot that runs a structured vouch archive for a locked group.

- Users tap **Submit Vouch** in the group, DM the bot one `@username`, choose result + tags via buttons; the bot posts a clean entry back to the group.
- Legacy Telegram-export JSON can be replayed into the archive in chronological order (idempotent, throttled).
- Plain Node + Postgres + Drizzle. No Mastra agent, no LLM in the hot path.

## Prerequisites

- Node 22+ (uses `--experimental-strip-types`)
- Postgres 14+
- A Telegram bot token from `@BotFather`

## Common commands

| Command                                                                               | What it does                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `npm install`                                                                         | Install dependencies                                |
| `npm test`                                                                            | Run the test suite (Node `node:test` runner)        |
| `npm start`                                                                           | Run the webhook server                              |
| `npm run dev`                                                                         | Run the server with `--watch`                       |
| `npm run db:migrate`                                                                  | Apply pending Drizzle migrations                    |
| `npm run telegram:webhook`                                                            | Register the Telegram webhook URL                   |
| `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide`                     | Set bot identity, commands, and pin the group guide |
| `npm run replay:legacy <export.json> [--dry-run] [--max-imports N] [--throttle-ms N]` | Replay legacy Telegram export into the archive      |

## Environment

See `.env.example` for the full list. Required: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_ADMIN_IDS`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` (in production), `PUBLIC_BASE_URL`.

## Deploy

See `DEPLOY.md` (Railway).

## Design

See `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md`. Operational notes in `HANDOFF.md`.
