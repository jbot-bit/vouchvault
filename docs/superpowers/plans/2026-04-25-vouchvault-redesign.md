# VouchVault Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every change in `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` (v3) — bot UX redesign, parser improvements, replay throttling, schema cleanup, drizzle migrations, project rename, hosting migration to Railway, observability, hardening — without regressing the 22 existing tests.

**Architecture:** Plain Node 22 + Postgres + Drizzle. Webhook server (`src/server.ts`) handles Telegram updates idempotently via `processed_telegram_updates`. State lives in Postgres only. No build step — `node --experimental-strip-types` runs `.ts` directly. Tests use Node's built-in `node:test` runner.

**Tech Stack:** TypeScript 5.x, Node 22, Postgres 16, drizzle-orm + drizzle-kit, pg, pino (added in chunk 14), Telegram Bot API. Hosting: Railway (chunk 16). CI: GitHub Actions (chunk 1).

**Spec reference:** `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` v3.

**Conventions every task uses:**

- Tests live alongside the code under test (existing convention; e.g. `src/core/legacyImport.test.ts`).
- After §13.1 rename, all paths are `src/core/...`. Tasks before chunk 5 reference `src/mastra/...`; tasks from chunk 5 onward use `src/core/...`. Where a task lands BEFORE chunk 5 in the order, it uses the pre-rename path; where it lands AFTER, it uses the post-rename path. Each task spells out the exact path it expects.
- Run a single test file with `node --test --experimental-strip-types <path>`.
- Run the whole suite with `npm test`.
- Every task ends with a green `npm test` and a commit. The commit message format follows the repo (e.g. `feat: add ...`, `fix: ...`, `refactor: ...`, `chore: ...`, `docs: ...`).
- Each commit ends with the trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## File map (responsibility per file)

**New files:**

- `.gitattributes` — line-ending normalisation
- `README.md` — quickstart pointer
- `.github/workflows/test.yml` — CI
- `.prettierrc.json` — Prettier config
- `drizzle.config.ts` — drizzle-kit config
- `migrations/0000_baseline.sql` … `0005_*.sql` — drizzle-kit migrations
- `src/core/typedTelegramErrors.ts` — typed error classes
- `src/core/withTelegramRetry.ts` — 429 + network retry wrapper
- `src/core/tokenBucket.ts` — replay throttle helper
- `src/core/logger.ts` — pino logger factory + redact paths
- `src/core/bootValidation.ts` — env var validation
- `src/core/gracefulShutdown.ts` — SIGTERM handling
- `src/core/chatSettingsStore.ts` — pause / kicked / migrated
- `src/core/adminAuditStore.ts` — admin_audit_log writer
- `src/core/rateLimiter.ts` — 5-vouches/24h rolling window _(merged: shipped as `countRecentEntriesByReviewer` in `src/core/archiveStore.ts`; no standalone module landed)_
- `src/core/legacyBotSenders.ts` — bot-sender filter config
- `tests/_helpers/inMemoryStore.ts` — store mock for integration tests
- `src/core/<module>.test.ts` — colocated test files (per existing convention)
- `DEPLOY.md` — Railway deploy doc (replaces `DEPLOY_REPLIT.md`)

**Renamed (chunk 5):**

- `src/mastra/**` → `src/core/**`

**Deleted (chunk 5+):**

- `DEPLOY_REPLIT.md` (replaced by `DEPLOY.md`)

**Heavily modified:**

- `src/telegramBot.ts` — DM flow polish, admin commands, paused state, rate limit, draft revalidation
- `src/server.ts` — boot validation, graceful shutdown, `/readyz`
- `src/core/archive.ts` (post-rename) — copy updates, formatTagList ceiling
- `src/core/legacyImportParser.ts` — numeric `from_id`, sentiment, bot-sender, multi-target bucket, caption
- `scripts/replayLegacyTelegramExport.ts` — `--max-imports`, `--throttle-ms`
- `scripts/configureTelegramOnboarding.ts` — new commands, new identity
- `scripts/setTelegramWebhook.ts` — `allowed_updates`, `max_connections`, `drop_pending_updates`
- `src/core/storage/schema.ts` — drop dead, add new
- `src/core/storage/db.ts` — pool `max: 5`
- `src/core/tools/telegramTools.ts` — `withTelegramRetry`, typed errors
- `package.json` — new scripts, devDeps (drizzle-kit, prettier, pino)
- `tsconfig.json` — strict + new flags

---

## Chunk 1 — Foundation: gitattributes, README, CI

### Task 1.1: Add `.gitattributes`

**Files:**

- Create: `.gitattributes`

- [ ] **Step 1: Create `.gitattributes`**

```
* text=auto eol=lf
*.ts text eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
*.sql text eol=lf
```

- [ ] **Step 2: Renormalise the working tree**

Run: `git add --renormalize .`
Expected: a list of `.ts` / `.md` / `.json` files re-staged. No errors.

- [ ] **Step 3: Commit**

```
git commit -m "chore: add .gitattributes to normalise line endings to LF"
```

### Task 1.2: Add `README.md`

**Files:**

- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```
git add README.md
git commit -m "docs: add README quickstart"
```

### Task 1.3: Add GitHub Actions CI

**Files:**

- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm test
```

- [ ] **Step 2: Commit**

```
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions test workflow on push and PR"
```

---

## Chunk 2 — TypeScript strict + Prettier

### Task 2.1: Tighten `tsconfig.json`

**Files:**

- Modify: `tsconfig.json`

- [ ] **Step 1: Read the current `tsconfig.json`**

Run: `cat tsconfig.json`

- [ ] **Step 2: Replace it with the strict config**

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noEmit": true,
  },
  "include": ["src/**/*", "scripts/**/*"],
}
```

- [ ] **Step 3: Run `npx tsc --noEmit` and fix every error**

Run: `npx tsc --noEmit`
Expected: clean. If errors, fix them. Common fixes for `noUncheckedIndexedAccess`:

- `array[i]` becomes `array[i]!` only when proven safe; otherwise add an explicit length check.
- `record[key]` returns `T | undefined` — narrow before use.

Apply minimal edits to make `tsc` clean. Do not change runtime behaviour.

- [ ] **Step 4: Run the tests to confirm nothing regressed**

Run: `npm test`
Expected: `pass 22`.

- [ ] **Step 5: Commit**

```
git add tsconfig.json src/ scripts/
git commit -m "refactor: enable TS strict + noUncheckedIndexedAccess + noImplicitOverride"
```

### Task 2.2: Add Prettier

**Files:**

- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json`

- [ ] **Step 1: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 2: Create `.prettierignore`**

```
node_modules
migrations
.github
package-lock.json
```

- [ ] **Step 3: Add prettier as a devDependency**

Run: `npm install --save-dev --save-exact prettier@^3.3.0`
Expected: `package.json` and `package-lock.json` updated.

- [ ] **Step 4: Replace the `format` and `check:format` scripts in `package.json`**

In `package.json` `"scripts"`:

```json
"format": "prettier --write .",
"check:format": "prettier --check ."
```

- [ ] **Step 5: Run `npm run format` to format the existing tree**

Run: `npm run format`
Expected: many files reformatted; no errors.

- [ ] **Step 6: Run tests to confirm formatting did not break anything**

Run: `npm test`
Expected: `pass 22`.

- [ ] **Step 7: Commit**

```
git add .prettierrc.json .prettierignore package.json package-lock.json src/ scripts/
git commit -m "chore: add prettier and reformat tree"
```

---

## Chunk 3 — Drizzle-kit adoption + baseline migration

### Task 3.1: Install drizzle-kit and add config

**Files:**

- Modify: `package.json`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Install drizzle-kit**

Run: `npm install --save-dev --save-exact drizzle-kit@^0.31.0`
Expected: `package.json` and `package-lock.json` updated.

- [ ] **Step 2: Add scripts to `package.json`**

In `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "node --experimental-strip-types scripts/runMigrations.ts"
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/mastra/storage/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

(After chunk 5 rename, the schema path becomes `./src/core/storage/schema.ts`. Update at that point.)

- [ ] **Step 4: Commit**

```
git add package.json package-lock.json drizzle.config.ts
git commit -m "chore: add drizzle-kit + db:generate / db:migrate scripts"
```

### Task 3.2: Generate the baseline migration

**Files:**

- Create: `migrations/0000_baseline.sql` (generated)
- Create: `migrations/meta/_journal.json` (generated)

