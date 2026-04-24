# VouchVault — Handoff

_Last updated 2026-04-24 after the Mastra/Inngest removal. Everything below is the state of `main` as shipped._

## What this repo is

A **plain Node Telegram bot** that runs a structured vouch archive for a locked group:

- Users start from a pinned group launcher deep link.
- In DM, they send **only** a target `@username` — everything else is button-driven (result / tags / publish).
- Published vouches land in the group chat with a refreshed launcher message underneath.
- Legacy Telegram export JSON can be replayed into the archive in chronological order with resume checkpoints.

There is **no Mastra agent, no Inngest workflow, no LLM in the hot path**. Just `src/server.ts` answering `/webhooks/telegram/action`, delegating to `src/telegramBot.ts`, which reads/writes Postgres via Drizzle.

## Runtime at a glance

```
Telegram webhook
    └─> POST /webhooks/telegram/action                         (src/server.ts)
            └─> processTelegramUpdate(payload)                 (src/telegramBot.ts)
                    ├─ per-state handlers (draft / target / result / publish)
                    ├─ normalizeUsername + hardening           (src/telegramTargetInput.ts)
                    ├─ archive read/write                      (src/mastra/archive*.ts)
                    ├─ launcher refresh                        (src/mastra/archiveLauncher.ts)
                    └─ outbound Telegram calls                 (src/mastra/tools/telegramTools.ts)

Postgres (Drizzle)
    ├─ vouches, launchers, drafts, processed_updates
    └─ `ensureDatabaseSchema()` runs at boot (src/mastra/storage/bootstrap.ts)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the webhook server (`node --experimental-strip-types src/server.ts`). |
| `npm run dev` | Same, with `--watch`. |
| `npm test` | Native `node --test` across 22 assertions covering archive UX, legacy import parsing, and `@username` hardening. |
| `npm run build` | Aliased to `npm test` — there's no transpile step; Node 20+ runs the `.ts` files directly via `--experimental-strip-types`. |
| `npm run db:init` | Ensures the schema exists (idempotent). |
| `npm run telegram:webhook` | Registers the Telegram webhook URL at `/webhooks/telegram/action`. |
| `npm run telegram:onboarding` | Configures bot description/commands + pins the group guide. |
| `npm run replay:legacy` | Replays a legacy Telegram export JSON (idempotent, supports `--dry-run`). |

## Env vars

Authoritative list is in `.env.example`. Required: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_ADMIN_IDS`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `PUBLIC_BASE_URL`. Optional: `TELEGRAM_BOT_USERNAME`, `PORT`.

## What deploy looks like

Step-by-step in `DEPLOY_REPLIT.md`. TL;DR:

1. Import the GitHub repo into Replit.
2. Attach the Replit Postgres integration.
3. Set the secrets above (workspace **and** Deployment — they're separate tabs).
4. Pick "Autoscale" for cheap scale-to-zero or "Reserved VM" for always-warm. Either fits — see the doc.
5. After the first deploy, run `npm run telegram:webhook` from the Repl shell to point Telegram at the deploy URL, and `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide` to pin the group guide.

## What changed in this checkpoint

This commit finishes the Codex-era cutover from the old Mastra/Inngest reputation-bot architecture to the plain-runtime vouch-archive bot. What got deleted:

- `src/mastra/agents/` — old reputation agent + example agent template. Never used by `server.ts`.
- `src/mastra/workflows/` — old `reputationWorkflow` + example workflow. Unused.
- `src/mastra/inngest/` — Inngest client + serve glue. Unused (the app no longer talks to Inngest).
- `src/mastra/index.ts` — the old Mastra bootstrap file that wired all of the above together. Not imported by anything in the live path.
- `src/triggers/slackTriggers.ts`, `src/triggers/telegramTriggers.ts` — thin wrappers over the old Inngest glue. Unused.
- `src/mastra/tools/pollTools.ts`, `pollPersistenceTool.ts`, `exampleTool.ts` — polls aren't a thing in the vouch-archive model.
- `scripts/inngest.sh`, `scripts/build.sh` — dead scripts from the old stack.

Still present and live: `src/mastra/archive*.ts`, `telegramChatConfig.ts`, `telegramUx.ts`, `legacyImport*`, `storage/*`, and `tools/{userTools,telegramTools}.ts`. The `src/mastra/` folder stays as a grouping convention even though it no longer relates to the Mastra framework — renaming is a cosmetic follow-up not worth the churn today.

`package.json` is already minimal: runtime deps are just `drizzle-orm` + `pg`. No Mastra, no Inngest, no AI SDK.

## Verified on this commit

- `npm test` — **22/22 passing** (archive UX, legacy import parser, username input).
- All deletions are confirmed non-live via `grep` across `src/server.ts` and `src/telegramBot.ts` import chains — no live code referenced anything that was removed.

## Known gaps / follow-ups (non-blocking)

1. **No end-to-end webhook smoke from this environment.** Tests cover logic; live Telegram → server → Postgres round-trip needs verification against the Replit deploy (do this as part of Step 7 in `DEPLOY_REPLIT.md`).
2. **No legacy replay has been run against a real database** since the cutover — do a `--dry-run` first.
3. **The `src/mastra/` directory name is a legacy artifact.** The files inside it don't use the Mastra framework anymore. Rename to `src/core/` or similar in a later PR if it bothers you.
4. **`package.json` pins deps to `"latest"`**, which will bite reproducibility eventually. Pin to concrete versions after the first successful deploy.
5. **`ensureDatabaseSchema()` is schema-push-style** — it runs DDL directly at boot. Safe today because the schema is stable, but for future changes generate drizzle migrations instead.
6. **No structured logging.** The server uses bare `console.info`/`console.error`. Swap in `pino` or similar when you want log aggregation.

## Pointer for future sessions

If you pulled this repo onto a new machine and are wondering why `C:\Users\joshd\OneDrive\VouchVault` looks like a completely different project — it is. That OneDrive working tree is a stale October-2025 Mastra/Inngest *reputation* bot that was never pushed. The canonical VouchVault is here, on GitHub `main`. Deploy from GitHub, not from that local tree.
