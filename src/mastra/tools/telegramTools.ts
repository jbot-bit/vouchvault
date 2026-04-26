const TELEGRAM_API_URL = "https://api.telegram.org/bot";

let cachedBotUsername: string | null = null;

export async function callTelegramAPI(method: string, params: any, logger?: any) {
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
  });

  const data = await response.json();
  if (!data.ok) {
    logger?.error?.("Telegram API call failed", { method, params, error: data });
    throw new Error(`Telegram API error: ${data.description}`);
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
  protectContent?: boolean;
  replyMarkup?: Record<string, unknown>;
}) {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? "HTML",
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    reply_parameters: input.replyToMessageId == null
      ? undefined
      : {
          message_id: input.replyToMessageId,
          allow_sending_without_reply: input.allowSendingWithoutReply,
        },
    reply_markup: input.replyMarkup,
  };
}

export async function sendTelegramMessage(input: {
  chatId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyMarkup?: Record<string, unknown>;
}, logger?: any) {
  return callTelegramAPI("sendMessage", buildTelegramSendMessageParams(input), logger);
}

export async function editTelegramMessage(input: {
  chatId: number;
  messageId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
}, logger?: any) {
  return callTelegramAPI(
    "editMessageText",
    {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      parse_mode: input.parseMode ?? "HTML",
      reply_markup: input.replyMarkup,
    },
    logger,
  );
}

export async function deleteTelegramMessage(input: {
  chatId: number;
  messageId: number;
}, logger?: any) {
  return callTelegramAPI(
    "deleteMessage",
    {
      chat_id: input.chatId,
      message_id: input.messageId,
    },
    logger,
  );
}

export async function answerTelegramCallbackQuery(input: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}, logger?: any) {
  return callTelegramAPI(
    "answerCallbackQuery",
    {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: input.showAlert,
    },
    logger,
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
  cachedBotUsername = typeof result?.username === "string"
    ? result.username.replace(/^@+/, "")
    : null;

  return cachedBotUsername;
}

export function buildUrlInlineKeyboard(text: string, url: string) {
  return {
    inline_keyboard: [[{ text, url }]],
  };
}

export function buildInlineKeyboard(buttons: Array<Array<{ text: string; callback_data: string }>>) {
  return {
    inline_keyboard: buttons,
  };
}

export const sendTelegramMessageTool = {
  execute: async ({ context, mastra }: { context: Parameters<typeof sendTelegramMessage>[0]; mastra?: any }) => {
    const result = await sendTelegramMessage(context, mastra?.getLogger?.());
    return { messageId: result.message_id, success: true };
  },
};

export const editTelegramMessageTool = {
  execute: async ({ context, mastra }: { context: Parameters<typeof editTelegramMessage>[0]; mastra?: any }) => {
    await editTelegramMessage(context, mastra?.getLogger?.());
    return { success: true };
  },
};