- [ ] **Step 1: Run drizzle-kit generate against the current schema**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name baseline`
Expected: `migrations/0000_baseline.sql` created with `CREATE TABLE` for every table currently in `schema.ts`.

- [ ] **Step 2: Inspect `migrations/0000_baseline.sql`**

Run: `head -50 migrations/0000_baseline.sql`
Expected: matches the columns currently defined in `src/mastra/storage/schema.ts`. If any column is missing or extra, fix `schema.ts` to match the live DB shape **exactly**, then re-run generate. Drizzle generation reflects the schema file, not the DB; the generated SQL must reproduce what `ensureDatabaseSchema()` already creates so existing prod DBs treat it as a no-op via the baseline-applied marker (Task 3.3).

- [ ] **Step 3: Commit**

```
git add migrations/
git commit -m "feat(db): add 0000_baseline migration capturing current schema"
```

### Task 3.3: Migration runner script

**Files:**

- Create: `scripts/runMigrations.ts`

- [ ] **Step 1: Write the runner**

```ts
import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: "./migrations" });

  await pool.end();
  console.info(JSON.stringify({ ok: true, migrations: "applied" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run it against a clean test DB to confirm the baseline applies**

```
docker run --rm -d --name vv-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vouchvault postgres:16
sleep 3
DATABASE_URL=postgresql://postgres:test@localhost:55432/vouchvault npm run db:migrate
```

Expected: `{"ok": true, "migrations": "applied"}`. If docker is unavailable, document the equivalent local Postgres invocation in DEPLOY.md (Task 16).

- [ ] **Step 3: Tear down**

Run: `docker rm -f vv-test-pg`

- [ ] **Step 4: Commit**

```
git add scripts/runMigrations.ts
git commit -m "feat(db): add runMigrations script using drizzle-orm migrator"
```

### Task 3.4: Switch boot to use migrations instead of `ensureDatabaseSchema`

**Files:**

- Modify: `src/server.ts`
- Modify: `src/mastra/storage/bootstrap.ts` (delete `ensureDatabaseSchema` body — replace with a no-op kept for one release, then deletable)

- [ ] **Step 1: Read `src/server.ts` and `src/mastra/storage/bootstrap.ts`**

Run: `cat src/server.ts src/mastra/storage/bootstrap.ts`

- [ ] **Step 2: Replace `ensureDatabaseSchema()` call in `src/server.ts:63` with a migration runner call**

Replace:

```ts
await ensureDatabaseSchema();
```

With:

```ts
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { sharedPostgresPool } = await import("./mastra/storage/db.ts");
await migrate(drizzle(sharedPostgresPool), { migrationsFolder: "./migrations" });
```

- [ ] **Step 3: Replace the body of `ensureDatabaseSchema` in `bootstrap.ts` with a deprecation warning + no-op**

```ts
export async function ensureDatabaseSchema(): Promise<void> {
  console.warn(
    "[bootstrap] ensureDatabaseSchema() is deprecated; migrations now run via drizzle-orm/node-postgres/migrator.",
  );
}
```

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: `pass 22`.

- [ ] **Step 5: Commit**

```
git add src/server.ts src/mastra/storage/bootstrap.ts
git commit -m "refactor(db): boot via migrate() instead of ensureDatabaseSchema"
```

### Task 3.5: Document the prod baseline-applied insertion in DEPLOY.md (preview)

**Files:**

- Modify: `DEPLOY_REPLIT.md` (will be replaced wholesale in Task 16; here we add a minimal note as a forward-pointer)

- [ ] **Step 1: Append a section to `DEPLOY_REPLIT.md`**

````markdown
## Baseline migration applied marker (one-time, prod only)

Existing prod DBs already have every table created by the legacy `ensureDatabaseSchema()` boot DDL. Tell drizzle-kit the baseline migration is already applied so it does not try to re-create those tables:

```sql
INSERT INTO __drizzle_migrations (hash, created_at)
VALUES ('<paste hash from migrations/meta/_journal.json>', extract(epoch from now()) * 1000);
```
````

Hash is `migrations/meta/_journal.json`'s `entries[0].tag` value. After this insert, `npm run db:migrate` skips 0000 and applies 0001 onward.

```

- [ ] **Step 2: Commit**

```

git add DEPLOY_REPLIT.md
git commit -m "docs: note baseline-applied insertion for existing prod DBs"

```

---

## Chunk 4 — Schema cleanup + new tables

### Task 4.1: Drop dead tables and columns (migration 0001)

**Files:**
- Modify: `src/mastra/storage/schema.ts` (remove `polls`, `votes`, dead `users` cols)
- Create: `migrations/0001_drop_dead_tables.sql` (generated)

- [ ] **Step 1: Edit `src/mastra/storage/schema.ts`**

Remove:
- The entire `polls` table export (`export const polls = pgTable('polls', { ... });`).
- The entire `votes` table export.
- These columns from `users`: `totalYesVotes`, `totalNoVotes`, `rank`, `stars`.

- [ ] **Step 2: Regenerate the migration**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name drop_dead_tables`
Expected: `migrations/0001_drop_dead_tables.sql` contains `DROP TABLE polls`, `DROP TABLE votes`, `ALTER TABLE users DROP COLUMN ...`.

- [ ] **Step 3: Inspect for safety**

Run: `cat migrations/0001_drop_dead_tables.sql`
Expected: only DROP TABLE for `polls`, `votes`; only DROP COLUMN for the four dead `users` cols. **No** unintended drops.

- [ ] **Step 4: Verify against a clean Postgres**

```

docker run --rm -d --name vv-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vouchvault postgres:16
sleep 3
DATABASE_URL=postgresql://postgres:test@localhost:55432/vouchvault npm run db:migrate
docker rm -f vv-test-pg

```

Expected: `{"ok": true, "migrations": "applied"}`.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: `pass 22`.

- [ ] **Step 6: Commit**

```

git add src/mastra/storage/schema.ts migrations/
git commit -m "feat(db): drop dead polls/votes tables and reputation cols on users"

````

### Task 4.2: Add `chat_settings` table (migration 0002)

**Files:**
- Modify: `src/mastra/storage/schema.ts`
- Create: `migrations/0002_chat_settings.sql` (generated)

- [ ] **Step 1: Add to `schema.ts`**

```ts
export const chatSettings = pgTable("chat_settings", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  paused: boolean("paused").notNull().default(false),
  pausedAt: timestamp("paused_at"),
  pausedByTelegramId: bigint("paused_by_telegram_id", { mode: "number" }),
  status: text("status").notNull().default("active"),
  migratedToChatId: bigint("migrated_to_chat_id", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
````

- [ ] **Step 2: Generate migration**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name chat_settings`
Expected: `migrations/0002_chat_settings.sql` with `CREATE TABLE chat_settings`.

- [ ] **Step 3: Apply against clean DB to verify**

(Same docker dance as Task 4.1 step 4.)

- [ ] **Step 4: Commit**

```
git add src/mastra/storage/schema.ts migrations/
git commit -m "feat(db): add chat_settings table for pause and group lifecycle"
```

### Task 4.3: Add `admin_audit_log` table (migration 0003)

**Files:**

- Modify: `src/mastra/storage/schema.ts`
- Create: `migrations/0003_admin_audit_log.sql` (generated)

- [ ] **Step 1: Add to `schema.ts`**

```ts
export const adminAuditLog = pgTable("admin_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  adminTelegramId: bigint("admin_telegram_id", { mode: "number" }).notNull(),
  adminUsername: text("admin_username"),
  command: text("command").notNull(),
  targetChatId: bigint("target_chat_id", { mode: "number" }),
  targetUsername: text("target_username"),
  entryId: integer("entry_id"),
  reason: text("reason"),
  denied: boolean("denied").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate migration**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name admin_audit_log`
Expected: `migrations/0003_admin_audit_log.sql`.

- [ ] **Step 3: Apply to clean DB to verify**

(Same docker dance.)

- [ ] **Step 4: Commit**

```
git add src/mastra/storage/schema.ts migrations/
git commit -m "feat(db): add admin_audit_log table"
```

### Task 4.4: Add freeze-reason cols + telegram_id to `business_profiles` (migration 0004)

**Files:**

- Modify: `src/mastra/storage/schema.ts`
- Create: `migrations/0004_business_profiles_freeze_reason.sql` (generated)

- [ ] **Step 1: Update `businessProfiles` definition in `schema.ts`**

Add these columns inside the existing `businessProfiles` object:

```ts
freezeReason: text("freeze_reason"),
frozenAt: timestamp("frozen_at"),
frozenByTelegramId: bigint("frozen_by_telegram_id", { mode: "number" }),
telegramId: bigint("telegram_id", { mode: "number" }),
```

- [ ] **Step 2: Generate**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name business_profiles_freeze_reason`

- [ ] **Step 3: Apply to clean DB to verify**

- [ ] **Step 4: Commit**

```
git add src/mastra/storage/schema.ts migrations/
git commit -m "feat(db): add freeze_reason and telegram_id to business_profiles"
```

### Task 4.5: Add `target_telegram_id` to `vouch_entries` (migration 0005)

**Files:**

- Modify: `src/mastra/storage/schema.ts`
- Create: `migrations/0005_vouch_entries_target_telegram_id.sql` (generated)

- [ ] **Step 1: Add to `vouchEntries` schema**

```ts
targetTelegramId: bigint("target_telegram_id", { mode: "number" }),
```

- [ ] **Step 2: Generate**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --name vouch_entries_target_telegram_id`

- [ ] **Step 3: Apply, commit**

```
git add src/mastra/storage/schema.ts migrations/
git commit -m "feat(db): add target_telegram_id to vouch_entries"
```

### Task 4.6: Add `status` CHECK constraint (migration 0006)

**Files:**

- Create: `migrations/0006_vouch_entries_status_check.sql` (hand-written)
- Modify: `migrations/meta/_journal.json` (regenerate or extend)

- [ ] **Step 1: Hand-write the migration (drizzle-kit doesn't generate raw CHECK)**

```sql
ALTER TABLE vouch_entries
ADD CONSTRAINT vouch_entries_status_check
CHECK (status IN ('pending', 'publishing', 'published', 'removed'));
```

- [ ] **Step 2: Regenerate the journal so drizzle-kit registers this hand-written file**

Run: `DATABASE_URL=postgresql://placeholder/0 npx drizzle-kit generate --custom --name vouch_entries_status_check`
(`--custom` creates an empty migration file you then paste the SQL into. If the previous step was already done with a hand-written file, manually edit `migrations/meta/_journal.json` to add an entry.)

- [ ] **Step 3: Apply to a clean DB**

```
docker run --rm -d --name vv-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=vouchvault postgres:16
sleep 3
DATABASE_URL=postgresql://postgres:test@localhost:55432/vouchvault npm run db:migrate
docker rm -f vv-test-pg
```

Expected: passes.

- [ ] **Step 4: Commit**

```
git add migrations/
git commit -m "feat(db): add CHECK constraint on vouch_entries.status"
```

---

## Chunk 5 — Rename `src/mastra/` → `src/core/`

### Task 5.1: Move all files

**Files:**

- Move: `src/mastra/**` → `src/core/**`
- Modify: every `src/**.ts` import that references `./mastra/...` or `../mastra/...`
- Modify: `scripts/configureTelegramOnboarding.ts:7` import path
- Modify: `drizzle.config.ts` schema path

- [ ] **Step 1: Verify the rename target does not exist**

Run: `ls src/core 2>/dev/null && echo "EXISTS" || echo "OK"`
Expected: `OK`.

- [ ] **Step 2: Move the directory**

Run: `git mv src/mastra src/core`
Expected: succeeds.

- [ ] **Step 3: Update every import in `src/**.ts`and`scripts/**.ts`**

Run: `grep -rln "from \"\./mastra/" src scripts && grep -rln "from \"\.\./mastra/" src scripts && grep -rln "from \"\.\.\/\.\.\/mastra\/" src scripts`

For each match, replace `mastra/` with `core/`. The most-touched file is `src/telegramBot.ts` — change every `from "./mastra/...` to `from "./core/...`. Use a single sed pass if available:

Run: `grep -rln "/mastra/" src scripts | xargs sed -i 's|/mastra/|/core/|g'`

- [ ] **Step 4: Update `drizzle.config.ts`**

Replace `./src/mastra/storage/schema.ts` with `./src/core/storage/schema.ts`.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: `pass 22`. If any test still imports `./mastra/...`, fix.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "refactor: rename src/mastra/ to src/core/ (cosmetic only)"
```

---

## Chunk 6 — Parser improvements

### Task 6.1: Add `bot_sender` skip reason and bucket

**Files:**

- Modify: `src/core/legacyImportParser.ts`
- Modify: `src/core/legacyImport.test.ts`
- Modify: `src/core/legacyImport.ts` (summary increment dispatch)

- [ ] **Step 1: Write the failing test**

Add to `src/core/legacyImport.test.ts`:

```ts
test("skips messages from configured bot senders", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 1,
      date_unixtime: "1700000000",
      from: "GroupHelpBot",
      from_id: "user5555555",
      text: "@target +rep",
    },
    sourceChatId: -1001234567890,
    botSenders: new Set(["grouphelpbot"]),
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "bot_sender");
    assert.equal(decision.reviewItem.reason, "bot_sender");
  }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test --experimental-strip-types src/core/legacyImport.test.ts`
Expected: FAIL — current `parseLegacyExportMessage` does not accept `botSenders` and `LegacySummaryBucket` does not include `bot_sender`.

- [ ] **Step 3: Implement**

In `src/core/legacyImportParser.ts`:

3a. Extend `LegacySkipReason`:

```ts
export type LegacySkipReason =
  | "missing_reviewer"
  | "missing_target"
  | "multiple_targets"
  | "self_target"
  | "unclear_sentiment"
  | "missing_source_message_id"
  | "missing_timestamp"
  | "unsupported_message_type"
  | "bot_sender";
```

3b. Extend `LegacySummaryBucket`:

```ts
export type LegacySummaryBucket =
  | "missing_reviewer"
  | "missing_target"
  | "multiple_targets"
  | "unclear_sentiment"
  | "bot_sender"
  | "other";
```

3c. Update `parseLegacyExportMessage` signature to accept `botSenders`:

```ts
export function parseLegacyExportMessage(input: {
  message: unknown;
  sourceChatId: number;
  botSenders?: Set<string>;
}): LegacyImportDecision {
```

3d. After resolving `reviewerUsername` (existing line ~360) and BEFORE the missing-reviewer check, add:

```ts
if (reviewerUsername && input.botSenders?.has(reviewerUsername)) {
  return buildSkipDecision({
    message: input.message,
    sourceMessageId,
    originalTimestamp,
    reviewerUsername,
    reason: "bot_sender",
    detail: `Skipping known bot sender ${reviewerUsername}.`,
    bucket: "bot_sender",
  });
}
```

- [ ] **Step 4: Update `incrementSummary` in `src/core/legacyImport.ts`**

Add a `skippedBotSender` counter to `LegacyImportSummary` and a branch in `incrementSummary`:

```ts
if (bucket === "bot_sender") {
  summary.skippedBotSender += 1;
  return;
}
```

Add `skippedBotSender: number` to the `LegacyImportSummary` type and to `createInitialSummary`'s return.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `pass 23` (one new test).

- [ ] **Step 6: Commit**

```
git add src/core/legacyImportParser.ts src/core/legacyImport.ts src/core/legacyImport.test.ts
git commit -m "feat(parser): add bot_sender skip bucket"
```

### Task 6.2: Numeric `from_id` reviewer fallback

**Files:**

- Modify: `src/core/legacyImportParser.ts`
- Modify: `src/core/legacyImport.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("synthesises reviewer handle from numeric from_id when @username is missing", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 2,
      date_unixtime: "1700000000",
      from: null,
      from_id: "user6812728770",
      text: "@target +vouch",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "import");
  if (decision.kind === "import") {
    assert.equal(decision.candidate.reviewerUsername, "user6812728770");
    assert.equal(decision.candidate.reviewerTelegramId, 6812728770);
  }
});

test("skips chat<id> and channel<id> from_id values as bot_sender", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 3,
      date_unixtime: "1700000000",
      from: null,
      from_id: "channel1234567890",
      text: "@target +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "bot_sender");
  }
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test --experimental-strip-types src/core/legacyImport.test.ts`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement the fallback**

In `src/core/legacyImportParser.ts`, add a helper:

```ts
const FROM_ID_USER_PREFIX = /^user(\d+)$/;
const FROM_ID_CHAT_OR_CHANNEL_PREFIX = /^(chat|channel)\d+$/;

function extractFromIdNumeric(
  message: unknown,
): { kind: "user"; numericId: number } | { kind: "non_user" } | null {
  if (!isRecord(message)) {
    return null;
  }
  const fromId = message.from_id;
  if (typeof fromId !== "string") {
    return null;
  }
  const userMatch = FROM_ID_USER_PREFIX.exec(fromId);
  if (userMatch) {
    const numericId = Number(userMatch[1]);
    return Number.isSafeInteger(numericId) ? { kind: "user", numericId } : null;
  }
  if (FROM_ID_CHAT_OR_CHANNEL_PREFIX.test(fromId)) {
    return { kind: "non_user" };
  }
  return null;
}
```

In `parseLegacyExportMessage`, when `reviewerUsername` is null but before returning `missing_reviewer`:

```ts
if (!reviewerUsername) {
  const fromId = extractFromIdNumeric(input.message);
  if (fromId?.kind === "non_user") {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername: null,
      reason: "bot_sender",
      detail: "Sender is a chat/channel, not a user.",
      bucket: "bot_sender",
    });
  }
  if (fromId?.kind === "user") {
    reviewerUsername = `user${fromId.numericId}`;
  }
}
```

Then update the candidate construction to use `fromId.numericId` instead of `getSyntheticLegacyReviewerTelegramId(reviewerUsername)` when synthesised. Track the source via a local `reviewerTelegramId` variable computed before candidate construction:

```ts
const reviewerNumericId = extractFromIdNumeric(input.message);
const reviewerTelegramId =
  reviewerNumericId?.kind === "user"
    ? reviewerNumericId.numericId
    : getSyntheticLegacyReviewerTelegramId(reviewerUsername);
```

Use `reviewerTelegramId` in the import decision's `candidate.reviewerTelegramId`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `pass 25` (two new tests).

- [ ] **Step 5: Commit**

```
git add src/core/legacyImportParser.ts src/core/legacyImport.test.ts
git commit -m "feat(parser): fall back to numeric from_id when @username missing"
```

### Task 6.3: Multiple-targets bucket split

**Files:**

- Modify: `src/core/legacyImportParser.ts:430-437` (the `multiple_targets` branch)
- Modify: `src/core/legacyImport.ts` (`incrementSummary`)
- Modify: `src/core/legacyImport.test.ts`

- [ ] **Step 1: Update existing test expectation**

In `src/core/legacyImport.test.ts`, locate the existing test that asserts `multiple_targets` decisions go to `missing_target` bucket. Change the expected `bucket` to `multiple_targets`. (If no such test exists explicitly, add one:)

```ts
test("skips multiple-target messages into multiple_targets bucket", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 4,
      date_unixtime: "1700000000",
      from: "alice",
      from_id: "user1",
      text: "@target1 @target2 +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "multiple_targets");
  }
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test --experimental-strip-types src/core/legacyImport.test.ts`
Expected: FAIL (currently `bucket === "missing_target"`).

- [ ] **Step 3: Implement**

In `src/core/legacyImportParser.ts`, the `multiple_targets` branch (around line 426) — change `bucket: "missing_target"` to `bucket: "multiple_targets"`.

In `src/core/legacyImport.ts` `LegacyImportSummary`, add `skippedMultipleTargets: number`. Update `createInitialSummary` to default it to 0. Update `incrementSummary` with a branch for `multiple_targets`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `pass 26`.

- [ ] **Step 5: Commit**

```
git add src/core/legacyImportParser.ts src/core/legacyImport.ts src/core/legacyImport.test.ts
git commit -m "feat(parser): split multiple_targets into its own summary bucket"
```

### Task 6.4: Expanded sentiment patterns

**Files:**

- Modify: `src/core/legacyImportParser.ts` (POSITIVE_PATTERNS, NEGATIVE_PATTERNS)
- Modify: `src/core/legacyImport.test.ts`

- [ ] **Step 1: Write a failing test per new pattern**

Add to `legacyImport.test.ts`:

```ts
const positiveSamples: Array<{ name: string; text: string }> = [
  { name: "pos vouch", text: "@x pos vouch" },
  { name: "huge vouch", text: "@x huge vouch from me" },
  { name: "big vouch", text: "@x big vouch" },
  { name: "mad vouch", text: "@x mad vouch" },
  { name: "high vouch", text: "@x high vouch" },
  { name: "highly vouch", text: "@x highly vouch" },
  { name: "solid vouch", text: "@x solid vouch" },
];

for (const sample of positiveSamples) {
  test(`classifies ${sample.name} as positive`, () => {
    const decision = parseLegacyExportMessage({
      message: {
        type: "message",
        id: 100,
        date_unixtime: "1700000000",
        from: "alice",
        from_id: "user1",
        text: sample.text,
      },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "import");
    if (decision.kind === "import") {
      assert.equal(decision.candidate.result, "positive");
    }
  });

  test(`negated ${sample.name} skips`, () => {
    const decision = parseLegacyExportMessage({
      message: {
        type: "message",
        id: 101,
        date_unixtime: "1700000000",
        from: "alice",
        from_id: "user1",
        text: `@x not ${sample.name}`,
      },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "skip");
    if (decision.kind === "skip") {
      assert.equal(decision.reviewItem.reason, "unclear_sentiment");
    }
  });
}

const negativeSamples: Array<{ name: string; text: string }> = [
  { name: "neg vouch", text: "@x neg vouch" },
  { name: "scam", text: "@x is a scam" },
  { name: "scammer", text: "@x scammer" },
  { name: "scammed", text: "@x scammed me" },
  { name: "ripped", text: "@x ripped me off" },
  { name: "dodgy", text: "@x dodgy" },
  { name: "sketchy", text: "@x sketchy" },
  { name: "shady", text: "@x shady" },
  { name: "ghost", text: "@x ghost on payment" },
  { name: "ghosted", text: "@x ghosted me" },
  { name: "steer clear", text: "@x steer clear" },
  { name: "dont trust", text: "@x dont trust him" },
  { name: "don't trust", text: "@x don't trust him" },
];

for (const sample of negativeSamples) {
  test(`classifies ${sample.name} as negative`, () => {
    const decision = parseLegacyExportMessage({
      message: {
        type: "message",
        id: 200,
        date_unixtime: "1700000000",
        from: "alice",
        from_id: "user1",
        text: sample.text,
      },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "import");
    if (decision.kind === "import") {
      assert.equal(decision.candidate.result, "negative");
    }
  });
}
```

- [ ] **Step 2: Run tests**

Run: `node --test --experimental-strip-types src/core/legacyImport.test.ts`
Expected: many failures.

- [ ] **Step 3: Add patterns**

In `src/core/legacyImportParser.ts`:

```ts
const POSITIVE_PATTERNS: readonly LegacyPattern[] = [
  { label: "+rep", regex: /(^|[^a-z0-9_])\+\s*rep(?=$|[^a-z0-9_])/ },
  { label: "+vouch", regex: /(^|[^a-z0-9_])\+\s*vouch(?=$|[^a-z0-9_])/ },
  { label: "legit", regex: buildLegacyKeywordPattern("legit") },
  { label: "trusted", regex: buildLegacyKeywordPattern("trusted") },
  { label: "good", regex: buildLegacyKeywordPattern("good") },
  { label: "recommend", regex: /(?<!not\s)\brecommend(?:ed|s|ing)?\b/ },
  { label: "pos vouch", regex: /(?<!not\s)\bpos\s+vouch\b/ },
  { label: "huge vouch", regex: /(?<!not\s)\bhuge\s+vouch\b/ },
  { label: "big vouch", regex: /(?<!not\s)\bbig\s+vouch\b/ },
  { label: "mad vouch", regex: /(?<!not\s)\bmad\s+vouch\b/ },
  { label: "high vouch", regex: /(?<!not\s)\bhigh(?:ly)?\s+vouch\b/ },
  { label: "solid vouch", regex: /(?<!not\s)\bsolid\s+vouch\b/ },
];

const NEGATIVE_PATTERNS: readonly LegacyPattern[] = [
  { label: "-rep", regex: /(^|[^a-z0-9_])-\s*rep(?=$|[^a-z0-9_])/ },
  { label: "-vouch", regex: /(^|[^a-z0-9_])-\s*vouch(?=$|[^a-z0-9_])/ },
  { label: "avoid", regex: buildLegacyKeywordPattern("avoid") },
  { label: "bad", regex: buildLegacyKeywordPattern("bad") },
  { label: "warning", regex: buildLegacyKeywordPattern("warning") },
  { label: "not legit", regex: /\bnot\s+legit\b/ },
  { label: "neg vouch", regex: /(?<!not\s)\bneg\s+vouch\b/ },
  { label: "scam", regex: /(?<!not\s)\bscam(?:mer|med|ming|s)?\b/ },
  { label: "ripped", regex: /(?<!not\s)\bripped\b/ },
  { label: "dodgy", regex: /(?<!not\s)\bdodgy\b/ },
  { label: "sketchy", regex: /(?<!not\s)\bsketchy\b/ },
  { label: "shady", regex: /(?<!not\s)\bshady\b/ },
  { label: "ghost", regex: /(?<!not\s)\bghost(?:ed|ing)?\b/ },
  { label: "steer clear", regex: /(?<!not\s)\bsteer\s+clear\b/ },
  { label: "dont trust", regex: /(?<!not\s)\bdon'?t\s+trust\b/ },
];
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: `pass 50+`.

- [ ] **Step 5: Commit**

```
git add src/core/legacyImportParser.ts src/core/legacyImport.test.ts
git commit -m "feat(parser): expand sentiment patterns with group's actual register"
```

### Task 6.5: Caption support

**Files:**

- Modify: `src/core/legacyImportParser.ts` (`flattenLegacyMessageText` callers)
- Modify: `src/core/legacyImport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("uses message caption when text is empty", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 5,
      date_unixtime: "1700000000",
      from: "alice",
      from_id: "user1",
      text: "",
      caption: "@target +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "import");
  if (decision.kind === "import") {
    assert.equal(decision.candidate.targetUsername, "target");
    assert.equal(decision.candidate.result, "positive");
  }
});
```

- [ ] **Step 2: Run**

Run: `node --test --experimental-strip-types src/core/legacyImport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `parseLegacyExportMessage`, where `text` is computed (around line 410):

```ts
const text = (() => {
  const main = flattenLegacyMessageText(input.message.text).trim();
  if (main) return main;
  return flattenLegacyMessageText(input.message.caption).trim();
})();
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `pass 51+`.

- [ ] **Step 5: Commit**

```
git add src/core/legacyImportParser.ts src/core/legacyImport.test.ts
git commit -m "feat(parser): fall back to caption when text is empty"
```

### Task 6.6: Wire `botSenders` config from env into `replayLegacyExport`

**Files:**

- Create: `src/core/legacyBotSenders.ts`
- Modify: `src/core/legacyImport.ts`

- [ ] **Step 1: Create the helper**

```ts
const DEFAULT_BOT_SENDERS = ["combot", "grouphelpbot", "groupanonymousbot"];

export function getLegacyBotSenders(): Set<string> {
  const raw = process.env.LEGACY_BOT_SENDERS?.trim();
  const list = raw
    ? raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_BOT_SENDERS;
  return new Set(list);
}
```

- [ ] **Step 2: Use it in `replayLegacyExport`**

In `src/core/legacyImport.ts`, near the top of `replayLegacyExport`, compute the set once:

```ts
import { getLegacyBotSenders } from "./legacyBotSenders.ts";

// ... inside replayLegacyExport, after sortedMessages assignment:
const botSenders = getLegacyBotSenders();
```

Pass it into every `parseLegacyExportMessage` call:

```ts
const decision = parseLegacyExportMessage({ message, sourceChatId, botSenders });
```

- [ ] **Step 3: Test**

Run: `npm test`
Expected: `pass 51+`.

- [ ] **Step 4: Commit**

```
git add src/core/legacyBotSenders.ts src/core/legacyImport.ts
git commit -m "feat(parser): wire LEGACY_BOT_SENDERS env config into replay"
```

---

## Chunk 7 — Replay throttle, max-imports, 429 handling

### Task 7.1: Token bucket helper

**Files:**

- Create: `src/core/tokenBucket.ts`
- Create: `src/core/tokenBucket.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenBucket } from "./tokenBucket.ts";

test("token bucket waits the configured interval between takes", async () => {
  const intervalMs = 100;
  const bucket = createTokenBucket(intervalMs);
  const start = Date.now();
  await bucket.take();
  await bucket.take();
  await bucket.take();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 2 * intervalMs - 10, `expected >= ${2 * intervalMs - 10}, got ${elapsed}`);
});

test("first take is immediate", async () => {
  const bucket = createTokenBucket(500);
  const start = Date.now();
  await bucket.take();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `first take should be near-instant, got ${elapsed}`);
});
```

- [ ] **Step 2: Run**

Run: `node --test --experimental-strip-types src/core/tokenBucket.test.ts`
Expected: FAIL (file does not exist).

- [ ] **Step 3: Implement**

```ts
export type TokenBucket = {
  take(): Promise<void>;
};

export function createTokenBucket(intervalMs: number): TokenBucket {
  let nextAvailableAt = 0;
  return {
    async take() {
      const now = Date.now();
      const wait = Math.max(0, nextAvailableAt - now);
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
      nextAvailableAt = Math.max(now, nextAvailableAt) + intervalMs;
    },
  };
}
```

- [ ] **Step 4: Run**

Run: `node --test --experimental-strip-types src/core/tokenBucket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/core/tokenBucket.ts src/core/tokenBucket.test.ts package.json
git commit -m "feat: add token bucket helper"
```

### Task 7.2: Add `--max-imports` and `--throttle-ms` CLI flags

**Files:**

- Modify: `scripts/replayLegacyTelegramExport.ts`

- [ ] **Step 1: Extend `CliOptions`**

```ts
type CliOptions = {
  exportFilePath: string;
  reviewReportPath?: string;
  checkpointPath?: string;
  sourceChatId?: number;
  targetGroupChatId?: number;
  dryRun: boolean;
  maxImports?: number;
  throttleMs: number;
};
```

- [ ] **Step 2: Parse new flags in `parseCliArguments`**

After the existing `--dry-run` block, add:

```ts
if (arg === "--max-imports") {
  maxImports = readNumberFlag(argv[index + 1], "--max-imports");
  index += 1;
  continue;
}

if (arg === "--throttle-ms") {
  throttleMs = readNumberFlag(argv[index + 1], "--throttle-ms");
  index += 1;
  continue;
}
```

Default `throttleMs` to `3100` in the variable declaration. Pass both into `replayLegacyExport`.

- [ ] **Step 3: Update `printUsage`**

Add to the usage block:

```
  [--max-imports <N>]      Stop after N successful imports
  [--throttle-ms <N>]      Sleep N ms before each live send (default 3100)
```

- [ ] **Step 4: Forward into `replayLegacyExport`**

Update the call site in `main()` to include the new fields.

- [ ] **Step 5: Commit**

```
git add scripts/replayLegacyTelegramExport.ts
git commit -m "feat(replay): add --max-imports and --throttle-ms flags"
```

### Task 7.3: Wire the throttle and max-imports into `replayLegacyExport`

**Files:**

- Modify: `src/core/legacyImport.ts`

- [ ] **Step 1: Extend `ReplayLegacyExportInput`**

```ts
export type ReplayLegacyExportInput = {
  exportFilePath: string;
  reviewReportPath?: string;
  checkpointPath?: string;
  sourceChatId?: number | null;
  targetGroupChatId?: number | null;
  dryRun?: boolean;
  maxImports?: number;
  throttleMs?: number;
  logger?: LoggerLike;
};
```

- [ ] **Step 2: Construct the bucket**

Near the top of `replayLegacyExport`, after `dryRun`:

```ts
import { createTokenBucket } from "./tokenBucket.ts";
// ...
const throttleMs = input.throttleMs ?? 3100;
const sendBucket = !dryRun ? createTokenBucket(throttleMs) : null;
const maxImports = input.maxImports ?? null;
```

- [ ] **Step 3: Sleep before each live publish**

In the publish loop (both the resume-existing branch and the new-create branch), before `await publishArchiveEntryRecord(...)`:

```ts
if (sendBucket) {
  await sendBucket.take();
}
```

- [ ] **Step 4: Stop at `maxImports`**

After `summary.imported += 1` (in both branches), check:

```ts
if (maxImports != null && summary.imported >= maxImports) {
  logger.info?.("[Legacy Import] Reached --max-imports limit, stopping early.", { maxImports });
  break;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `pass 51+` (no new tests; behaviour change is integration-tested below).

- [ ] **Step 6: Commit**

```
git add src/core/legacyImport.ts
git commit -m "feat(replay): apply throttle and max-imports inside replay loop"
```

---

## Chunk 8 — Boot validation, graceful shutdown, /readyz

### Task 8.1: Boot env validation

**Files:**

- Create: `src/core/bootValidation.ts`
- Create: `src/core/bootValidation.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBootEnv } from "./bootValidation.ts";

test("rejects missing TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_BOT_TOKEN/,
  );
});

test("rejects malformed TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "not-a-token",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_BOT_TOKEN.*shape/i,
  );
});

