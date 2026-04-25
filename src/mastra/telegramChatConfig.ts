function parseConfiguredTelegramChatIds(): number[] {
  const configured = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim() ?? "";
  if (!configured) {
    return [];
  }

  return [...new Set(
    configured
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value)),
  )];
}

export function getAllowedTelegramChatIds(): number[] {
  return parseConfiguredTelegramChatIds();
}

export function getAllowedTelegramChatIdSet(): Set<number> {
  return new Set(parseConfiguredTelegramChatIds());
}

export function getPrimaryAllowedTelegramChatId(): number {
  const chatIds = parseConfiguredTelegramChatIds();
  const primary = chatIds[0];
  if (primary == null) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_IDS is not configured. Set it to the active Telegram group ID before starting the bot or replay.");
  }

  return primary;
}
