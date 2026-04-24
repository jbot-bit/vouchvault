import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../storage/db";
import { polls, votes, users } from "../storage/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const createPollTool = createTool({
  id: "create-poll",
  description: "Creates a new verification poll in the database",
  inputSchema: z.object({
    telegramPollId: z.string().describe("Telegram poll ID"),
    userId: z.number().describe("Database user ID being verified"),
    chatId: z.number().describe("Telegram chat ID"),
    pollMessageId: z.number().describe("Message ID of the poll"),
    cardMessageId: z.number().describe("Message ID of the reputation card"),
  }),
  outputSchema: z.object({
    id: z.number(),
    telegramPollId: z.string(),
    userId: z.number(),
    chatId: z.number(),
    pollMessageId: z.number(),
    cardMessageId: z.number(),
    isActive: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [createPollTool] Creating poll", { context });

    const [newPoll] = await db
      .insert(polls)
      .values({
        telegramPollId: context.telegramPollId,
        userId: context.userId,
        chatId: context.chatId,
        pollMessageId: context.pollMessageId,
        cardMessageId: context.cardMessageId,
        isActive: true,
      })
      .returning();

    logger?.info("✅ [createPollTool] Poll created", { newPoll });
    return newPoll;
  },
});

export const getPollByTelegramIdTool = createTool({
  id: "get-poll-by-telegram-id",
  description: "Retrieves a poll from the database by its Telegram poll ID",
  inputSchema: z.object({
    telegramPollId: z.string().describe("Telegram poll ID"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    poll: z
      .object({
        id: z.number(),
        telegramPollId: z.string(),
        userId: z.number(),
        chatId: z.number(),
        pollMessageId: z.number(),
        cardMessageId: z.number(),
        isActive: z.boolean(),
        createdAt: z.date(),
        lastBumpedAt: z.date(),
      })
      .nullable(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getPollByTelegramIdTool] Looking up poll", { context });

    const result = await db
      .select()
      .from(polls)
      .where(eq(polls.telegramPollId, context.telegramPollId))
      .limit(1);

    if (result.length === 0) {
      logger?.info("📝 [getPollByTelegramIdTool] Poll not found");
      return { found: false, poll: null };
    }

    logger?.info("✅ [getPollByTelegramIdTool] Poll found", { poll: result[0] });
    return { found: true, poll: result[0] };
  },
});

export const getActivePollsForUserTool = createTool({
  id: "get-active-polls-for-user",
  description: "Retrieves active polls for a specific user to check if they can create a new poll or bump an existing one",
  inputSchema: z.object({
    userId: z.number().describe("Database user ID"),
  }),
  outputSchema: z.object({
    polls: z.array(
      z.object({
        id: z.number(),
        telegramPollId: z.string(),
        chatId: z.number(),
        pollMessageId: z.number(),
        cardMessageId: z.number(),
        createdAt: z.date(),
        lastBumpedAt: z.date(),
      })
    ),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getActivePollsForUserTool] Getting active polls", { context });

    const result = await db
      .select()
      .from(polls)
      .where(and(eq(polls.userId, context.userId), eq(polls.isActive, true)))
      .orderBy(desc(polls.createdAt));

    logger?.info("✅ [getActivePollsForUserTool] Found polls", { count: result.length });
    return { polls: result };
  },
});

export const updatePollBumpTimeTool = createTool({
  id: "update-poll-bump-time",
  description: "Updates the last bumped time for a poll when it's bumped",
  inputSchema: z.object({
    pollId: z.number().describe("Database poll ID"),
  }),
  outputSchema: z.object({
    id: z.number(),
    lastBumpedAt: z.date(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [updatePollBumpTimeTool] Updating bump time", { context });

    const [updated] = await db
      .update(polls)
      .set({
        lastBumpedAt: new Date(),
      })
      .where(eq(polls.id, context.pollId))
      .returning();

    logger?.info("✅ [updatePollBumpTimeTool] Bump time updated", { updated });
    return updated;
  },
});

export const recordVoteTool = createTool({
  id: "record-vote",
  description: "Records a vote in the database (upserts if voter already voted)",
  inputSchema: z.object({
    pollId: z.number().describe("Database poll ID"),
    voterId: z.number().describe("Database voter ID"),
    voteValue: z.boolean().describe("True for Yes, False for No"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [recordVoteTool] Recording vote", { context });

    try {
      await db
        .insert(votes)
        .values({
          pollId: context.pollId,
          voterId: context.voterId,
          voteValue: context.voteValue,
        })
        .onConflictDoUpdate({
          target: [votes.pollId, votes.voterId],
          set: {
            voteValue: context.voteValue,
          },
        });

      logger?.info("✅ [recordVoteTool] Vote recorded");
      return { success: true, message: "Vote recorded successfully" };
    } catch (error) {
      logger?.error("❌ [recordVoteTool] Error recording vote", { error });
      return { success: false, message: `Error: ${error}` };
    }
  },
});

export const getVoteCountsForPollTool = createTool({
  id: "get-vote-counts-for-poll",
  description: "Gets the current vote counts (yes and no) for a specific poll",
  inputSchema: z.object({
    pollId: z.number().describe("Database poll ID"),
  }),
  outputSchema: z.object({
    yesVotes: z.number(),
    noVotes: z.number(),
    totalVotes: z.number(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getVoteCountsForPollTool] Getting vote counts", { context });

    const result = await db
      .select({
        yesVotes: sql<number>`COUNT(CASE WHEN ${votes.voteValue} = true THEN 1 END)::int`,
        noVotes: sql<number>`COUNT(CASE WHEN ${votes.voteValue} = false THEN 1 END)::int`,
        totalVotes: sql<number>`COUNT(*)::int`,
      })
      .from(votes)
      .where(eq(votes.pollId, context.pollId));

    const counts = result[0] || { yesVotes: 0, noVotes: 0, totalVotes: 0 };
    logger?.info("✅ [getVoteCountsForPollTool] Vote counts retrieved", { counts });
    return counts;
  },
});

export const getLeaderboardTool = createTool({
  id: "get-leaderboard",
  description: "Retrieves the top 20 users by yes votes for the leaderboard",
  inputSchema: z.object({}),
  outputSchema: z.object({
    leaderboard: z.array(
      z.object({
        position: z.number(),
        username: z.string().nullable(),
        firstName: z.string().nullable(),
        totalYesVotes: z.number(),
        rank: z.string(),
        stars: z.string(),
      })
    ),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getLeaderboardTool] Getting leaderboard");

    const result = await db
      .select({
        username: users.username,
        firstName: users.firstName,
        totalYesVotes: users.totalYesVotes,
        rank: users.rank,
        stars: users.stars,
      })
      .from(users)
      .orderBy(desc(users.totalYesVotes))
      .limit(20);

    const leaderboard = result.map((user, index) => ({
      position: index + 1,
      ...user,
    }));

    logger?.info("✅ [getLeaderboardTool] Leaderboard retrieved", {
      count: leaderboard.length,
    });
    return { leaderboard };
  },
});

export const getUserStatsTool = createTool({
  id: "get-user-stats",
  description: "Gets a user's personal statistics including rank, position, and next milestone",
  inputSchema: z.object({
    userId: z.number().describe("Database user ID"),
  }),
  outputSchema: z.object({
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    totalYesVotes: z.number(),
    totalNoVotes: z.number(),
    rank: z.string(),
    stars: z.string(),
    position: z.number().nullable(),
    nextMilestone: z.object({
      rank: z.string(),
      votesNeeded: z.number(),
    }).nullable(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getUserStatsTool] Getting user stats", { context });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, context.userId))
      .limit(1);

    if (!user) {
      throw new Error("User not found");
    }

    const allUsers = await db
      .select({ id: users.id, totalYesVotes: users.totalYesVotes })
      .from(users)
      .orderBy(desc(users.totalYesVotes));

    const position = allUsers.findIndex((u) => u.id === user.id) + 1;

    let nextMilestone = null;
    const milestones = [
      { votes: 5, rank: "✅ Verified" },
      { votes: 10, rank: "🔷 Trusted" },
      { votes: 15, rank: "🛡 Endorsed" },
      { votes: 20, rank: "👑 Top-Tier Verified" },
    ];

    for (const milestone of milestones) {
      if (user.totalYesVotes < milestone.votes) {
        nextMilestone = {
          rank: milestone.rank,
          votesNeeded: milestone.votes - user.totalYesVotes,
        };
        break;
      }
    }

    logger?.info("✅ [getUserStatsTool] Stats retrieved", {
      position,
      nextMilestone,
    });

    return {
      username: user.username,
      firstName: user.firstName,
      totalYesVotes: user.totalYesVotes,
      totalNoVotes: user.totalNoVotes,
      rank: user.rank,
      stars: user.stars,
      position,
      nextMilestone,
    };
  },
});

export const getAllActiveActivePollsTool = createTool({
  id: "get-all-active-polls",
  description: "Gets all active verification polls for activity summaries",
  inputSchema: z.object({}),
  outputSchema: z.object({
    polls: z.array(
      z.object({
        id: z.number(),
        telegramPollId: z.string(),
        username: z.string().nullable(),
        firstName: z.string().nullable(),
        chatId: z.number(),
        pollMessageId: z.number(),
        yesVotes: z.number(),
        noVotes: z.number(),
      })
    ),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getAllActiveActivePollsTool] Getting all active polls");

    const result = await db
      .select({
        pollId: polls.id,
        telegramPollId: polls.telegramPollId,
        username: users.username,
        firstName: users.firstName,
        chatId: polls.chatId,
        pollMessageId: polls.pollMessageId,
      })
      .from(polls)
      .innerJoin(users, eq(polls.userId, users.id))
      .where(eq(polls.isActive, true));

    const pollsWithVotes = await Promise.all(
      result.map(async (poll) => {
        const voteCounts = await db
          .select({
            yesVotes: sql<number>`COUNT(CASE WHEN ${votes.voteValue} = true THEN 1 END)::int`,
            noVotes: sql<number>`COUNT(CASE WHEN ${votes.voteValue} = false THEN 1 END)::int`,
          })
          .from(votes)
          .where(eq(votes.pollId, poll.pollId));

        return {
          id: poll.pollId,
          telegramPollId: poll.telegramPollId,
          username: poll.username,
          firstName: poll.firstName,
          chatId: poll.chatId,
          pollMessageId: poll.pollMessageId,
          yesVotes: voteCounts[0]?.yesVotes || 0,
          noVotes: voteCounts[0]?.noVotes || 0,
        };
      })
    );

    logger?.info("✅ [getAllActiveActivePollsTool] Active polls retrieved", {
      count: pollsWithVotes.length,
    });
    return { polls: pollsWithVotes };
  },
});