test("rejects empty TELEGRAM_ADMIN_IDS", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_ADMIN_IDS/,
  );
});

test("rejects missing TELEGRAM_WEBHOOK_SECRET_TOKEN in production", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        NODE_ENV: "production",
      }),
    /TELEGRAM_WEBHOOK_SECRET_TOKEN.*production/i,
  );
});

test("accepts a valid full config", () => {
  assert.doesNotThrow(() =>
    validateBootEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "12345:abcdef-_xy",
      TELEGRAM_ALLOWED_CHAT_IDS: "-1001,-1002",
      TELEGRAM_ADMIN_IDS: "1,2",
      TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret_token-123",
      NODE_ENV: "production",
    }),
  );
});

test("non-production allows missing webhook secret", () => {
  assert.doesNotThrow(() =>
    validateBootEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "12345:abcdef",
      TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
      TELEGRAM_ADMIN_IDS: "1",
      NODE_ENV: "development",
    }),
  );
});
```

- [ ] **Step 2: Run**

Run: `node --test --experimental-strip-types src/core/bootValidation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const SECRET_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

type Env = Record<string, string | undefined>;

function require(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseIntegerList(env: Env, name: string): number[] {
  const raw = require(env, name);
  const list = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => Number(p));
  if (list.length === 0 || list.some((n) => !Number.isSafeInteger(n))) {
    throw new Error(
      `${name} must be a comma-separated list of integers; got ${JSON.stringify(raw)}.`,
    );
  }
  return list;
}

