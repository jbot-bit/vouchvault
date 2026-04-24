import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const TELEGRAM_API_URL = "https://api.telegram.org/bot";

let cachedBotUsername: string | null = null;

export async function callTelegramAPI(method: string, params: any, logger?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  const url = `${TELEGRAM_API_URL}${token}/${method}`;
  logger?.info(`🔧 [Telegram API] Calling ${method}`, { params });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const data = await response.json();

  if (!data.ok) {
    logger?.error(`❌ [Telegram API] Error calling ${method}`, { error: data });
    throw new Error(`Telegram API error: ${data.description}`);
  }

  logger?.info(`✅ [Telegram API] ${method} successful`);
  return data.result;
}

export async function sendTelegramMessage(input: {
  chatId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
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
      parse_mode: input.parseMode,
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
  if (process.env.TELEGRAM_BOT_USERNAME) {
    return process.env.TELEGRAM_BOT_USERNAME.replace(/^@+/, "");
  }

  if (cachedBotUsername) {
    return cachedBotUsername;
  }

  const result = await callTelegramAPI("getMe", {}, logger);
  const username = typeof result?.username === "string" ? result.username.replace(/^@+/, "") : null;
  cachedBotUsername = username;
  return cachedBotUsername;
}

export function buildUrlInlineKeyboard(text: string, url: string) {
  return {
    inline_keyboard: [
      [{ text, url }],
    ],
  };
}

export function buildInlineKeyboard(buttons: Array<Array<{ text: string; callback_data: string }>>) {
  return {
    inline_keyboard: buttons,
  };
}

export function buildForceReply(inputFieldPlaceholder?: string) {
  const trimmedPlaceholder = inputFieldPlaceholder?.trim();

  return {
    force_reply: true,
    ...(trimmedPlaceholder
      ? { input_field_placeholder: trimmedPlaceholder.slice(0, 64) }
      : {}),
  };
}

export function buildTelegramSendMessageParams(input: {
  chatId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
  replyMarkup?: Record<string, unknown>;
}) {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode,
    disable_notification: input.disableNotification,
    reply_parameters: input.replyToMessageId == null
      ? undefined
      : {
          message_id: input.replyToMessageId,
          allow_sending_without_reply: input.allowSendingWithoutReply,
        },
    reply_markup: input.replyMarkup,
  };
}

export const sendTelegramMessageTool = createTool({
  id: "send-telegram-message",
  description: "Sends a text message to a Telegram chat",
  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    text: z.string().describe("Message text"),
    parseMode: z.enum(["Markdown", "HTML", "MarkdownV2"]).optional().describe("Text formatting mode"),
    replyToMessageId: z.number().optional().describe("Message ID to reply to"),
    allowSendingWithoutReply: z.boolean().optional().describe("Send even if the replied-to message no longer exists"),
    disableNotification: z.boolean().optional().describe("Send the message silently"),
  }),
  outputSchema: z.object({
    messageId: z.number(),
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [sendTelegramMessageTool] Sending message", { context });

    const result = await sendTelegramMessage(context, logger);

    return { messageId: result.message_id, success: true };
  },
});

export const editTelegramMessageTool = createTool({
  id: "edit-telegram-message",
  description: "Edits an existing Telegram message (used to update reputation cards)",
  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    messageId: z.number().describe("Message ID to edit"),
    text: z.string().describe("New message text"),
    parseMode: z.enum(["Markdown", "HTML", "MarkdownV2"]).optional().describe("Text formatting mode"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [editTelegramMessageTool] Editing message", { context });

    await editTelegramMessage(context, logger);

    return { success: true };
  },
});

export const createTelegramPollTool = createTool({
  id: "create-telegram-poll",
  description: "Creates a Telegram poll asking group members to vouch for a user",
  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    question: z.string().describe("Poll question"),
    options: z.array(z.string()).describe("Poll options (e.g., ['Yes', 'No'])"),
    isAnonymous: z.boolean().default(false).describe("Whether the poll is anonymous"),
  }),
  outputSchema: z.object({
    messageId: z.number(),
    pollId: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [createTelegramPollTool] Creating poll", { context });

    const result = await callTelegramAPI(
      "sendPoll",
      {
        chat_id: context.chatId,
        question: context.question,
        options: context.options,
        is_anonymous: context.isAnonymous,
      },
      logger
    );

    return {
      messageId: result.message_id,
      pollId: result.poll.id,
      success: true,
    };
  },
});

export const formatReputationCardTool = createTool({
  id: "format-reputation-card",
  description: "Formats a reputation card message showing user's current rank and vote counts",
  inputSchema: z.object({
    username: z.string().nullable().describe("User's username"),
    firstName: z.string().nullable().describe("User's first name"),
    rank: z.string().describe("User's rank tier"),
    stars: z.string().describe("Star rating display"),
    yesVotes: z.number().describe("Number of yes votes"),
    noVotes: z.number().describe("Number of no votes"),
  }),
  outputSchema: z.object({
    formattedText: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [formatReputationCardTool] Formatting reputation card", { context });

    const displayName = context.username
      ? `@${context.username}`
      : context.firstName || "Unknown User";

    const formattedText = `
┏━━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎖️ REPUTATION CARD  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━┛

👤 User: ${displayName}

${context.stars}
${context.rank}

📊 Votes:
  ✅ Yes: ${context.yesVotes}
  ❌ No: ${context.noVotes}
  📈 Total: ${context.yesVotes + context.noVotes}

━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    logger?.info("✅ [formatReputationCardTool] Card formatted");
    return { formattedText };
  },
});

export const sendBumpReminderTool = createTool({
  id: "send-bump-reminder",
  description: "Sends a bump reminder message asking for more votes on an existing poll",
  inputSchema: z.object({
    chatId: z.number().describe("Telegram chat ID"),
    username: z.string().nullable().describe("User's username"),
    firstName: z.string().nullable().describe("User's first name"),
    pollMessageId: z.number().describe("Original poll message ID to reference"),
  }),
  outputSchema: z.object({
    messageId: z.number(),
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [sendBumpReminderTool] Sending bump reminder", { context });

    const displayName = context.username
      ? `@${context.username}`
      : context.firstName || "Unknown User";

    const text = `
🔔 VERIFICATION BUMP!

${displayName} is requesting more votes!

Please help them gain community trust by voting in the poll above. Your vote matters! 🗳️
`.trim();

    const result = await callTelegramAPI(
      "sendMessage",
      {
        chat_id: context.chatId,
        text: text,
        reply_to_message_id: context.pollMessageId,
      },
      logger
    );

    return { messageId: result.message_id, success: true };
  },
});
