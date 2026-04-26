// Chat moderation orchestration — audit row + Telegram side effects
// (delete, DM). Pure helpers (lexicon, normalise, findHits) live in
// `src/core/chatModerationLexicon.ts` so they can be unit-tested
// without DATABASE_URL.
//
// Policy: lexicon hit → delete the message + best-effort DM warn.
// No bans, no mutes, no strikes, no counting. The lexicon is
// empirically tuned to fire near-zero false-positives in the target
// community (0 hits across 2,565 Suncoast messages on the commerce-
// shape discriminators), so the per-hit cost to legitimate members
// is bounded to a single deleted message + a polite DM. Persistent
// hostile actors who keep posting hits keep having their posts
// vanish — the artefact never lands. Operators ban manually via
// Telegram-native UI if a determined attacker exhausts their patience.

import { recordAdminAction } from "./adminAuditStore.ts";
import {
  deleteTelegramMessage,
  getChatMember,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import { buildModerationWarnText } from "./archive.ts";
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
  // V3.5.4 channel-relay: auto-forwarded posts from the discussion-
  // linked channel arrive in the supergroup with `is_automatic_forward:
  // true` (Bot API reference). For these, `message.from` is typically
  // the channel itself or "Telegram" — neither is_bot is true, so the
  // self-skip above doesn't fire. Skip moderation explicitly so the
  // bot doesn't delete its own published vouches if the prose body
  // happens to contain a lexicon match (e.g. a member legitimately
  // wrote "pm me about the timing" in their vouch).
  if (message.is_automatic_forward === true) return { deleted: false };
  // Belt-and-braces: anything originating from a channel (sender_chat
  // is the channel) is also exempt — covers manual reposts of
  // archived channel content into the supergroup.
  if (message.sender_chat != null && message.sender_chat?.type === "channel") {
    return { deleted: false };
  }

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

  // Delete the offending message. Best-effort — the bot may lack
  // delete rights (surfaced in boot admin-rights log).
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

  // Best-effort DM warning. Silent for users who never /start-ed
  // the bot (Telegram blocks bot-initiated DMs); the welcome / pinned
  // guide instructs members to /start once. Locked text comes from
  // archive.buildModerationWarnText (V3.5 §8.4).
  const dmText = buildModerationWarnText({
    groupName,
    hitSource: hit.source,
    adminBotUsername: process.env.TELEGRAM_ADMIN_BOT_USERNAME?.trim() || null,
  });
  await safeSendDm(fromId, dmText, logger);

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