export function validateBootEnv(env: Env = process.env): void {
  require(env, "DATABASE_URL");
  const token = require(env, "TELEGRAM_BOT_TOKEN");
  if (!BOT_TOKEN_RE.test(token)) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN does not match the expected token shape '<digits>:<alnum_-+>'.",
    );
  }
  parseIntegerList(env, "TELEGRAM_ALLOWED_CHAT_IDS");
  parseIntegerList(env, "TELEGRAM_ADMIN_IDS");

  const isProd = env.NODE_ENV === "production";
  const secret = env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  if (isProd) {
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN is required in production.");
    if (!SECRET_TOKEN_RE.test(secret))
      throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN must be 1-256 chars [A-Za-z0-9_-].");
  } else if (secret && !SECRET_TOKEN_RE.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN must be 1-256 chars [A-Za-z0-9_-].");
  }
}
```

- [ ] **Step 4: Wire into `src/server.ts`**

At the top of `main()`, replace `requireRuntimeEnv("DATABASE_URL")` etc. with:

```ts
import { validateBootEnv } from "./core/bootValidation.ts";
// ...
validateBootEnv();
```

(Drop the now-redundant `requireRuntimeEnv` calls; keep the `getAllowedTelegramChatIdSet().size === 0` check as a defence-in-depth, or remove since `validateBootEnv` already ensures non-empty.)

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: `pass 57+`.

- [ ] **Step 6: Commit**

```
git add src/core/bootValidation.ts src/core/bootValidation.test.ts src/server.ts
git commit -m "feat(boot): validate every required env var at startup"
```

### Task 8.2: Graceful shutdown

**Files:**

- Create: `src/core/gracefulShutdown.ts`
- Create: `src/core/gracefulShutdown.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { installGracefulShutdown } from "./gracefulShutdown.ts";

