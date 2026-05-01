// Boot-time bootstrap: makes Railway deploys self-configuring.
//
// Runs:
//   1. Drizzle migrations (required — exit 1 on failure).
//   2. setWebhook with allowed_updates + secret_token (best-effort).
//   3. setMyName / setMyDescription / setMyShortDescription (best-effort).
//   4. setMyCommands across the four scopes (best-effort).
//
// Skipped (operator action):
//   - Pinned guide post (sendMessage + pinChatMessage). Non-idempotent;
//     would post a NEW guide on every redeploy. Pin the existing guide
//     manually in Telegram (long-press → Pin) once.
//   - BotFather /setprivacy → Disable. Server-side BotFather state.
//   - BotFather /setinline + /setinlinefeedback. Server-side.
//
// Env required: DATABASE_URL, TELEGRAM_BOT_TOKEN.
// Env recommended: PUBLIC_BASE_URL, TELEGRAM_WEBHOOK_SECRET_TOKEN.
//
// All Telegram steps are best-effort: a failure logs and continues so
// boot doesn't get stuck on a transient API blip.

import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  buildBotDescriptionText,
  buildBotShortDescription,
} from "../src/core/archive.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

async function callTelegram(method: string, payload: any): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description ?? "unknown"}`);
  }
  return data.result;
}

async function runMigrations() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./migrations" });
    console.info("[bootstrap] migrations applied");
  } finally {
    await pool.end();
  }
}

function resolveBaseUrl(): string | null {
  const v =
    process.env.PUBLIC_BASE_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`) ||
    null;
  return v ? v.replace(/\/+$/, "") : null;
}

async function setupWebhook(): Promise<void> {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    console.warn("[bootstrap] PUBLIC_BASE_URL not set — skipping setWebhook");
    return;
  }
  const payload: Record<string, unknown> = {
    url: `${baseUrl}/webhooks/telegram/action`,
    allowed_updates: [
      "message",
      "edited_message",
      "callback_query",
      "my_chat_member",
      "chat_member",
      "chat_join_request",
      "inline_query",
      "chosen_inline_result",
    ],
    max_connections: 10,
    drop_pending_updates: true,
  };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  if (secret) payload.secret_token = secret;
  await callTelegram("setWebhook", payload);
  console.info("[bootstrap] webhook registered:", payload.url);
}

const DEFAULT_COMMANDS = [
  { command: "start", description: "Get started with the bot" },
  { command: "help", description: "How to use the bot" },
  { command: "lookup", description: "Look up a vouch — /lookup @username" },
];

const ADMIN_COMMANDS = [
  ...DEFAULT_COMMANDS,
  { command: "freeze", description: "Freeze a profile" },
  { command: "unfreeze", description: "Unfreeze a profile" },
  { command: "frozen_list", description: "List frozen profiles" },
  { command: "remove_entry", description: "Remove an entry by id" },
  { command: "recover_entry", description: "Recover a removed entry" },
  { command: "pause", description: "Pause posting in a chat" },
  { command: "unpause", description: "Resume posting" },
  { command: "forgeries", description: "Audit recent forgeries" },
  { command: "purge_forgeries", description: "Sweep forgeries (dry-run by default)" },
  { command: "admin_help", description: "Admin command help" },
];

async function setupBotIdentity(): Promise<void> {
  await callTelegram("setMyName", { name: "Vouch Hub" });
  await callTelegram("setMyDescription", { description: buildBotDescriptionText() });
  await callTelegram("setMyShortDescription", { short_description: buildBotShortDescription() });
  await callTelegram("setMyCommands", { commands: DEFAULT_COMMANDS });
  await callTelegram("setMyCommands", {
    commands: DEFAULT_COMMANDS,
    scope: { type: "all_private_chats" },
  });
  await callTelegram("setMyCommands", {
    commands: DEFAULT_COMMANDS,
    scope: { type: "all_group_chats" },
  });
  await callTelegram("setMyCommands", {
    commands: ADMIN_COMMANDS,
    scope: { type: "all_chat_administrators" },
  });
  console.info("[bootstrap] bot identity + commands set");
}

async function main() {
  // (1) Migrations — required.
  try {
    await runMigrations();
  } catch (error) {
    console.error("[bootstrap] migrations FAILED — aborting boot", error);
    process.exitCode = 1;
    return;
  }

  // (2) Webhook — best-effort.
  try {
    await setupWebhook();
  } catch (error) {
    console.warn("[bootstrap] setWebhook failed (non-fatal):", error);
  }

  // (3) Bot identity + commands — best-effort.
  if (process.env.BOOTSTRAP_SKIP_IDENTITY === "true") {
    console.info("[bootstrap] BOOTSTRAP_SKIP_IDENTITY=true — skipping identity");
  } else {
    try {
      await setupBotIdentity();
    } catch (error) {
      console.warn("[bootstrap] bot identity setup failed (non-fatal):", error);
    }
  }

  console.info("[bootstrap] complete");
}

main().catch((error) => {
  console.error("[bootstrap] fatal", error);
  process.exitCode = 1;
});
