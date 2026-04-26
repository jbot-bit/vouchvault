import { eq } from "drizzle-orm";

import { db } from "../storage/db.ts";
import { users } from "../storage/schema.ts";

type UserIdentityInput = {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export async function createOrUpdateUser(input: UserIdentityInput, logger?: any) {
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, input.telegramId))
    .limit(1);

  if (existingUser.length > 0) {
    // length > 0 so index 0 is guaranteed
    const user = existingUser[0]!;
    const needsUpdate =
      (input.username != null && user.username !== input.username) ||
      (input.firstName != null && user.firstName !== input.firstName) ||
      (input.lastName != null && user.lastName !== input.lastName);

    if (!needsUpdate) {
      return user;
    }

    const rows = await db
      .update(users)
      .set({
        username: input.username ?? user.username,
        firstName: input.firstName ?? user.firstName,
        lastName: input.lastName ?? user.lastName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    // update().returning() always returns the updated row
    const updated = rows[0]!;
    logger?.info?.(
      { userId: updated.id, telegramId: input.telegramId },
      "Updated Telegram user record",
    );
    return updated;
  }

  try {
    const rows = await db
      .insert(users)
      .values({
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      })
      .returning();

    // insert().returning() always returns the inserted row
    const created = rows[0]!;
    logger?.info?.(
      { userId: created.id, telegramId: input.telegramId },
      "Created Telegram user record",
    );
    return created;
  } catch (error) {
    logger?.warn?.(
      { telegramId: input.telegramId, error },
      "Concurrent user create detected, retrying lookup",
    );

    const retried = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, input.telegramId))
      .limit(1);

    if (retried.length > 0) {
      // length > 0 so index 0 is guaranteed
      return retried[0]!;
    }

    throw error;
  }
}

export async function getUserByTelegramId(telegramId: number) {
  const result = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  return result[0] ?? null;
}

export const createOrUpdateUserTool = {
  execute: async ({ context, mastra }: { context: UserIdentityInput; mastra?: any }) =>
    createOrUpdateUser(context, mastra?.getLogger?.()),
};

export const getUserByTelegramIdTool = {
  execute: async ({ context }: { context: { telegramId: number } }) => {
    const user = await getUserByTelegramId(context.telegramId);
    return { found: user != null, user };
  },
};

