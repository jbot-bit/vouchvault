import { eq } from "drizzle-orm";

import { db } from "../storage/db.ts";
import { users } from "../storage/schema.ts";

function calculateRank(yesVotes: number): { rank: string; stars: string } {
  if (yesVotes >= 20) {
    return { rank: "👑 Top-Tier Verified", stars: "⭐⭐⭐⭐⭐" };
  }

  if (yesVotes >= 15) {
    return { rank: "🛡 Endorsed", stars: "⭐⭐⭐⭐" };
  }

  if (yesVotes >= 10) {
    return { rank: "🔷 Trusted", stars: "⭐⭐⭐" };
  }

  if (yesVotes >= 5) {
    return { rank: "✅ Verified", stars: "⭐⭐" };
  }

  return { rank: "🚫 Unverified", stars: "⭐" };
}

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
    logger?.info?.("Updated Telegram user record", {
      userId: updated.id,
      telegramId: input.telegramId,
    });
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
        totalYesVotes: 0,
        totalNoVotes: 0,
        rank: "🚫 Unverified",
        stars: "⭐",
      })
      .returning();

    // insert().returning() always returns the inserted row
    const created = rows[0]!;
    logger?.info?.("Created Telegram user record", {
      userId: created.id,
      telegramId: input.telegramId,
    });
    return created;
  } catch (error) {
    logger?.warn?.("Concurrent user create detected, retrying lookup", {
      telegramId: input.telegramId,
      error,
    });

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

export async function updateUserVotes(input: {
  userId: number;
  yesVotes: number;
  noVotes: number;
}) {
  const { rank, stars } = calculateRank(input.yesVotes);

  const rows = await db
    .update(users)
    .set({
      totalYesVotes: input.yesVotes,
      totalNoVotes: input.noVotes,
      rank,
      stars,
      updatedAt: new Date(),
    })
    .where(eq(users.id, input.userId))
    .returning();

  return rows[0]!;
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

export const updateUserVotesTool = {
  execute: async ({
    context,
  }: {
    context: { userId: number; yesVotes: number; noVotes: number };
  }) => updateUserVotes(context),
};