test("close() resolves once server stops accepting and pool is closed", async () => {
  let serverClosed = false;
  let poolClosed = false;
  const fakeServer = {
    close: (cb: () => void) => {
      serverClosed = true;
      cb();
    },
  };
  const fakePool = {
    end: async () => {
      poolClosed = true;
    },
  };
  const shutdown = installGracefulShutdown({
    server: fakeServer,
    dbPool: fakePool,
    drainMs: 50,
    hardCeilingMs: 200,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  await shutdown.runOnce("TEST");
  assert.equal(serverClosed, true);
  assert.equal(poolClosed, true);
});
```

- [ ] **Step 2: Run**

Run: `node --test --experimental-strip-types src/core/gracefulShutdown.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
type ServerLike = { close(cb: () => void): void };
type PoolLike = { end(): Promise<void> };
type LoggerLike = {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

export function installGracefulShutdown(opts: {
  server: ServerLike;
  dbPool: PoolLike;
  drainMs: number;
  hardCeilingMs: number;
  logger: LoggerLike;
}) {
  let triggered = false;

  async function runOnce(signal: string) {
    if (triggered) return;
    triggered = true;
    opts.logger.info({ signal }, "graceful shutdown starting");
    const hardTimer = setTimeout(() => {
      opts.logger.error({ signal }, "graceful shutdown exceeded hard ceiling, forcing exit");
      process.exit(1);
    }, opts.hardCeilingMs);
    hardTimer.unref();

    await new Promise<void>((resolve) => opts.server.close(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, opts.drainMs).unref?.() ?? resolve());
    await opts.dbPool.end();
    clearTimeout(hardTimer);
    opts.logger.info({ signal }, "graceful shutdown complete");
  }

  process.on("SIGTERM", () => {
    void runOnce("SIGTERM").then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void runOnce("SIGINT").then(() => process.exit(0));
  });

  return { runOnce };
}
```

- [ ] **Step 4: Wire into `src/server.ts`**

After `server.listen(...)`:

```ts
import { installGracefulShutdown } from "./core/gracefulShutdown.ts";
import { sharedPostgresPool } from "./core/storage/db.ts";
// ...
installGracefulShutdown({
  server,
  dbPool: sharedPostgresPool,
  drainMs: 5_000,
  hardCeilingMs: 8_000,
  logger: console,
});
```

(Verify `sharedPostgresPool` export name matches `db.ts`. If different, use the actual export.)

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: `pass 58+`.

- [ ] **Step 6: Commit**

```
git add src/core/gracefulShutdown.ts src/core/gracefulShutdown.test.ts src/server.ts
git commit -m "feat(server): graceful SIGTERM shutdown with drain and pool close"
```

### Task 8.3: Add `/readyz` endpoint

**Files:**

- Modify: `src/server.ts`

- [ ] **Step 1: Add to the request handler**

After the `/healthz` block:

```ts
if (req.method === "GET" && req.url === "/readyz") {
  try {
    const { sharedPostgresPool } = await import("./core/storage/db.ts");
    await sharedPostgresPool.query("SELECT 1");
    const response = jsonResponse({ ok: true });
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  } catch (error) {
    const response = jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      503,
    );
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  }
  return;
}
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev` then in another terminal `curl http://localhost:5000/readyz`
Expected (with DB up): `{"ok":true}`. Stop the server.

- [ ] **Step 3: Commit**

```
git add src/server.ts
git commit -m "feat(server): add /readyz endpoint that checks DB pool"
```

---

## Chunk 9 — Bot identity, commands, copy

### Task 9.1: Update bot description and short description

**Files:**

- Modify: `src/core/archive.ts` (`buildBotDescriptionText`, `buildBotShortDescription`)
- Modify: `src/core/archiveUx.test.ts` (existing test updates)

- [ ] **Step 1: Update the existing test for description**

Find the test "bot profile text matches the business-hub model and lawful-use note" in `src/core/archiveUx.test.ts`. Change its assertion to match the new copy:

```ts
test("bot profile text uses the locked v3 copy", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /Log and verify local-business service experiences/);
  assert.match(desc, /Tap Submit Vouch/);
  assert.match(desc, /Lawful use only/);
  assert.ok(desc.length <= 512);

  const short = buildBotShortDescription();
  assert.match(short, /Vouch Hub/);
  assert.match(short, /local-business service experiences/);
  assert.ok(short.length <= 120);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --experimental-strip-types src/core/archiveUx.test.ts`
Expected: FAIL on description content.

- [ ] **Step 3: Update `archive.ts`**

```ts
export function buildBotDescriptionText(): string {
  return [
    "Log and verify local-business service experiences with the community.",
    "",
    "How it works: tap Submit Vouch in the group, DM the bot one @username, choose result + tags, I post a clean entry back to the group.",
    "",
    "Lawful use only — follow Telegram's Terms of Service.",
  ].join("\n");
}

export function buildBotShortDescription(): string {
  return "Vouch Hub — log and verify local-business service experiences. Open from the group launcher.";
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "feat(copy): update bot description and short description per spec v3"
```

### Task 9.2: Update onboarding script with new commands

**Files:**

- Modify: `scripts/configureTelegramOnboarding.ts`

- [ ] **Step 1: Replace the command lists**

```ts
const DEFAULT_COMMANDS: BotCommand[] = [
  { command: "help", description: "How the Vouch Hub works" },
  { command: "recent", description: "Show recent entries" },
];

const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "vouch", description: "Start a new vouch" },
  { command: "cancel", description: "Cancel your in-progress draft" },
  { command: "profile", description: "Show entry totals for an @username" },
  { command: "lookup", description: "Look up entries for an @username" },
  ...DEFAULT_COMMANDS,
];

const ADMIN_COMMANDS: BotCommand[] = [
  ...DEFAULT_COMMANDS,
  { command: "profile", description: "Show entry totals for an @username" },
  { command: "lookup", description: "Look up entries for an @username" },
  { command: "freeze", description: "Freeze @username [reason]" },
  { command: "unfreeze", description: "Unfreeze @username" },
  { command: "frozen_list", description: "List frozen profiles" },
  { command: "remove_entry", description: "Remove an entry by id" },
  { command: "recover_entry", description: "Clear stuck publishing for an entry id" },
  { command: "pause", description: "Pause new vouch submissions" },
  { command: "unpause", description: "Resume vouch submissions" },
  { command: "admin_help", description: "Admin command reference" },
];
```

- [ ] **Step 2: Set bot name**

Add `setMyName` call alongside `setMyDescription`:

```ts
await callTelegramAPI("setMyName", { name: "Vouch Hub" });
```

- [ ] **Step 3: Dry-run smoke**

Run: `npm run telegram:onboarding -- --dry-run`
Expected: JSON output showing the new commands and copy.

- [ ] **Step 4: Commit**

```
git add scripts/configureTelegramOnboarding.ts
git commit -m "feat(onboarding): add new commands and set bot name to Vouch Hub"
```

### Task 9.3: Update step prompts and error copy

**Files:**

- Modify: `src/core/archive.ts` (welcome, step prompts, errors, etc.)
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Update the test**

Find the test "welcome and pinned guide use the business-hub framing and How to Vouch walkthrough" and align with §14.1, §14.2 copy.

```ts
test("welcome text uses locked v3 wording", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Log and verify local-business service experiences/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Tap <b>Submit Vouch<\/b> in the group/);
  assert.match(text, /Send the target @username here/);
  assert.match(text, /Choose result and tags/);
  assert.match(text, /I post the entry back to the group/);
  assert.match(text, /Lawful use only — follow Telegram's Terms of Service/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --experimental-strip-types src/core/archiveUx.test.ts`

- [ ] **Step 3: Update `archive.ts`**

```ts
export function buildWelcomeText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    "Log and verify local-business service experiences with the community.",
    "",
    "<b><u>How to vouch</u></b>",
    "1. Tap <b>Submit Vouch</b> in the group.",
    "2. Send the target @username here.",
    "3. Choose result and tags.",
    "4. I post the entry back to the group.",
    "",
    "<b>Rules</b>",
    "Lawful use only — follow Telegram's Terms of Service.",
  ].join("\n");
}

export function buildPinnedGuideText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    "Log and verify local-business service experiences with the community.",
    "",
    "<b><u>How to vouch</u></b>",
    "1. Tap <b>Submit Vouch</b> below.",
    "2. In DM, send only the target @username, then use the buttons.",
    "3. I post the final entry back here.",
    "",
    "<b>Rules</b>",
    "Lawful use only — follow Telegram's Terms of Service.",
  ].join("\n");
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "feat(copy): update welcome and pinned guide to locked v3 copy"
```

### Task 9.4: Bump `MAX_RECENT_ENTRIES` from 5 to 10

**Files:**

- Modify: `src/core/archive.ts`

- [ ] **Step 1: Change the constant**

```ts
export const MAX_RECENT_ENTRIES = 10;
```

- [ ] **Step 2: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add src/core/archive.ts
git commit -m "feat: bump /recent default to 10 entries"
```

---

## Chunk 10 — DM flow polish

### Task 10.1: Drop `/verify` from threaded launcher commands

**Files:**

- Modify: `src/core/telegramUx.ts`

- [ ] **Step 1: Remove from the set**

```ts
const THREADED_LAUNCHER_COMMANDS = new Set(["/start", "/help", "/vouch"]);
```

- [ ] **Step 2: Test**

Run: `npm test`
Expected: PASS (no test references `/verify`).

- [ ] **Step 3: Commit**

```
git add src/core/telegramUx.ts
git commit -m "fix: drop /verify from threaded-launcher reply set (never registered)"
```

### Task 10.2: Fix `/lookup` admin-only error string

**Files:**

- Modify: `src/telegramBot.ts` (`handleLookupCommand` at line 267 area)

- [ ] **Step 1: Change the message**

```ts
text: "Lookup requires /lookup @username.",
```

- [ ] **Step 2: Commit**

```
git add src/telegramBot.ts
git commit -m "fix: correct /lookup usage hint (was falsely claiming admin-only)"
```

### Task 10.3: Add `/cancel` command

**Files:**

- Modify: `src/telegramBot.ts` (in `handlePrivateMessage`)

- [ ] **Step 1: Add the handler**

In `handlePrivateMessage`, in the command-dispatch block (after `/help` handling), insert:

```ts
if (command === "/cancel") {
  await withReviewerDraftLock(message.from.id, async () => {
    const draft = await getDraftByReviewerTelegramId(message.from.id);
    if (!draft) {
      await sendTelegramMessage({ chatId, text: "No active draft." }, logger);
      return;
    }
    await clearDraftByReviewerTelegramId(message.from.id);
    await sendTelegramMessage(
      {
        chatId,
        text: "Cancelled.",
        replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
      },
      logger,
    );
  });
  return;
}
```

- [ ] **Step 2: Test by sending /cancel during a draft and without one**

(Manual smoke once deployed; add to §16.5.)

- [ ] **Step 3: Commit**

```
git add src/telegramBot.ts
git commit -m "feat(dm): add /cancel command"
```

### Task 10.4: Reviewer rate limit (5/24h)

**Files:**

- Create: `src/core/rateLimiter.ts`
- Create: `src/core/rateLimiter.test.ts`
- Modify: `src/telegramBot.ts` (call from `applySelectedTarget`)
- Modify: `src/core/archiveStore.ts` (new helper `countRecentEntriesByReviewer`)

- [ ] **Step 1: Add the store helper**

In `src/core/archiveStore.ts`:

```ts
export async function countRecentEntriesByReviewer(input: {
  reviewerTelegramId: number;
  withinHours: number;
}): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vouchEntries)
    .where(
      and(
        eq(vouchEntries.reviewerTelegramId, input.reviewerTelegramId),
        gte(
          vouchEntries.createdAt,
          sql`now() - interval '${sql.raw(String(input.withinHours))} hours'`,
        ),
        ne(vouchEntries.status, "removed"),
      ),
    );
  return Number(result[0]?.count ?? 0);
}
```

- [ ] **Step 2: Use it in `applySelectedTarget`**

After the duplicate-cooldown check:

```ts
const dailyCount = await countRecentEntriesByReviewer({
  reviewerTelegramId: input.reviewerTelegramId,
  withinHours: 24,
});
if (dailyCount >= 5) {
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: `Daily limit reached. Try again after ${fmtDateTime(resetAt)}.`,
      replyMarkup: buildRestartKeyboard(input.draft.targetGroupChatId),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add src/telegramBot.ts src/core/archiveStore.ts
git commit -m "feat(dm): rate-limit reviewers to 5 vouches per 24h"
```

### Task 10.5: Paused-state gating

**Files:**

- Create: `src/core/chatSettingsStore.ts`
- Modify: `src/telegramBot.ts`
- Modify: `src/core/storage/schema.ts` (already has `chatSettings` from chunk 4 — no change here)

- [ ] **Step 1: Implement the store helper**

```ts
import { eq } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { chatSettings } from "./storage/schema.ts";

export async function isChatPaused(chatId: number): Promise<boolean> {
  const rows = await db
    .select({ paused: chatSettings.paused })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));
  return rows[0]?.paused === true;
}

