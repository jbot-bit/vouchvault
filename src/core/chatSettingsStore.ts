import { eq, ne } from "drizzle-orm";
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

/**
 * Reset a previously-disabled chat back to 'active' (e.g. bot was re-added
 * after a kick / chat-gone). Idempotent.
 */
export async function setChatActive(chatId: number): Promise<void> {
  await db
    .insert(chatSettings)
    .values({ chatId, status: "active" })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "active", updatedAt: new Date() },
    });
}

/**
 * Marks the chat as gone (Telegram returned `chat not found` from a send).
 * Returns true iff the status flipped from a non-`gone` value to `gone` on
 * this call. The caller uses that signal to page admins exactly once.
 *
 * Atomic: a single INSERT ... ON CONFLICT DO UPDATE ... WHERE status != 'gone'
 * RETURNING. If the row is already 'gone' the WHERE clause skips the update
 * and RETURNING is empty — concurrent webhook deliveries for the same gone
 * chat cannot both observe `newlyGone: true`.
 */
export async function setChatGone(chatId: number): Promise<{ newlyGone: boolean }> {
  const result = await db
    .insert(chatSettings)
    .values({ chatId, status: "gone" })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "gone", updatedAt: new Date() },
      setWhere: ne(chatSettings.status, "gone"),
    })
    .returning({ chatId: chatSettings.chatId });

  return { newlyGone: result.length > 0 };
}

const DISABLED_STATUSES = new Set(["kicked", "gone", "migrated_away"]);

export async function isChatDisabled(chatId: number): Promise<boolean> {
  const rows = await db
    .select({ status: chatSettings.status })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));
  return DISABLED_STATUSES.has(rows[0]?.status ?? "");
}
