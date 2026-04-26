import {
  TelegramApiError,
  TelegramChatGoneError,
  TelegramForbiddenError,
  TelegramRateLimitError,
} from "../typedTelegramErrors.ts";
import { withTelegramRetry } from "../withTelegramRetry.ts";

const TELEGRAM_API_URL = "https://api.telegram.org/bot";

let cachedBotUsername: string | null = null;

export async function callTelegramAPI(
  method: string,
  params: any,
  logger?: any,
  chatId?: number,
  signal?: AbortSignal,
) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const response = await fetch(`${TELEGRAM_API_URL}${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal,
  });

  const data = await response.json();
  if (!data.ok) {
    logger?.error?.({ method, params, error: data }, "Telegram API call failed");
    const desc = String(data.description ?? "");
    const code = Number(data.error_code ?? 0);
    if (code === 429) {
      throw new TelegramRateLimitError(
        code,
        desc,
        Number(data.parameters?.retry_after ?? 0),
        chatId,
      );
    }
    if (code === 403 && /bot was blocked by the user|bot is not a member/i.test(desc)) {
      throw new TelegramForbiddenError(code, desc, undefined, chatId);
    }
    if (code === 400 && /chat not found/i.test(desc)) {
      throw new TelegramChatGoneError(code, desc, undefined, chatId);
    }
    throw new TelegramApiError(code, desc, undefined, chatId);
  }

  return data.result;
}

export function buildTelegramSendMessageParams(input: {
  chatId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
  replyMarkup?: Record<string, unknown>;
  protectContent?: boolean;
}) {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? "HTML",
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    reply_parameters:
      input.replyToMessageId == null
        ? undefined
        : {
            message_id: input.replyToMessageId,
            allow_sending_without_reply: input.allowSendingWithoutReply,
          },
    reply_markup: input.replyMarkup,
  };
}

export async function sendTelegramMessage(
  input: {
    chatId: number;
    text: string;
    parseMode?: "Markdown" | "HTML" | "MarkdownV2";
    replyToMessageId?: number;
    allowSendingWithoutReply?: boolean;
    disableNotification?: boolean;
    replyMarkup?: Record<string, unknown>;
    protectContent?: boolean;
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI("sendMessage", buildTelegramSendMessageParams(input), logger, input.chatId),
  );
}

export async function editTelegramMessage(
  input: {
    chatId: number;
    messageId: number;
    text: string;
    parseMode?: "Markdown" | "HTML" | "MarkdownV2";
    replyMarkup?: Record<string, unknown>;
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "editMessageText",
      {
        chat_id: input.chatId,
        message_id: input.messageId,
        text: input.text,
        parse_mode: input.parseMode ?? "HTML",
        reply_markup: input.replyMarkup,
      },
      logger,
      input.chatId,
    ),
  );
}

export async function deleteTelegramMessage(
  input: {
    chatId: number;
    messageId: number;
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "deleteMessage",
      {
        chat_id: input.chatId,
        message_id: input.messageId,
      },
      logger,
      input.chatId,
    ),
  );
}

export async function answerTelegramCallbackQuery(
  input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
    chatId?: number;
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "answerCallbackQuery",
      {
        callback_query_id: input.callbackQueryId,
        text: input.text,
        show_alert: input.showAlert,
      },
      logger,
      input.chatId,
    ),
  );
}

export async function getTelegramBotUsername(logger?: any): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME?.trim()) {
    return process.env.TELEGRAM_BOT_USERNAME.trim().replace(/^@+/, "");
  }

  if (cachedBotUsername) {
    return cachedBotUsername;
  }

  const result = await callTelegramAPI("getMe", {}, logger);
  cachedBotUsername =
    typeof result?.username === "string" ? result.username.replace(/^@+/, "") : null;

  return cachedBotUsername;
}

export function buildUrlInlineKeyboard(text: string, url: string) {
  return {
    inline_keyboard: [[{ text, url }]],
  };
}

type InlineKeyboardButton = { text: string } & (
  | { callback_data: string }
  | { url: string }
);

export function buildInlineKeyboard(buttons: InlineKeyboardButton[][]) {
  return { inline_keyboard: buttons };
}

export const sendTelegramMessageTool = {
  execute: async ({
    context,
    mastra,
  }: {
    context: Parameters<typeof sendTelegramMessage>[0];
    mastra?: any;
  }) => {
    const result = await sendTelegramMessage(context, mastra?.getLogger?.());
    return { messageId: result.message_id, success: true };
  },
};

export const editTelegramMessageTool = {
  execute: async ({
    context,
    mastra,
  }: {
    context: Parameters<typeof editTelegramMessage>[0];
    mastra?: any;
  }) => {
    await editTelegramMessage(context, mastra?.getLogger?.());
    return { success: true };
  },
};
