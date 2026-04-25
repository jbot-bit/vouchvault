import { eq } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { chatSettings } from "./storage/schema.ts";

export async function isChatPaused(chatId: number): Promise<boolean> {
  const rows = await db
    .select({ paused: chatSettings.paused })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));
  return rows[0]?.paused === true;
}

export async function setChatPaused(input: {
  chatId: number;
  paused: boolean;
  byTelegramId: number;
}): Promise<void> {
  await db
    .insert(chatSettings)
    .values({
      chatId: input.chatId,
      paused: input.paused,
      pausedAt: input.paused ? new Date() : null,
      pausedByTelegramId: input.paused ? input.byTelegramId : null,
    })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: {
        paused: input.paused,
        pausedAt: input.paused ? new Date() : null,
        pausedByTelegramId: input.paused ? input.byTelegramId : null,
        updatedAt: new Date(),
      },
    });
}
