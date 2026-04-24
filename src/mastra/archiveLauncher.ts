import { buildLauncherText } from "./archive";
import { getLauncherByChatId, saveLauncherMessage, withChatLauncherLock } from "./archiveStore";
import { getAllowedTelegramChatIds, getPrimaryAllowedTelegramChatId } from "./telegramChatConfig";
import {
  buildUrlInlineKeyboard,
  deleteTelegramMessage,
  getTelegramBotUsername,
  sendTelegramMessage,
} from "./tools/telegramTools";

type LauncherMessageOptions = {
  text?: string;
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
};

export function getAllowedGroupChatIds(): number[] {
  return getAllowedTelegramChatIds();
}

export function getPrimaryGroupChatId(): number {
  return getPrimaryAllowedTelegramChatId();
}

export function isAllowedGroupChatId(chatId: number | null | undefined): chatId is number {
  return chatId != null && getAllowedGroupChatIds().includes(chatId);
}

function buildLauncherPayload(chatId: number): string {
  return `vouch_${chatId}`;
}

export async function sendLauncherMessage(chatId: number, logger?: any, options: LauncherMessageOptions = {}) {
  const botUsername = await getTelegramBotUsername(logger);
  if (!botUsername) {
    throw new Error("Telegram bot username unavailable for launcher deep link");
  }

  const replyMarkup = buildUrlInlineKeyboard(
    "Open Vouch Flow",
    `https://t.me/${botUsername}?start=${buildLauncherPayload(chatId)}`,
  );

  return sendTelegramMessage(
    {
      chatId,
      text: options.text ?? buildLauncherText(),
      replyToMessageId: options.replyToMessageId,
      allowSendingWithoutReply: options.allowSendingWithoutReply,
      disableNotification: options.disableNotification ?? true,
      replyMarkup,
    },
    logger,
  );
}

export async function refreshGroupLauncher(chatId: number, logger?: any) {
  await withChatLauncherLock(chatId, async () => {
    const existing = await getLauncherByChatId(chatId);

    if (existing) {
      try {
        await deleteTelegramMessage(
          {
            chatId,
            messageId: existing.messageId,
          },
          logger,
        );
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to delete previous launcher", { error, chatId, messageId: existing.messageId });
      }
    }

    const launcher = await sendLauncherMessage(chatId, logger);
    await saveLauncherMessage(chatId, launcher.message_id);
  });
}