export async function setChatPaused(input: {
  chatId: number;
  paused: boolean;
  byTelegramId: number;
}): Promise<void> {
  await db
    .insert(chatSettings)
    .values({
      chatId: input.chatId,
      paused: input.paused,
      pausedAt: input.paused ? new Date() : null,
      pausedByTelegramId: input.paused ? input.byTelegramId : null,
    })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: {
        paused: input.paused,
        pausedAt: input.paused ? new Date() : null,
        pausedByTelegramId: input.paused ? input.byTelegramId : null,
        updatedAt: new Date(),
      },
    });
}
```

- [ ] **Step 2: Block new drafts when paused**

In `startDraftFlow`, before the `withReviewerDraftLock` block:

```ts
import { isChatPaused } from "./core/chatSettingsStore.ts";
// ...
if (await isChatPaused(resolvedTargetGroupChatId)) {
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: "Vouching is paused. An admin will lift this when ready. Use /recent to see the archive.",
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 3: Block in-flight Publish when paused**

In `handleCallbackQuery`, in the `action === "confirm"` branch, before the duplicate-check:

```ts
if (await isChatPaused(latestTargetGroupChatId)) {
  await answerTelegramCallbackQuery(
    { callbackQueryId: callbackQuery.id, text: "Vouching is paused.", showAlert: true },
    logger,
  );
  return;
}
```

- [ ] **Step 4: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/core/chatSettingsStore.ts src/telegramBot.ts
git commit -m "feat(dm): block new drafts and Publish when chat is paused"
```

### Task 10.6: View-this-entry deep link in confirmation

**Files:**

- Modify: `src/telegramBot.ts` (`handleCallbackQuery` confirm branch)

- [ ] **Step 1: Build the URL helper**

In a small helper at the top of `telegramBot.ts`:

```ts
function buildEntryDeepLink(chatId: number, messageId: number): string {
  // Telegram URL format: https://t.me/c/<chatPart>/<messageId>
  // Supergroup chat IDs are like -1001234567890; the chatPart drops the -100 prefix.
  const stringId = String(chatId);
  const chatPart = stringId.startsWith("-100") ? stringId.slice(4) : stringId.replace(/^-/, "");
  return `https://t.me/c/${chatPart}/${messageId}`;
}
```

- [ ] **Step 2: After `publishArchiveEntryRecord` returns, capture the published message id and embed it in the keyboard**

The publish function already stores `publishedMessageId` on the entry. After publish, fetch it and build a richer restart keyboard:

```ts
const publishedEntry = await getArchiveEntryById(createdEntry.id);
const viewUrl = publishedEntry?.publishedMessageId
  ? buildEntryDeepLink(latestTargetGroupChatId, publishedEntry.publishedMessageId)
  : null;

const confirmKeyboard = viewUrl
  ? buildInlineKeyboard([
      [{ text: "Start Another Vouch", callback_data: `archive:start:${latestTargetGroupChatId}` }],
      [{ text: "View this entry", url: viewUrl } as any], // url buttons accepted by buildInlineKeyboard's inline_keyboard structure
    ])
  : buildRestartKeyboard(latestTargetGroupChatId);
```

(`buildInlineKeyboard` currently constrains buttons to `{ text, callback_data }`. Loosen its parameter to accept `text + (callback_data | url)`. Make this change in `src/core/tools/telegramTools.ts`:)

```ts
type InlineKeyboardButton = { text: string } & ({ callback_data: string } | { url: string });

export function buildInlineKeyboard(buttons: InlineKeyboardButton[][]) {
  return { inline_keyboard: buttons };
}
```

Then use the typed object in `confirmKeyboard` directly without the `as any` cast.

- [ ] **Step 3: Use `confirmKeyboard` in the published-message edit**

In the `editTelegramMessage` call after publish, replace `replyMarkup: buildRestartKeyboard(latestTargetGroupChatId)` with `replyMarkup: confirmKeyboard`.

- [ ] **Step 4: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/telegramBot.ts src/core/tools/telegramTools.ts
git commit -m "feat(dm): add View this entry URL button to Posted confirmation"
```

### Task 10.7: Callback data length test

**Files:**

- Create: `src/core/callbackData.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

const KNOWN_CALLBACKS = [
  "archive:start",
  "archive:start:-1001234567890",
  "archive:start:-100999999999999999",
  "archive:result:positive",
  "archive:result:mixed",
  "archive:result:negative",
  "archive:tag:good_comms",
  "archive:tag:efficient",
  "archive:tag:on_time",
  "archive:tag:good_quality",
  "archive:tag:mixed_comms",
  "archive:tag:some_delays",
  "archive:tag:acceptable_quality",
  "archive:tag:minor_issue",
  "archive:tag:poor_comms",
  "archive:tag:late",
  "archive:tag:quality_issue",
  "archive:tag:item_mismatch",
  "archive:done",
  "archive:cancel",
  "archive:confirm",
];

test("every callback data string is <= 64 bytes", () => {
  for (const cb of KNOWN_CALLBACKS) {
    const bytes = Buffer.byteLength(cb, "utf8");
    assert.ok(bytes <= 64, `${cb} is ${bytes} bytes`);
  }
});
```

- [ ] **Step 2: Run**

Run: `node --test --experimental-strip-types src/core/callbackData.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add src/core/callbackData.test.ts
git commit -m "test: assert every callback_data string is <= 64 bytes"
```

---

## Chunk 11 — Admin flow

### Task 11.1: Admin audit log writer

**Files:**

- Create: `src/core/adminAuditStore.ts`

- [ ] **Step 1: Implement**

```ts
import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";

export type AdminAuditEntry = {
  adminTelegramId: number;
  adminUsername?: string | null;
  command: string;
  targetChatId?: number | null;
  targetUsername?: string | null;
  entryId?: number | null;
  reason?: string | null;
  denied?: boolean;
};

export async function recordAdminAction(entry: AdminAuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminTelegramId: entry.adminTelegramId,
    adminUsername: entry.adminUsername ?? null,
    command: entry.command,
    targetChatId: entry.targetChatId ?? null,
    targetUsername: entry.targetUsername ?? null,
    entryId: entry.entryId ?? null,
    reason: entry.reason ?? null,
    denied: entry.denied ?? false,
  });
}
```

- [ ] **Step 2: Commit**

```
git add src/core/adminAuditStore.ts
git commit -m "feat(admin): add admin audit log writer"
```

### Task 11.2: Wire audit logging into existing admin commands + denied attempts

**Files:**

- Modify: `src/telegramBot.ts` (`handleAdminCommand`)

- [ ] **Step 1: At the top of `handleAdminCommand`**

```ts
import { recordAdminAction } from "./core/adminAuditStore.ts";
// ...

if (!isAdmin(input.from?.id)) {
  await recordAdminAction({
    adminTelegramId: input.from?.id ?? 0,
    adminUsername: input.from?.username ?? null,
    command: input.command,
    targetChatId: input.chatId,
    targetUsername: input.args[0] ?? null,
    denied: true,
  });
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildAdminOnlyText(),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 2: After every successful admin action (within `/freeze`, `/unfreeze`, `/remove_entry`), add**

```ts
await recordAdminAction({
  adminTelegramId: input.from.id,
  adminUsername: input.from.username ?? null,
  command: input.command,
  targetChatId: input.chatId,
  targetUsername: targetUsername ?? null,
  entryId: entryId ?? null,
  reason: reasonText ?? null,
  denied: false,
});
```

- [ ] **Step 3: Commit**

```
git add src/telegramBot.ts
git commit -m "feat(admin): write every admin action and denial to admin_audit_log"
```

### Task 11.3: `/freeze` with reason

**Files:**

- Modify: `src/telegramBot.ts`
- Modify: `src/core/archiveStore.ts` (`setBusinessProfileFrozen`)

- [ ] **Step 1: Update `setBusinessProfileFrozen` signature**

```ts
export async function setBusinessProfileFrozen(input: {
  username: string;
  isFrozen: boolean;
  reason?: string | null;
  byTelegramId?: number | null;
}): Promise<{ username: string; isFrozen: boolean }> {
  const reasonTrimmed = input.reason?.trim().slice(0, 200) ?? null;
  const [updated] = await db
    .update(businessProfiles)
    .set({
      isFrozen: input.isFrozen,
      freezeReason: input.isFrozen ? reasonTrimmed : null,
      frozenAt: input.isFrozen ? new Date() : null,
      frozenByTelegramId: input.isFrozen ? (input.byTelegramId ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(businessProfiles.username, input.username))
    .returning({ username: businessProfiles.username, isFrozen: businessProfiles.isFrozen });
  if (!updated) {
    // Upsert path: profile may not exist yet
    const profile = await getOrCreateBusinessProfile(input.username);
    return setBusinessProfileFrozen({ ...input });
  }
  return updated;
}
```

- [ ] **Step 2: Update the `/freeze` branch in `handleAdminCommand`**

```ts
if (input.command === "/freeze" || input.command === "/unfreeze") {
  const targetUsername = normalizeUsername(input.args[0] ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Use: ${input.command} @username${input.command === "/freeze" ? " [reason]" : ""}.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  const reason = input.command === "/freeze" ? input.args.slice(1).join(" ") || null : null;
  const updated = await setBusinessProfileFrozen({
    username: targetUsername,
    isFrozen: input.command === "/freeze",
    reason,
    byTelegramId: input.from.id,
  });

  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: `${formatUsername(updated.username)} is now ${updated.isFrozen ? "frozen" : "active"}.`,
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 3: Commit**

```
git add src/telegramBot.ts src/core/archiveStore.ts
git commit -m "feat(admin): /freeze accepts an optional reason and stores it"
```

### Task 11.4: `/frozen_list`

**Files:**

- Modify: `src/telegramBot.ts`
- Modify: `src/core/archiveStore.ts` (`listFrozenProfiles`)
- Modify: `src/core/archive.ts` (`buildFrozenListText`)

- [ ] **Step 1: Add `listFrozenProfiles`**

```ts
export async function listFrozenProfiles(): Promise<
  Array<{
    username: string;
    freezeReason: string | null;
    frozenAt: Date | null;
  }>
> {
  return db
    .select({
      username: businessProfiles.username,
      freezeReason: businessProfiles.freezeReason,
      frozenAt: businessProfiles.frozenAt,
    })
    .from(businessProfiles)
    .where(eq(businessProfiles.isFrozen, true))
    .orderBy(desc(businessProfiles.frozenAt));
}
```

- [ ] **Step 2: Add `buildFrozenListText` in `archive.ts`**

```ts
export function buildFrozenListText(
  rows: Array<{ username: string; freezeReason: string | null; frozenAt: Date | null }>,
): string {
  if (rows.length === 0) {
    return "No frozen profiles.";
  }
  const lines = ["<b><u>Frozen profiles</u></b>", ""];
  let truncated = 0;
  let total = lines.join("\n").length;
  for (const row of rows.slice(0, 10)) {
    const date = row.frozenAt ? row.frozenAt.toISOString().slice(0, 10) : "unknown";
    const reason = row.freezeReason
      ? `<i>${escapeHtml(row.freezeReason)}</i>`
      : "<i>no reason given</i>";
    const line = `${fmtUser(row.username)} — frozen ${escapeHtml(date)} — ${reason}`;
    if (total + line.length + 1 > 3900) {
      truncated = rows.length - lines.length + 2;
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  if (rows.length > 10) {
    lines.push("");
    lines.push(`…and ${rows.length - 10} more — refine with /lookup @x`);
  }
  return lines.join("\n").trimEnd();
}
```

- [ ] **Step 3: Add the command branch in `handleAdminCommand`**

```ts
if (input.command === "/frozen_list") {
  const rows = await listFrozenProfiles();
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildFrozenListText(rows),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 4: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/telegramBot.ts src/core/archive.ts src/core/archiveStore.ts
git commit -m "feat(admin): /frozen_list lists frozen profiles with reason"
```

### Task 11.5: `/recover_entry`, `/pause`, `/unpause`

**Files:**

- Modify: `src/telegramBot.ts`
- Modify: `src/core/archiveStore.ts` (add `setArchiveEntryStatus` already exists; add `recoverArchiveEntry` if missing)

- [ ] **Step 1: Add command branches**

```ts
if (input.command === "/recover_entry") {
  const entryId = Number(input.args[0]);
  if (!Number.isInteger(entryId)) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Use: /recover_entry &lt;id&gt;.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
  const entry = await getArchiveEntryById(entryId);
  if (!entry) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Entry #${entryId} not found.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
  if (entry.status !== "publishing") {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Entry #${entryId} is in status="${entry.status}", no recovery needed.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
  await setArchiveEntryStatus(entryId, "pending");
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: `Entry #${entryId} reset to pending.`,
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}

if (input.command === "/pause" || input.command === "/unpause") {
  await setChatPaused({
    chatId: input.chatId,
    paused: input.command === "/pause",
    byTelegramId: input.from.id,
  });
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: input.command === "/pause" ? "Vouching paused." : "Vouching resumed.",
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 2: Add the new commands to the dispatch in `handlePrivateMessage` and `handleGroupMessage`**

Both files need the added command names in the `if (command === "/freeze" || ...)` group.

- [ ] **Step 3: Commit**

```
git add src/telegramBot.ts
git commit -m "feat(admin): /recover_entry, /pause, /unpause"
```

### Task 11.6: `/profile @x`

**Files:**

- Modify: `src/telegramBot.ts`
- Modify: `src/core/archiveStore.ts` (`getProfileSummary`)
- Modify: `src/core/archive.ts` (`buildProfileText`)

- [ ] **Step 1: Add `getProfileSummary`**

```ts
export async function getProfileSummary(targetUsername: string): Promise<{
  totals: { positive: number; mixed: number; negative: number };
  isFrozen: boolean;
  freezeReason: string | null;
  recent: Array<{ id: number; result: string; createdAt: Date }>;
}> {
  const profile = await db
    .select({ isFrozen: businessProfiles.isFrozen, freezeReason: businessProfiles.freezeReason })
    .from(businessProfiles)
    .where(eq(businessProfiles.username, targetUsername));
  const counts = await db
    .select({ result: vouchEntries.result, count: sql<number>`count(*)::int` })
    .from(vouchEntries)
    .where(
      and(eq(vouchEntries.targetUsername, targetUsername), eq(vouchEntries.status, "published")),
    )
    .groupBy(vouchEntries.result);
  const recent = await db
    .select({ id: vouchEntries.id, result: vouchEntries.result, createdAt: vouchEntries.createdAt })
    .from(vouchEntries)
    .where(
      and(eq(vouchEntries.targetUsername, targetUsername), eq(vouchEntries.status, "published")),
    )
    .orderBy(desc(vouchEntries.createdAt))
    .limit(5);
  const totals = { positive: 0, mixed: 0, negative: 0 };
  for (const row of counts) {
    if (row.result === "positive") totals.positive = row.count;
    else if (row.result === "mixed") totals.mixed = row.count;
    else if (row.result === "negative") totals.negative = row.count;
  }
  return {
    totals,
    isFrozen: profile[0]?.isFrozen ?? false,
    freezeReason: profile[0]?.freezeReason ?? null,
    recent,
  };
}
```

- [ ] **Step 2: Add `buildProfileText`**

```ts
export function buildProfileText(input: {
  targetUsername: string;
  totals: { positive: number; mixed: number; negative: number };
  isFrozen: boolean;
  freezeReason: string | null;
  recent: Array<{ id: number; result: string; createdAt: Date }>;
}): string {
  const status = input.isFrozen
    ? `Frozen — <i>${escapeHtml(input.freezeReason ?? "no reason given")}</i>`
    : "Active";
  const lines = [
    `<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`,
    `Positive: ${input.totals.positive} • Mixed: ${input.totals.mixed} • Negative: ${input.totals.negative}`,
    `Status: ${status}`,
  ];
  if (input.recent.length > 0) {
    lines.push("");
    lines.push("<b>Last 5 entries</b>");
    for (const r of input.recent) {
      lines.push(
        `<b>#${r.id}</b> — <b>${escapeHtml(RESULT_LABELS[r.result as keyof typeof RESULT_LABELS] ?? r.result)}</b> • ${escapeHtml(r.createdAt.toISOString().slice(0, 10))}`,
      );
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 3: Add the command handler `handleProfileCommand`**

```ts
async function handleProfileCommand(input: {
  chatId: number;
  rawUsername: string | null | undefined;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: LoggerLike;
}) {
  const targetUsername = normalizeUsername(input.rawUsername ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Use: /profile @username.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
  const summary = await getProfileSummary(targetUsername);
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildProfileText({ targetUsername, ...summary }),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
}
```

- [ ] **Step 4: Wire `handleProfileCommand` into `handlePrivateMessage` (any user) and `handleGroupMessage` (admins only)**

```ts
// in handlePrivateMessage:
if (command === "/profile") {
  await handleProfileCommand({ chatId, rawUsername: args[0], logger });
  return;
}

// in handleGroupMessage:
if (command === "/profile") {
  if (!isAdmin(message.from?.id)) {
    await sendTelegramMessage(
      { chatId, text: buildAdminOnlyText(), ...buildReplyOptions(message.message_id, true) },
      logger,
    );
    return;
  }
  await handleProfileCommand({
    chatId,
    rawUsername: args[0],
    replyToMessageId: message.message_id,
    disableNotification: true,
    logger,
  });
  return;
}
```

- [ ] **Step 5: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/telegramBot.ts src/core/archive.ts src/core/archiveStore.ts
git commit -m "feat(admin): /profile @x shows totals and last 5 entries"
```

### Task 11.7: `/admin_help`

**Files:**

- Modify: `src/telegramBot.ts`
- Modify: `src/core/archive.ts` (`buildAdminHelpText`)

- [ ] **Step 1: Add `buildAdminHelpText`**

```ts
export function buildAdminHelpText(): string {
  return [
    "<b><u>Admin commands</u></b>",
    "",
    "/freeze @x [reason] — block new entries",
    "/unfreeze @x — allow entries again",
    "/frozen_list — show frozen profiles",
    "/remove_entry &lt;id&gt; — delete an entry",
    "/recover_entry &lt;id&gt; — clear stuck publishing",
    "/profile @x — entry totals",
    "/lookup @x — full audit list",
    "/pause — pause new vouches",
    "/unpause — resume vouches",
  ].join("\n");
}
```

- [ ] **Step 2: Add the command branch**

```ts
if (input.command === "/admin_help") {
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildAdminHelpText(),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
  return;
}
```

- [ ] **Step 3: Add to dispatch in `handlePrivateMessage` and `handleGroupMessage`**

- [ ] **Step 4: Commit**

```
git add src/telegramBot.ts src/core/archive.ts
git commit -m "feat(admin): /admin_help reference list"
```

---

## Chunk 12 — Group flow: launcher debounce, my_chat_member, supergroup migration

### Task 12.1: Launcher debounce

**Files:**

- Modify: `src/core/archiveLauncher.ts`
- Modify: `src/core/archiveStore.ts` (helper to read `chat_launchers.updatedAt`)

- [ ] **Step 1: Add a 30-sec debounce check at the start of `refreshGroupLauncher`**

```ts
const DEBOUNCE_MS = 30_000;

export async function refreshGroupLauncher(chatId: number, logger?: any) {
  await withChatLauncherLock(chatId, async () => {
    const existing = await getLauncherByChatId(chatId);
    if (existing && Date.now() - existing.updatedAt.getTime() < DEBOUNCE_MS) {
      logger?.info?.("[Archive] Launcher refresh debounced", {
        chatId,
        ageMs: Date.now() - existing.updatedAt.getTime(),
      });
      return;
    }

    if (existing) {
      try {
        await deleteTelegramMessage({ chatId, messageId: existing.messageId }, logger);
      } catch (error) {
        logger?.warn?.("⚠️ [Archive] Failed to delete previous launcher", {
          error,
          chatId,
          messageId: existing.messageId,
        });
      }
    }

    const launcher = await sendLauncherPrompt(chatId, logger);
    await saveLauncherMessage(chatId, launcher.message_id);
  });
}
```

- [ ] **Step 2: Ensure `getLauncherByChatId` returns `updatedAt`**

If it does not, extend the SELECT to include the column.

- [ ] **Step 3: Commit**

```
git add src/core/archiveLauncher.ts src/core/archiveStore.ts
git commit -m "feat(group): debounce launcher refresh to 30 sec"
```

### Task 12.2: Subscribe to `my_chat_member` updates

**Files:**

- Modify: `src/telegramBot.ts` (in `processTelegramUpdate`)
- Modify: `scripts/setTelegramWebhook.ts` (to include `my_chat_member` in `allowed_updates` — done in chunk 13)

- [ ] **Step 1: Handle `my_chat_member`**

In `processTelegramUpdate`, after the callback/private/group branches, add:

```ts
if (payload.my_chat_member) {
  await handleMyChatMember(payload.my_chat_member, logger);
} else if (...) { ... } else {
  logger.info("Ignored unsupported Telegram update");
}
```

Define:

```ts
async function handleMyChatMember(update: any, logger?: LoggerLike) {
  const chatId = update.chat?.id;
  const newStatus = update.new_chat_member?.status;
  if (!chatId || !newStatus) return;

  if (newStatus === "kicked" || newStatus === "left") {
    await db
      .insert(chatSettings)
      .values({ chatId, status: "kicked" })
      .onConflictDoUpdate({
        target: chatSettings.chatId,
        set: { status: "kicked", updatedAt: new Date() },
      });
    logger?.info?.("[Group] Bot lost access", { chatId, newStatus });
  }
}
```

(Import `chatSettings` from schema and `db` from storage at the top of the file.)

- [ ] **Step 2: Skip work for chats marked kicked**

In `refreshGroupLauncher`, before any send, check `chat_settings.status`:

```ts
const settings = await db
  .select({ status: chatSettings.status })
  .from(chatSettings)
  .where(eq(chatSettings.chatId, chatId));
if (settings[0]?.status === "kicked") {
  logger?.info?.("[Archive] Skipping launcher refresh for kicked chat", { chatId });
  return;
}
```

- [ ] **Step 3: Commit**

```
git add src/telegramBot.ts src/core/archiveLauncher.ts
git commit -m "feat(group): handle my_chat_member kicked/left and skip dead chats"
```

### Task 12.3: Supergroup migration

**Files:**

- Modify: `src/telegramBot.ts` (in `handleGroupMessage`)

- [ ] **Step 1: Detect `migrate_to_chat_id`**

Top of `handleGroupMessage`:

```ts
if (message.migrate_to_chat_id) {
  const oldId = message.chat.id;
  const newId = Number(message.migrate_to_chat_id);
  if (Number.isSafeInteger(newId)) {
    await db
      .insert(chatSettings)
      .values({ chatId: oldId, status: "migrated_away", migratedToChatId: newId })
      .onConflictDoUpdate({
        target: chatSettings.chatId,
        set: { status: "migrated_away", migratedToChatId: newId, updatedAt: new Date() },
      });
    logger?.info?.("[Group] Chat migrated to supergroup", { oldId, newId });
  }
  return;
}
```

- [ ] **Step 2: Commit**

```
git add src/telegramBot.ts
git commit -m "feat(group): record supergroup migration to chat_settings"
```

---

## Chunk 13 — Webhook hardening

### Task 13.1: Update `setTelegramWebhook` script

**Files:**

- Modify: `scripts/setTelegramWebhook.ts`

- [ ] **Step 1: Read the current script**

Run: `cat scripts/setTelegramWebhook.ts`

- [ ] **Step 2: In the `setWebhook` payload, add the new fields**

```ts
const payload = {
  url: `${publicBaseUrl}/webhooks/telegram/action`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  max_connections: 10,
  drop_pending_updates: true,
};
```

- [ ] **Step 3: Print `getWebhookInfo` after registration**

After the `setWebhook` call:

```ts
const info = await callTelegramAPI("getWebhookInfo", {});
console.info(JSON.stringify({ ok: true, info }, null, 2));
```

- [ ] **Step 4: Dry-run smoke**

Run: `npm run telegram:webhook -- --help` (or just review the diff).

- [ ] **Step 5: Commit**

```
git add scripts/setTelegramWebhook.ts
git commit -m "feat(webhook): set allowed_updates, max_connections=10, drop_pending"
```

### Task 13.2: 25-sec safety on the webhook handler

**Files:**

- Modify: `src/server.ts`

- [ ] **Step 1: Wrap `processTelegramUpdate` in a timeout**

In the `/webhooks/telegram/action` block:

```ts
const TIMEOUT_MS = 25_000;
const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
  setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS).unref?.(),
);
const work = processTelegramUpdate(payload, console).then(() => ({ timeout: false }));
const outcome = await Promise.race([work, timeoutPromise]);
if ("timeout" in outcome && outcome.timeout) {
  console.error("Telegram update processing exceeded 25s; returning 200 to avoid retry loop", {
    update_id: payload.update_id,
  });
}
```

- [ ] **Step 2: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add src/server.ts
git commit -m "feat(server): 25s safety on webhook processing"
```

---

## Chunk 14 — Observability (pino)

### Task 14.1: Add pino with redact paths

**Files:**

- Create: `src/core/logger.ts`
- Modify: `package.json` (add pino)
- Modify: `src/server.ts` (use logger)

- [ ] **Step 1: Install pino**

Run: `npm install --save-exact pino@^9.5.0`

- [ ] **Step 2: Create the logger factory**

```ts
import { pino } from "pino";

export function createLogger(opts: { level?: string } = {}) {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "*.token",
        "*.secret",
        "*.password",
        "*.api_key",
        "*.authorization",
        "headers.authorization",
        "params.token",
      ],
      censor: "[REDACTED]",
    },
  });
}
```

- [ ] **Step 3: Replace `console.*` calls in `server.ts` with `logger.*`**

```ts
import { createLogger } from "./core/logger.ts";
const logger = createLogger();
// ... pass `logger` instead of `console` to processTelegramUpdate
```

- [ ] **Step 4: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/core/logger.ts src/server.ts package.json package-lock.json
git commit -m "feat(obs): adopt pino with redact paths for tokens and secrets"
```

---

## Chunk 15 — Connection pool sizing

### Task 15.1: Configure `pg.Pool` max:5

**Files:**

- Modify: `src/core/storage/db.ts`

- [ ] **Step 1: Read the current db.ts**

Run: `cat src/core/storage/db.ts`

- [ ] **Step 2: Pass `max: 5` to the Pool constructor**

Update the Pool init:

```ts
export const sharedPostgresPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
```

- [ ] **Step 3: Test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add src/core/storage/db.ts
git commit -m "perf(db): cap pg.Pool max at 5 to match webhook concurrency"
```

---

## Chunk 16 — Railway migration: DEPLOY.md, dump/restore, webhook switch

### Task 16.1: Replace `DEPLOY_REPLIT.md` with `DEPLOY.md`

**Files:**

- Delete: `DEPLOY_REPLIT.md`
- Create: `DEPLOY.md`

- [ ] **Step 1: Write `DEPLOY.md`**

```markdown
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

````

Optional: `TELEGRAM_BOT_USERNAME`, `LEGACY_BOT_SENDERS`.

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
````

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

```

- [ ] **Step 2: Delete `DEPLOY_REPLIT.md`**

Run: `git rm DEPLOY_REPLIT.md`

- [ ] **Step 3: Commit**

```

git add DEPLOY.md
git commit -m "docs: replace DEPLOY_REPLIT.md with Railway DEPLOY.md"

```

### Task 16.2: Update `.env.example` for Railway

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace the file**

Replace Replit-specific guidance with Railway-equivalent. Add `LEGACY_BOT_SENDERS` and `NODE_ENV`.

- [ ] **Step 2: Commit**

```

git add .env.example
git commit -m "docs: update .env.example for Railway and new env vars"

```

---

## Chunk 17 — Run legacy replay

### Task 17.1: Dry-run the replay against the export JSON

**Files:** none (operational task)

- [ ] **Step 1: Acquire the export JSON**

Place at `imports/result.json` (gitignored).

- [ ] **Step 2: Dry-run**

```

npm run replay:legacy imports/result.json -- --dry-run --review-report imports/review.json

```

Expected: `summary.wouldImport > 0`, `summary.skippedBotSender > 0`, `summary.skippedMultipleTargets > 0`, `summary.skippedMissingReviewer == 0` (since numeric `from_id` fallback should resolve everyone).

- [ ] **Step 3: Inspect the review report**

Run: `head -200 imports/review.json | less`

Spot-check that the bot-sender bucket contains expected accounts; the unclear-sentiment bucket is non-trivial; missing-target are all reply-context posts.

### Task 17.2: Live small batch (5)

- [ ] **Step 1: Live run with `--max-imports 5`**

```

npm run replay:legacy imports/result.json -- --max-imports 5 --throttle-ms 3100 --review-report imports/live5-review.json --checkpoint imports/live5-checkpoint.json

```

Expected: 5 messages posted to the live group, ~17 seconds elapsed.

- [ ] **Step 2: Verify in Telegram** that the 5 entries look correct (entry numbers, OP @username, target @username, result, "Original: YYYY-MM-DD" line for legacy entries).

### Task 17.3: Full replay

- [ ] **Step 1: Run without `--max-imports`**

```

npm run replay:legacy imports/result.json -- --throttle-ms 3100 --review-report imports/full-review.json --checkpoint imports/full-checkpoint.json

````

Expected: ~100 minutes for 2,000 entries at 3.1s/send. Run in a Railway shell or under `nohup` so the process survives terminal disconnect.

- [ ] **Step 2: Verify** by spot-checking the group: launcher refreshed once at the end (debounce kicks in for all interim refreshes); no 429-induced gaps.

---

## Self-review

### Coverage check (each spec section → task)

- §2 bot identity → 9.1, 9.2 ✓
- §3 commands → 9.2, 10.1 (drop /verify), 10.2 (/lookup), 10.3 (/cancel), 11.* (admin commands) ✓
- §4 DM flow → 10.* ✓
- §5 group flow → 12.* ✓
- §6 admin flow → 11.* ✓
- §7 formatting → 11.4 (frozen list truncation), 9.* (copy enforces sentence case + emoji rules) ✓ — **gap: explicit 4096-char ceiling test in `/lookup` and `/recent` is not its own task**. Fix below.
- §8 rate limits → 7.1 (token bucket), 13.* (webhook), implicit in §10 — **gap: `withTelegramRetry` typed-error wrapper not its own task**. Fix below.
- §9 webhook → 13.* ✓
- §10 legacy replay → 6.* (parser), 7.* (script) ✓
- §11 Railway → 16.* ✓
- §12 schema → 4.* ✓
- §13 layout → 1.*, 5.*, 2.1, 2.2, 1.3 ✓
- §14 final copy → 9.*, 11.* (frozen_list, profile, admin_help), 10.3 (cancel) ✓ — copy for E25/E26 errors implicit in 10.4/10.5.
- §15 local dev/ops → 16.1 (DEPLOY.md runbook), 14.* (pino) ✓
- §16 testing → tests authored alongside each task ✓
- §17 implementation order → matches plan section ordering ✓
- §18 locked decisions → all reflected in tasks ✓
- §19 trust model — informational only; nothing to implement ✓

**Two gaps spotted; adding tasks below:**

### Task 18.1 (gap fill): `withTelegramRetry` and typed errors

**Files:**
- Create: `src/core/typedTelegramErrors.ts`
- Create: `src/core/withTelegramRetry.ts`
- Create: `src/core/withTelegramRetry.test.ts`
- Modify: `src/core/tools/telegramTools.ts` to use the wrapper and throw typed errors

- [ ] **Step 1: Create `typedTelegramErrors.ts`**

```ts
export class TelegramApiError extends Error {
  readonly errorCode: number;
  readonly description: string;
  readonly retryAfter?: number;
  constructor(errorCode: number, description: string, retryAfter?: number) {
    super(`Telegram API error ${errorCode}: ${description}`);
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

export class TelegramRateLimitError extends TelegramApiError {}
export class TelegramForbiddenError extends TelegramApiError {}
export class TelegramChatGoneError extends TelegramApiError {}
````

- [ ] **Step 2: Create `withTelegramRetry.ts`**

```ts
import { TelegramApiError, TelegramRateLimitError } from "./typedTelegramErrors.ts";

export async function withTelegramRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 2;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (err instanceof TelegramRateLimitError && attempt < max) {
        await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000 + 100));
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 3: Update `tools/telegramTools.ts` `callTelegramAPI` to throw typed errors**

```ts
if (!data.ok) {
  const desc = String(data.description ?? "");
  const code = Number(data.error_code ?? 0);
  if (code === 429) {
    throw new TelegramRateLimitError(code, desc, Number(data.parameters?.retry_after ?? 0));
  }
  if (code === 403 && /bot was blocked by the user|bot is not a member/i.test(desc)) {
    throw new TelegramForbiddenError(code, desc);
  }
  if (code === 400 && /chat not found/i.test(desc)) {
    throw new TelegramChatGoneError(code, desc);
  }
  throw new TelegramApiError(code, desc);
}
```

- [ ] **Step 4: Wrap each public send/edit/delete call inside `withTelegramRetry`**

```ts
export async function sendTelegramMessage(input: ..., logger?: any) {
  return withTelegramRetry(() => callTelegramAPI("sendMessage", buildTelegramSendMessageParams(input), logger));
}
```

Same for `editTelegramMessage`, `deleteTelegramMessage`, `answerTelegramCallbackQuery`.

- [ ] **Step 5: Test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTelegramRetry } from "./withTelegramRetry.ts";
import { TelegramRateLimitError } from "./typedTelegramErrors.ts";

test("retries once on TelegramRateLimitError honouring retry_after", async () => {
  let calls = 0;
  const start = Date.now();
  await withTelegramRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TelegramRateLimitError(429, "Too Many Requests", 1);
    return "ok";
  });
  const elapsed = Date.now() - start;
  assert.equal(calls, 2);
  assert.ok(elapsed >= 900);
});

test("does not retry on second 429", async () => {
  let calls = 0;
  await assert.rejects(
    withTelegramRetry(async () => {
      calls += 1;
      throw new TelegramRateLimitError(429, "Too Many Requests", 0);
    }),
    TelegramRateLimitError,
  );
  assert.equal(calls, 2);
});
```

- [ ] **Step 6: Run, commit**

Run: `npm test`
Expected: PASS.

```
git add src/core/typedTelegramErrors.ts src/core/withTelegramRetry.ts src/core/withTelegramRetry.test.ts src/core/tools/telegramTools.ts
git commit -m "feat(telegram): typed errors + withTelegramRetry wrapper"
```

### Task 18.2 (gap fill): 4096-char ceiling truncation

**Files:**

- Modify: `src/core/archive.ts` (`buildLookupText`, `buildRecentEntriesText`)
- Create: `src/core/formattingCeiling.test.ts`

- [ ] **Step 1: Add a generic truncator**

```ts
const SAFE_LIMIT = 3900;

function withCeiling(lines: string[], more: number): string {
  let total = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (total + line.length + 1 > SAFE_LIMIT) {
      out.push(`…and ${lines.length - out.length + more} more.`);
      break;
    }
    out.push(line);
    total += line.length + 1;
  }
  return out.join("\n");
}
```

- [ ] **Step 2: Use it in `buildLookupText` and `buildRecentEntriesText`**

(Refactor each to build a flat list of formatted lines and then call `withCeiling(lines, 0)`.)

- [ ] **Step 3: Test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLookupText } from "./archive.ts";

test("lookup truncates to <= 4096 chars with …and N more.", () => {
  const entries = Array.from({ length: 100 }).map((_, i) => ({
    id: i,
    reviewerUsername: "alice_" + i,
    result: "positive" as const,
    tags: ["good_comms" as const, "efficient" as const],
    createdAt: new Date(),
  }));
  const text = buildLookupText({ targetUsername: "bob_target", entries });
  assert.ok(text.length <= 4096);
  assert.match(text, /…and \d+ more\./);
});
```

- [ ] **Step 4: Run, commit**

```
git add src/core/archive.ts src/core/formattingCeiling.test.ts
git commit -m "feat(format): truncate /lookup and /recent at 3900 chars"
```

### Placeholder scan

- No "TBD" / "TODO" / "implement later" / vague directives. ✓
- Every code step has a concrete code block. ✓
- Every test step has assertions. ✓
- File paths are exact. ✓

### Type consistency

- `TelegramRateLimitError`, `TelegramForbiddenError`, `TelegramChatGoneError` defined once in 18.1 and referenced in 7.3 (replay 429 handling) and 10.\* implicitly via wrapped sends. ✓
- `chatSettings` table created in Task 4.2 and used in 10.5 (paused), 12.2 (kicked), 12.3 (migrated_away). ✓
- `setBusinessProfileFrozen` argument shape locked at Task 11.3 (object input). Earlier code in `telegramBot.ts` calls it with positional args; the call sites are updated within Task 11.3.
- `setChatPaused` introduced in 10.5; called in 11.5 (`/pause` /`/unpause`). ✓
- `recordAdminAction` introduced in 11.1 and used in 11.2/11.3/11.4/11.5/11.6/11.7 — all admin command handlers must add the call (referenced in 11.2 step 2 generically; reapply per-command).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-vouchvault-redesign.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
