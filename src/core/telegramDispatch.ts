// Pure dispatch helpers used by `src/telegramBot.ts`. Kept in a separate
// module so they can be unit-tested without pulling in the DB-bound handlers.

export function shouldMarkChatKicked(newStatus: string | null | undefined): boolean {
  return newStatus === "kicked" || newStatus === "left";
}

export function parseChatMigration(
  message: { chat?: { id?: unknown }; migrate_to_chat_id?: unknown } | null | undefined,
): { oldId: number; newId: number } | null {
  if (!message || message.migrate_to_chat_id == null) {
    return null;
  }

  const oldId = Number(message.chat?.id);
  const newId = Number(message.migrate_to_chat_id);
  if (!Number.isSafeInteger(oldId) || !Number.isSafeInteger(newId)) {
    return null;
  }

  return { oldId, newId };
}
