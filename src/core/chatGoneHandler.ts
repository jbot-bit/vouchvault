type LoggerLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type AuditEntry = {
  command: string;
  targetChatId: number;
  denied: boolean;
};

type Deps = {
  setChatGone: (chatId: number) => Promise<{ newlyGone: boolean }>;
  sendDM: (input: { chatId: number; text: string }) => Promise<unknown>;
  recordAudit: (entry: AuditEntry) => Promise<unknown>;
};

export async function handleChatGone(input: {
  chatId: number | undefined;
  adminTelegramIds: number[];
  logger: LoggerLike;
  deps: Deps;
}): Promise<void> {
  const { chatId, adminTelegramIds, logger, deps } = input;

  if (chatId === undefined) {
    logger.warn(
      "Received TelegramChatGoneError without chatId; cannot mark chat gone",
    );
    return;
  }

  const { newlyGone } = await deps.setChatGone(chatId);

  if (!newlyGone) {
    logger.info("Chat already marked gone; skipping admin page", { chatId });
    return;
  }

  const text =
    `Group <code>${chatId}</code> appears to have been deleted by Telegram. ` +
    `Bot has stopped posting there. See <code>docs/runbook/opsec.md</code> for migration steps.`;

  for (const adminId of adminTelegramIds) {
    try {
      await deps.sendDM({ chatId: adminId, text });
    } catch (err) {
      logger.warn("Failed to DM admin about chat-gone event", {
        adminId,
        chatId,
        err,
      });
    }
  }

  try {
    await deps.recordAudit({
      command: "system.chat_gone",
      targetChatId: chatId,
      denied: false,
    });
  } catch (err) {
    logger.warn("Failed to write chat-gone audit entry", { chatId, err });
  }
}
