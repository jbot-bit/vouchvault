// Posts a tiny set of synthetic format-demo entries into a Telegram chat
// using the live `buildArchiveEntryText` formatter. NO DATABASE, NO PARSER —
// just hand-picked content to validate that what the group sees in Telegram
// matches the intended look. Run when you want to eyeball the format
// without committing to a real replay.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/smokePostFormatDemo.ts --target-chat-id <id>

import process from "node:process";

import {
  buildArchiveEntryText,
  type EntryResult,
  type EntrySource,
  type EntryTag,
} from "../src/core/archive.ts";

type Demo = {
  label: string;
  source: EntrySource;
  reviewer: string;
  target: string;
  result: EntryResult;
  tags: EntryTag[];
  legacySourceTimestamp?: Date | null;
};

const DEMOS: Demo[] = [
  {
    label: "live positive (no heading, what fresh DM-vouches look like)",
    source: "live",
    reviewer: "alice",
    target: "bobbiz",
    result: "positive",
    tags: ["good_comms", "on_time"],
  },
  {
    label: "legacy positive (From the Vault + original date)",
    source: "legacy_import",
    reviewer: "rixx_aus",
    target: "mordecai_on",
    result: "positive",
    tags: ["good_comms"],
    legacySourceTimestamp: new Date(Date.UTC(2026, 3, 5, 12)),
  },
  {
    label: "legacy negative (From the Vault, neg)",
    source: "legacy_import",
    reviewer: "yeacuzzz",
    target: "rikorunna",
    result: "negative",
    tags: ["poor_comms"],
    legacySourceTimestamp: new Date(Date.UTC(2025, 10, 23, 12)),
  },
  {
    label: "legacy positive from a DELETED ACCOUNT (synthetic legacy_<id> reviewer)",
    source: "legacy_import",
    reviewer: "legacy_8448430705",
    target: "cool_ridge",
    result: "positive",
    tags: ["good_comms"],
    legacySourceTimestamp: new Date(Date.UTC(2025, 10, 11, 12)),
  },
];

function parseTargetChatId(argv: string[]): number {
  const idx = argv.indexOf("--target-chat-id");
  if (idx < 0) {
    throw new Error("Missing --target-chat-id <id>");
  }
  const value = Number(argv[idx + 1]);
  if (!Number.isFinite(value)) {
    throw new Error("--target-chat-id must be a number");
  }
  return value;
}

async function sendMessage(chatId: number, text: string, token: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: true,
    }),
  });
  const data = (await response.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description ?? response.statusText}`);
  }
}

async function main() {
  const targetChatId = parseTargetChatId(process.argv.slice(2));
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN missing — paste it into .env.local first.");
  }

  console.info(`Posting ${DEMOS.length} format-demo entries to chat ${targetChatId}...`);

  for (let i = 0; i < DEMOS.length; i += 1) {
    const demo = DEMOS[i]!;
    const text = buildArchiveEntryText({
      entryId: i + 1,
      reviewerUsername: demo.reviewer,
      targetUsername: demo.target,
      entryType: "service",
      result: demo.result,
      tags: demo.tags,
      createdAt: new Date(),
      source: demo.source,
      legacySourceTimestamp: demo.legacySourceTimestamp ?? null,
    });

    process.stdout.write(`[${i + 1}/${DEMOS.length}] ${demo.label} ... `);
    try {
      await sendMessage(targetChatId, text, token);
      process.stdout.write("OK\n");
    } catch (error) {
      process.stdout.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  console.info("\nFormat-demo complete. Check the test group.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
