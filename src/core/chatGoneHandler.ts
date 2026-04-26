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
    logger.info({ chatId }, "Chat already marked gone; skipping admin page");
    return;
  }

  // Write the audit row BEFORE pushing admin DMs. If the process is killed
  // (SIGTERM, OOM) mid-handler, setChatGone has already flipped the status
  // to 'gone' so the next webhook retry returns newlyGone:false and admins
  // would never be paged. Writing the audit first guarantees at-least-once
  // record of the event even when DMs fail to land.
  try {
    await deps.recordAudit({
      command: "system.chat_gone",
      targetChatId: chatId,
      denied: false,
    });
  } catch (err) {
    logger.warn({ chatId, err }, "Failed to write chat-gone audit entry");
  }

  const text =
    `Group <code>${chatId}</code> appears to have been deleted by Telegram. ` +
    `Bot has stopped posting there. See <code>docs/runbook/opsec.md</code> for migration steps.`;

  let successes = 0;
  for (const adminId of adminTelegramIds) {
    try {
      await deps.sendDM({ chatId: adminId, text });
      successes += 1;
    } catch (err) {
      logger.warn({ adminId, chatId, err }, "Failed to DM admin about chat-gone event");
    }
  }

  if (adminTelegramIds.length > 0 && successes === 0) {
    logger.error(
      { chatId, adminCount: adminTelegramIds.length },
      "chat-gone alert reached zero admins; check operator visibility",
    );
  }
}
