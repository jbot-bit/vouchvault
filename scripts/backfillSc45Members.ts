// Inline-cards phase 0: one-shot SC45 member registry backfill.
//
// Telegram doesn't expose a full member-list API. This script seeds the
// sc45_members table from getChatAdministrators (admins only). Regular
// members are auto-registered the first time they post in SC45 (handled
// in handleGroupMessage).
//
// Usage:
//   npm run sc45:backfill-members
//
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_IDS in env.
// Idempotent — safe to re-run after operator changes.

import { callTelegramAPI } from "../src/core/tools/telegramTools.ts";
import { withTelegramRetry } from "../src/core/withTelegramRetry.ts";
import { upsertMember } from "../src/core/sc45MembersStore.ts";
import { createLogger } from "../src/core/logger.ts";
import { TelegramChatGoneError } from "../src/core/typedTelegramErrors.ts";
import { pool } from "../src/core/storage/db.ts";

type AdminEntry = {
  user: { id: number; is_bot?: boolean };
  status: string;
};

async function backfillChat(chatId: number, logger: ReturnType<typeof createLogger>) {
  let admins: AdminEntry[];
  try {
    admins = (await withTelegramRetry(() =>
      callTelegramAPI("getChatAdministrators", { chat_id: chatId }, logger, chatId),
    )) as AdminEntry[];
  } catch (error) {
    if (error instanceof TelegramChatGoneError) {
      logger.warn({ chatId }, "[backfill] chat is gone — skipping");
      return { upserted: 0, skipped: true };
    }
    throw error;
  }

  let upserted = 0;
  for (const admin of admins) {
    if (!admin?.user || typeof admin.user.id !== "number") continue;
    if (admin.user.is_bot) continue;
    try {
      await upsertMember({ userId: admin.user.id, status: admin.status });
      upserted += 1;
    } catch (error) {
      logger.warn(
        { chatId, userId: admin.user.id, status: admin.status, error },
        "[backfill] upsertMember failed",
      );
    }
  }
  return { upserted, skipped: false };
}

async function main() {
  const logger = createLogger();
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!raw) {
    logger.error("TELEGRAM_ALLOWED_CHAT_IDS is required");
    process.exit(1);
  }
  const chatIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isSafeInteger(n));

  if (chatIds.length === 0) {
    logger.error({ raw }, "No valid chat ids parsed from TELEGRAM_ALLOWED_CHAT_IDS");
    process.exit(1);
  }

  let total = 0;
  for (const chatId of chatIds) {
    const { upserted, skipped } = await backfillChat(chatId, logger);
    if (!skipped) {
      total += upserted;
      logger.info({ chatId, upserted }, "[backfill] chat complete");
    }
  }
  logger.info({ chatCount: chatIds.length, total }, "[backfill] all chats complete");
  await pool.end();
}

main().catch((error) => {
  console.error("[backfill] fatal", error);
  process.exit(1);
});
