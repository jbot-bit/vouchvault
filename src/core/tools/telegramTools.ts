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
  // Forum-mode supergroups: when the inbound message originates in a
  // topic, callers should pass message_thread_id so the bot's reply
  // stays in the same topic. Bot API:
  // https://core.telegram.org/bots/api#sendmessage
  messageThreadId?: number;
  // Bot API LinkPreviewOptions (https://core.telegram.org/bots/api#linkpreviewoptions).
  // Only used by channel publishes today — DMs and member-facing
  // replies leave it unset so user prose with links previews normally.
  linkPreviewOptions?: { isDisabled?: boolean };
}) {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? "HTML",
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    message_thread_id: input.messageThreadId,
    link_preview_options:
      input.linkPreviewOptions == null
        ? undefined
        : { is_disabled: input.linkPreviewOptions.isDisabled },
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
    messageThreadId?: number;
    linkPreviewOptions?: { isDisabled?: boolean };
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

// Bot API: https://core.telegram.org/bots/api#forwardmessage
// Used by v9 mirror path: every member-posted group message is forwarded
// into the backup channel, preserving forward_origin so the channel post
// shows "forwarded from <member>" attribution. Different on-the-wire
// shape than sendMessage — classifier-friendlier (KB:F2.5).
export async function forwardTelegramMessage(
  input: {
    fromChatId: number;
    toChatId: number;
    messageId: number;
    disableNotification?: boolean;
    messageThreadId?: number;
  },
  logger?: any,
): Promise<{ message_id: number }> {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "forwardMessage",
      {
        from_chat_id: input.fromChatId,
        chat_id: input.toChatId,
        message_id: input.messageId,
        disable_notification: input.disableNotification,
        message_thread_id: input.messageThreadId,
      },
      logger,
      input.toChatId,
    ),
  );
}

export async function getChatMember(
  input: { chatId: number; telegramId: number },
  logger?: any,
) {
  return callTelegramAPI(
    "getChatMember",
    { chat_id: input.chatId, user_id: input.telegramId },
    logger,
    input.chatId,
  );
}

// Bot API: https://core.telegram.org/bots/api#createchatinvitelink
// `member_limit: 1` produces a one-shot link — after the first member uses it
// the link is auto-revoked by Telegram. `expire_date` is a Unix timestamp.
// Both params are optional but we always pass them — the v8 invite-link
// design relies on the one-shot semantics.
export async function createTelegramInviteLink(
  input: {
    chatId: number;
    memberLimit?: number;
    expireDate?: number;
    name?: string;
    createsJoinRequest?: boolean;
  },
  logger?: any,
): Promise<{
  invite_link: string;
  creator: { id: number; username?: string } | null;
  creates_join_request: boolean;
  member_limit: number;
  expire_date: number | null;
  name: string | null;
}> {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "createChatInviteLink",
      {
        chat_id: input.chatId,
        member_limit: input.memberLimit,
        expire_date: input.expireDate,
        name: input.name,
        creates_join_request: input.createsJoinRequest,
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

let cachedBotId: number | null = null;

export async function getTelegramBotId(logger?: any): Promise<number | null> {
  if (cachedBotId != null) return cachedBotId;
  const result = await callTelegramAPI("getMe", {}, logger);
  const id = (result as { id?: number } | null)?.id;
  if (typeof id === "number") {
    cachedBotId = id;
  }
  return cachedBotId;
}

// Inline-cards phase 2: answerInlineQuery for the inline_query handler.
// Telegram requires answering within ~10s of receiving the query;
// callers should enforce a soft deadline (~7s) before timing out.
export async function answerInlineQuery(
  input: {
    inlineQueryId: string;
    results: Array<Record<string, unknown>>;
    cacheTime?: number;
    isPersonal?: boolean;
    nextOffset?: string;
    button?: { text: string; start_parameter?: string };
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "answerInlineQuery",
      {
        inline_query_id: input.inlineQueryId,
        results: input.results,
        cache_time: input.cacheTime ?? 0,
        is_personal: input.isPersonal ?? true,
        next_offset: input.nextOffset,
        button: input.button,
      },
      logger,
    ),
  );
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
