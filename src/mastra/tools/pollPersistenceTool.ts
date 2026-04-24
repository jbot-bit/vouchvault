import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../storage/db";
import { polls } from "../storage/schema";

export const savePollWithMessageIdsTool = createTool({
  id: "save-poll-with-message-ids",
  description: "Saves a new poll record with Telegram message IDs after the poll has been created",
  inputSchema: z.object({
    telegramPollId: z.string().describe("Telegram poll ID from API response"),
    userId: z.number().describe("Database user ID being verified"),
    chatId: z.number().describe("Telegram chat ID"),
    pollMessageId: z.number().describe("Message ID of the poll from Telegram"),
    cardMessageId: z.number().describe("Message ID of the reputation card from Telegram"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    pollId: z.number(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [savePollWithMessageIdsTool] Saving poll to database", { context });

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

    logger?.info("✅ [savePollWithMessageIdsTool] Poll saved successfully", { pollId: newPoll.id });
    
    return {
      success: true,
      pollId: newPoll.id,
    };
  },
});
