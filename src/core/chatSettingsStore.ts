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

export async function isChatKicked(chatId: number): Promise<boolean> {
  const rows = await db
    .select({ status: chatSettings.status })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));
  return rows[0]?.status === "kicked";
}

export async function setChatKicked(chatId: number): Promise<void> {
  await db
    .insert(chatSettings)
    .values({ chatId, status: "kicked" })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "kicked", updatedAt: new Date() },
    });
}

export async function setChatMigrated(chatId: number, migratedToChatId: number): Promise<void> {
  await db
    .insert(chatSettings)
    .values({ chatId, status: "migrated_away", migratedToChatId })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "migrated_away", migratedToChatId, updatedAt: new Date() },
    });
}
