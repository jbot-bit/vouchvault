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

// Wraps a Telegram setMy* call with a "skip if unchanged" guard. Telegram
// rate-limits identity changes (setMyName especially — once-per-day-ish);
// blindly calling on every Railway redeploy hits 429 and trips the 78k
// retry-after clock. Pattern: GET first, compare, only POST on diff.
async function setIfChanged(input: {
  getter: { method: string; payload?: any; field: string };
  setter: { method: string; payload: any };
  label: string;
}): Promise<"set" | "unchanged" | "skipped"> {
  try {
    const current = await callTelegram(input.getter.method, input.getter.payload ?? {});
    const currentValue = (current as any)?.[input.getter.field];
    const desired = (input.setter.payload as any)[
      Object.keys(input.setter.payload).find((k) => k !== "scope") as string
    ];
    if (currentValue === desired) {
      console.info(`[bootstrap] ${input.label}: unchanged, skipping`);
      return "unchanged";
    }
    await callTelegram(input.setter.method, input.setter.payload);
    console.info(`[bootstrap] ${input.label}: updated`);
    return "set";
  } catch (error) {
    console.warn(
      `[bootstrap] ${input.label}: failed (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
    return "skipped";
  }
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
  { command: "start", description: "Get started" },
  { command: "search", description: "Search community vouches — /search @username" },
  { command: "policy", description: "Data handling + Telegram policies" },
  { command: "forgetme", description: "Delete vouches you've written" },
];

const ADMIN_COMMANDS = [
  ...DEFAULT_COMMANDS,
  { command: "freeze", description: "Freeze a profile" },
  { command: "unfreeze", description: "Unfreeze a profile" },
  { command: "frozen_list", description: "List frozen profiles" },
  { command: "remove_entry", description: "Remove an entry by id" },
  { command: "recover_entry", description: "Recover a stuck entry" },
  { command: "pause", description: "Pause posting in a chat" },
  { command: "unpause", description: "Resume posting" },
  { command: "dbstats", description: "DB diagnostics" },
  { command: "admin_help", description: "Admin command help" },
];

async function setupBotIdentity(): Promise<void> {
  // Identity overrides via env. If unset, fall back to spec-locked text.
  // Telegram caps: name ≤ 64 chars, description ≤ 512, short_description ≤ 120.
  const name = (process.env.BOT_DISPLAY_NAME?.trim() || "SC45").slice(0, 64);
  const description = (
    process.env.BOT_DESCRIPTION?.trim() || buildBotDescriptionText()
  ).slice(0, 512);
  const shortDescription = (
    process.env.BOT_SHORT_DESCRIPTION?.trim() || buildBotShortDescription()
  ).slice(0, 120);

  // Each identity field is GET-then-set-on-diff so a redeploy doesn't
  // burn Telegram rate-limit budget. setMyName has the tightest bucket
  // (single-digit calls per day) and was previously hitting 429 on
  // every Railway boot.
  await setIfChanged({
    label: "setMyName",
    getter: { method: "getMyName", field: "name" },
    setter: { method: "setMyName", payload: { name } },
  });
  await setIfChanged({
    label: "setMyDescription",
    getter: { method: "getMyDescription", field: "description" },
    setter: { method: "setMyDescription", payload: { description } },
  });
  await setIfChanged({
    label: "setMyShortDescription",
    getter: { method: "getMyShortDescription", field: "short_description" },
    setter: {
      method: "setMyShortDescription",
      payload: { short_description: shortDescription },
    },
  });

  // Commands: setMyCommands is more lenient on rate-limit and the diff
  // check would require deep-comparing arrays per scope. Just set them;
  // wrap each call so a single 429 doesn't bail the rest.
  const commandSets = [
    { commands: DEFAULT_COMMANDS, scope: undefined, label: "default" },
    {
      commands: DEFAULT_COMMANDS,
      scope: { type: "all_private_chats" } as const,
      label: "private",
    },
    {
      commands: DEFAULT_COMMANDS,
      scope: { type: "all_group_chats" } as const,
      label: "group",
    },
    {
      commands: ADMIN_COMMANDS,
      scope: { type: "all_chat_administrators" } as const,
      label: "admin",
    },
  ];
  for (const cs of commandSets) {
    try {
      await callTelegram("setMyCommands", {
        commands: cs.commands,
        ...(cs.scope ? { scope: cs.scope } : {}),
      });
    } catch (error) {
      console.warn(
        `[bootstrap] setMyCommands(${cs.label}) failed (non-fatal):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
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
