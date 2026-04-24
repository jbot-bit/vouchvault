import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../storage/db";
import { users } from "../storage/schema";
import { eq } from "drizzle-orm";

function calculateRank(yesVotes: number): { rank: string; stars: string } {
  if (yesVotes >= 20) {
    return { rank: "👑 Top-Tier Verified", stars: "⭐⭐⭐⭐⭐" };
  } else if (yesVotes >= 15) {
    return { rank: "🛡 Endorsed", stars: "⭐⭐⭐⭐" };
  } else if (yesVotes >= 10) {
    return { rank: "🔷 Trusted", stars: "⭐⭐⭐" };
  } else if (yesVotes >= 5) {
    return { rank: "✅ Verified", stars: "⭐⭐" };
  } else {
    return { rank: "🚫 Unverified", stars: "⭐" };
  }
}

export const createOrUpdateUserTool = createTool({
  id: "create-or-update-user",
  description: "Creates a new user or updates an existing user in the database based on their Telegram ID",
  inputSchema: z.object({
    telegramId: z.number().describe("Telegram user ID"),
    username: z.string().nullish().describe("Telegram username (optional)"),
    firstName: z.string().nullish().describe("User's first name (optional)"),
    lastName: z.string().nullish().describe("User's last name (optional)"),
  }),
  outputSchema: z.object({
    id: z.number(),
    telegramId: z.number(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    totalYesVotes: z.number(),
    totalNoVotes: z.number(),
    rank: z.string(),
    stars: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [createOrUpdateUserTool] Creating or updating user", { context });

    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, context.telegramId))
      .limit(1);

    if (existingUser.length > 0) {
      logger?.info("📝 [createOrUpdateUserTool] User exists, updating username if changed");
      const user = existingUser[0];
      
      const needsUpdate =
        (context.username && user.username !== context.username) ||
        (context.firstName && user.firstName !== context.firstName) ||
        (context.lastName && user.lastName !== context.lastName);

      if (needsUpdate) {
        const [updated] = await db
          .update(users)
          .set({
            username: context.username || user.username,
            firstName: context.firstName || user.firstName,
            lastName: context.lastName || user.lastName,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();

        logger?.info("✅ [createOrUpdateUserTool] User updated", { updated });
        return updated;
      }

      logger?.info("✅ [createOrUpdateUserTool] User unchanged", { user });
      return user;
    }

    logger?.info("📝 [createOrUpdateUserTool] Creating new user");

    try {
      const [newUser] = await db
        .insert(users)
        .values({
          telegramId: context.telegramId,
          username: context.username,
          firstName: context.firstName,
          lastName: context.lastName,
          totalYesVotes: 0,
          totalNoVotes: 0,
          rank: "🚫 Unverified",
          stars: "⭐",
        })
        .returning();

      logger?.info("✅ [createOrUpdateUserTool] New user created", { newUser });
      return newUser;
    } catch (error) {
      logger?.warn("⚠️ [createOrUpdateUserTool] Concurrent create detected, retrying lookup", { error });

      const retryUser = await db
        .select()
        .from(users)
        .where(eq(users.telegramId, context.telegramId))
        .limit(1);

      if (retryUser.length > 0) {
        return retryUser[0];
      }

      throw error;
    }
  },
});

export const getUserByTelegramIdTool = createTool({
  id: "get-user-by-telegram-id",
  description: "Retrieves a user from the database by their Telegram ID",
  inputSchema: z.object({
    telegramId: z.number().describe("Telegram user ID"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    user: z
      .object({
        id: z.number(),
        telegramId: z.number(),
        username: z.string().nullable(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        totalYesVotes: z.number(),
        totalNoVotes: z.number(),
        rank: z.string(),
        stars: z.string(),
      })
      .nullable(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getUserByTelegramIdTool] Looking up user", { context });

    const result = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, context.telegramId))
      .limit(1);

    if (result.length === 0) {
      logger?.info("📝 [getUserByTelegramIdTool] User not found");
      return { found: false, user: null };
    }

    logger?.info("✅ [getUserByTelegramIdTool] User found", { user: result[0] });
    return { found: true, user: result[0] };
  },
});

export const updateUserVotesTool = createTool({
  id: "update-user-votes",
  description: "Updates a user's vote counts and recalculates their rank based on the new vote totals",
  inputSchema: z.object({
    userId: z.number().describe("User's database ID"),
    yesVotes: z.number().describe("Total yes votes"),
    noVotes: z.number().describe("Total no votes"),
  }),
  outputSchema: z.object({
    id: z.number(),
    telegramId: z.number(),
    username: z.string().nullable(),
    totalYesVotes: z.number(),
    totalNoVotes: z.number(),
    rank: z.string(),
    stars: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [updateUserVotesTool] Updating user votes", { context });

    const { rank, stars } = calculateRank(context.yesVotes);

    const [updated] = await db
      .update(users)
      .set({
        totalYesVotes: context.yesVotes,
        totalNoVotes: context.noVotes,
        rank,
        stars,
        updatedAt: new Date(),
      })
      .where(eq(users.id, context.userId))
      .returning();

    logger?.info("✅ [updateUserVotesTool] User votes updated", { updated });
    return updated;
  },
});
