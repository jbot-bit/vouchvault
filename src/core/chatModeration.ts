// Chat moderation orchestration — audit row + Telegram side effects
// (delete, ban, DM). Pure helpers (lexicon, normalise, findHits) live in
// `src/core/chatModerationLexicon.ts` so they can be unit-tested
// without DATABASE_URL.
//
// Policy: lexicon hit → delete + ban. No strikes, no decay, no counting.
// The lexicon is empirically tuned to fire zero false-positives in the
// target community (Suncoast V3, 0 hits across 2,565 messages on the
// commerce-shape discriminators). A hostile actor gets one shot per
// account; a legitimate member who somehow trips the lexicon DMs an
// admin and is unbanned via Telegram's native UI in seconds.

import { recordAdminAction } from "./adminAuditStore.ts";
import {
  banChatMember,
  deleteTelegramMessage,
  getChatMember,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import { escapeHtml } from "./archive.ts";
import {
  findHits,
  MODERATION_COMMAND,
} from "./chatModerationLexicon.ts";

export {
  PHRASES,
  MODERATION_COMMAND,
  normalize,
  findHits,
} from "./chatModerationLexicon.ts";
export type { HitResult } from "./chatModerationLexicon.ts";

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

  // Delete + ban. Both tolerate failure independently — one failing
  // doesn't cancel the other (e.g., bot lacks delete rights but still
  // has ban rights, or vice versa). The boot-time admin-rights log
  // surfaces missing permissions.
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

  try {
    await banChatMember(
      { chatId: message.chat.id, telegramId: fromId },
      logger,
    );
  } catch (error) {
    logger?.warn?.({ error }, "chatModeration: banChatMember failed");
  }

  // Best-effort notification. Silent for users who never /start-ed
  // the bot (Telegram blocks bot-initiated DMs); the welcome / pinned
  // guide instructs members to /start once.
  await safeSendDm(
    fromId,
    `Your message in <b>${escapeHtml(groupName)}</b> was removed and your account was removed from the group. If you believe this is an error, contact an admin.`,
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
