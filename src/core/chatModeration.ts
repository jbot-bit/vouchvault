// Chat moderation orchestration — DB queries (audit-log strike count) +
// Telegram side effects (delete, restrict, ban, DM). Pure helpers
// (lexicon, normalise, findHits, decideStrikeAction) live in
// `src/core/chatModerationLexicon.ts` so they can be unit-tested
// without DATABASE_URL.

import { and, eq, gte, isNull, like, not, or, sql } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";
import { recordAdminAction } from "./adminAuditStore.ts";
import {
  banChatMember,
  deleteTelegramMessage,
  getChatMember,
  restrictChatMember,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import { escapeHtml } from "./archive.ts";
import {
  decideStrikeAction,
  findHits,
  MODERATION_COMMAND,
  STRIKE_DECAY_DAYS,
} from "./chatModerationLexicon.ts";

// Re-export the things callers expect at the moderation surface.
export {
  PHRASES,
  STRIKE_DECAY_DAYS,
  MUTE_DURATION_HOURS,
  MODERATION_COMMAND,
  normalize,
  findHits,
  decideStrikeAction,
} from "./chatModerationLexicon.ts";
export type { HitResult, StrikeAction } from "./chatModerationLexicon.ts";

// ---- Strike count from audit log (no new table) ----

async function getRecentStrikeCount(
  chatId: number,
  telegramId: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminAuditLog)
    .where(
      and(
        eq(adminAuditLog.command, MODERATION_COMMAND),
        eq(adminAuditLog.targetChatId, chatId),
        eq(adminAuditLog.adminTelegramId, telegramId),
        gte(adminAuditLog.createdAt, cutoff),
        eq(adminAuditLog.denied, false),
        // Exclude admin-exempt rows from contributing to anyone's count.
        or(
          isNull(adminAuditLog.reason),
          not(like(adminAuditLog.reason, "%(admin_exempt)%")),
        ),
      ),
    );
  return rows[0]?.count ?? 0;
}

// ---- Logger interface ----

type Logger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

// ---- Orchestration ----

export type RunChatModerationInput = {
  message: any; // Telegram Message shape
  isAdmin: (telegramId: number | null | undefined) => boolean;
  botTelegramId: number;
  logger?: Logger;
};

export async function runChatModeration(
  input: RunChatModerationInput,
): Promise<{ deleted: boolean }> {
  const { message, isAdmin, botTelegramId, logger } = input;

  const fromId: number | undefined = message.from?.id;
  if (typeof fromId !== "number") return { deleted: false };

  // Skip the bot itself (belt-and-braces: is_bot flag + id check).
  if (message.from?.is_bot === true) return { deleted: false };
  if (fromId === botTelegramId) return { deleted: false };
  // Skip messages relayed via inline bots — let the inline bot's content
  // be the inline bot's problem.
  if (message.via_bot != null) return { deleted: false };

  const text = typeof message.text === "string" ? message.text : "";
  const caption = typeof message.caption === "string" ? message.caption : "";
  const combined = [text, caption].filter((s) => s.length > 0).join("\n");
  if (combined.length === 0) return { deleted: false };

  const hit = findHits(combined);
  if (!hit.matched) return { deleted: false };

  const adminSender = isAdmin(fromId);
  const username: string | null = message.from?.username ?? null;
  const groupName: string =
    typeof message.chat?.title === "string"
      ? message.chat.title
      : `chat ${message.chat.id}`;

  // Audit row first — record the hit even if subsequent steps fail.
  await recordAdminAction({
    adminTelegramId: fromId,
    adminUsername: username,
    command: MODERATION_COMMAND,
    targetChatId: message.chat.id,
    targetUsername: username,
    reason: adminSender ? `${hit.source} (admin_exempt)` : hit.source,
    denied: false,
  });

  if (adminSender) {
    return { deleted: false };
  }

  // Delete is the most important action; do it first and tolerate failure
  // (e.g., bot lacks admin rights — surfaced in boot-time admin-rights log).
  try {
    await deleteTelegramMessage(
      { chatId: message.chat.id, messageId: message.message_id },
      logger,
    );
  } catch (error) {
    logger?.warn?.(
      { error, chatId: message.chat.id },
      "chatModeration: deleteMessage failed",
    );
  }

  // Strike count + ladder. If the count query fails, fail-safe: skip
  // enforcement (delete already happened, audit already recorded). The
  // next hit catches up.
  let count: number;
  try {
    count = await getRecentStrikeCount(message.chat.id, fromId);
  } catch (error) {
    logger?.warn?.(
      { error, fromId, chatId: message.chat.id },
      "chatModeration: getRecentStrikeCount failed; skipping enforcement",
    );
    return { deleted: true };
  }
  if (count < 1) {
    // Defensive: the audit row insert above guarantees count ≥ 1, but if
    // some race makes it 0, treat as warn rather than throwing.
    count = 1;
  }
  const action = decideStrikeAction(count);

  if (action.kind === "warn") {
    await safeSendDm(
      fromId,
      `Your message in <b>${escapeHtml(groupName)}</b> was removed. Two more removals in 30 days will mute you for 24 hours.`,
      logger,
    );
    return { deleted: true };
  }

  if (action.kind === "mute") {
    const untilDate = Math.floor(Date.now() / 1000) + action.durationHours * 60 * 60;
    try {
      await restrictChatMember(
        {
          chatId: message.chat.id,
          telegramId: fromId,
          untilDate,
          canSendMessages: false,
        },
        logger,
      );
    } catch (error) {
      logger?.warn?.({ error }, "chatModeration: restrictChatMember failed");
    }
    await safeSendDm(
      fromId,
      `Second removal in 30 days. You are muted in <b>${escapeHtml(groupName)}</b> for ${action.durationHours} hours.`,
      logger,
    );
    return { deleted: true };
  }

  // ban
  try {
    await banChatMember(
      { chatId: message.chat.id, telegramId: fromId },
      logger,
    );
  } catch (error) {
    logger?.warn?.({ error }, "chatModeration: banChatMember failed");
  }
  await safeSendDm(
    fromId,
    `Third removal in 30 days. You have been removed from <b>${escapeHtml(groupName)}</b>. Contact an admin if you believe this is an error.`,
    logger,
  );
  return { deleted: true };
}

async function safeSendDm(
  telegramId: number,
  htmlText: string,
  logger?: Logger,
): Promise<void> {
  try {
    await sendTelegramMessage({ chatId: telegramId, text: htmlText }, logger);
  } catch (error) {
    // User may have blocked the bot or never DM'd it (Telegram blocks
    // bot-initiated DMs to non-initiated users). The moderation action
    // stands regardless — DM is best-effort. The welcome / pinned guide
    // tells members to /start the bot once.
    logger?.info?.(
      { error, telegramId },
      "chatModeration: DM delivery failed (non-fatal)",
    );
  }
}

// ---- Boot-time admin-rights visibility ----

export async function logBotAdminStatusForChats(
  chatIds: ReadonlyArray<number>,
  botTelegramId: number,
  logger: Logger,
): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const member = await getChatMember({ chatId, telegramId: botTelegramId });
      const status = (member as { status?: string } | null)?.status ?? "unknown";
      logger.info?.(
        { chatId, status },
        `chatModeration: bot status in ${chatId}: ${status}`,
      );
      if (status !== "administrator" && status !== "creator") {
        logger.warn?.(
          { chatId, status },
          `chatModeration: bot is NOT admin in ${chatId} — moderation will silently fail there`,
        );
      }
    } catch (error) {
      logger.warn?.(
        { error, chatId },
        `chatModeration: getChatMember failed for ${chatId}`,
      );
    }
  }
}
