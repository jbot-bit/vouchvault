export class TelegramApiError extends Error {
  readonly errorCode: number;
  readonly description: string;
  readonly retryAfter?: number;
  readonly chatId?: number;
  constructor(
    errorCode: number,
    description: string,
    retryAfter?: number,
    chatId?: number,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfter = retryAfter;
    this.chatId = chatId;
  }
}

export class TelegramRateLimitError extends TelegramApiError {}
export class TelegramForbiddenError extends TelegramApiError {}
export class TelegramChatGoneError extends TelegramApiError {}
