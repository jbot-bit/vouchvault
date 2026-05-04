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
  getTelegramBotUsername,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import {
  MODERATION_GROUP_WARN_TTL_MS,
  buildModerationGroupWarnText,
  buildModerationWarnReplyMarkup,
  buildModerationWarnText,
} from "./archive.ts";
import {
  findHitInPhrases,
  findHits,
  MODERATION_COMMAND,
} from "./chatModerationLexicon.ts";
import { getActiveLearnedPhrasesCached } from "./learnedPhraseStore.ts";

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
  // Optional override for the learned-phrase loader. Tests inject a static
  // list; production uses the cached DB loader by default.
  loadLearnedPhrases?: () => Promise<ReadonlyArray<string>>;
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
  // Auto-forwarded posts from a discussion-linked channel arrive in the
  // supergroup with `is_automatic_forward: true` (Bot API reference).
  // For these, `message.from` is typically the channel itself or
  // "Telegram" — neither is_bot is true, so the self-skip above doesn't
  // fire. Skip moderation explicitly so the bot doesn't delete forwarded
  // archive content (the v9 mirror is one-way to a backup channel and
  // doesn't loop back, but if a future channel is discussion-linked,
  // member prose containing a lexicon hit would otherwise get deleted
  // on its second appearance via the auto-forward).
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

  let hit = findHits(combined);
  if (!hit.matched) {
    // Fall through to learned phrases — admin-curated extensions to the
    // static lexicon. Loader failure is non-fatal; we just skip.
    try {
      const loader = input.loadLearnedPhrases ?? getActiveLearnedPhrasesCached;
      const learned = await loader();
      const learnedHit = findHitInPhrases(combined, learned);
      if (learnedHit.matched) {
        hit = { matched: true, source: `learned:${learnedHit.phrase}` };
      }
    } catch (err) {
      logger?.warn?.({ err }, "chatModeration: learned-phrase load failed");
    }
  }
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

  const adminBotUsername = process.env.TELEGRAM_ADMIN_BOT_USERNAME?.trim() || null;

  // Group-visible warn — generic, no phrase leak, no offender callout.
  // Goes to the group (or the same forum topic) so the offender sees
  // it WITHOUT needing to have /start-ed the bot. Auto-deletes after
  // MODERATION_GROUP_WARN_TTL_MS so chat doesn't accumulate noise.
  const messageThreadId =
    typeof message.message_thread_id === "number"
      ? message.message_thread_id
      : undefined;
  const groupWarnText = buildModerationGroupWarnText({
    hitSource: hit.source,
    adminBotUsername,
  });
  postGroupWarnAndAutoDelete(
    {
      chatId: message.chat.id,
      messageThreadId,
      text: groupWarnText,
    },
    logger,
  );

  // Best-effort DM warning. Silent for users who never /start-ed
  // the bot (Telegram blocks bot-initiated DMs). Kept alongside the
  // group warn because it can carry slightly more context.
  const dmText = buildModerationWarnText({
    groupName,
    hitSource: hit.source,
    adminBotUsername,
  });
  // Resolve our own @username (cached after first call) so the DM warn
  // can include a "Why? →" deep-link to the /guide grp_posts page. If
  // resolution fails we just send the plain text — never let the deep-
  // link concern break the moderation hot path.
  let warnReplyMarkup: ReturnType<typeof buildModerationWarnReplyMarkup> = null;
  try {
    const botUsername = await getTelegramBotUsername(logger);
    warnReplyMarkup = buildModerationWarnReplyMarkup({ botUsername });
  } catch (error) {
    logger?.info?.(
      { error },
      "chatModeration: bot-username resolve failed, skipping warn deep-link",
    );
  }
  await safeSendDm(fromId, dmText, warnReplyMarkup, logger);

  return { deleted: true };
}

// Fire-and-forget: post the warn, schedule its delete, and return
// immediately. We deliberately do NOT await — moderation's hot path
// shouldn't be blocked on a TTL message. setTimeout is best-effort:
// if the process restarts inside the TTL window the warn just stays;
// admins can /teach-delete it manually. Acceptable trade.
function postGroupWarnAndAutoDelete(
  input: { chatId: number; messageThreadId?: number; text: string },
  logger?: Logger,
): void {
  void (async () => {
    try {
      const sent = await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: input.text,
          parseMode: "HTML",
          disableNotification: true,
          ...(input.messageThreadId != null
            ? { messageThreadId: input.messageThreadId }
            : {}),
        },
        logger,
      );
      const sentMessageId = (sent as { message_id?: number } | null)?.message_id;
      if (typeof sentMessageId !== "number") return;
      setTimeout(() => {
        deleteTelegramMessage(
          { chatId: input.chatId, messageId: sentMessageId },
          logger,
        ).catch((error) => {
          logger?.info?.(
            { error, sentMessageId },
            "chatModeration: group-warn auto-delete failed (non-fatal)",
          );
        });
      }, MODERATION_GROUP_WARN_TTL_MS).unref?.();
    } catch (error) {
      logger?.warn?.(
        { error, chatId: input.chatId },
        "chatModeration: group-warn post failed (non-fatal)",
      );
    }
  })();
}

async function safeSendDm(
  telegramId: number,
  htmlText: string,
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } | null,
  logger?: Logger,
): Promise<void> {
  try {
    await sendTelegramMessage(
      {
        chatId: telegramId,
        text: htmlText,
        ...(replyMarkup ? { replyMarkup } : {}),
      },
      logger,
    );
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
