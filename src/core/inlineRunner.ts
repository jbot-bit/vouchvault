// Inline-cards phase 2: thin runtime wiring for the inline_query handler.
//
// Adapts the pure handler in `inlineQueryHandler.ts` to the project's
// real archive lookup, member registry, rate limiter, and Telegram
// API. Mirrors the forgeryRunner pattern.

import {
  handleChosenInlineResult,
  handleInlineQuery,
  type InlineHandleResult,
  type InlineQueryDeps,
} from "./inlineQueryHandler.ts";
import { isMember as dbIsMember } from "./sc45MembersStore.ts";
import { recordChosenInlineResult } from "./chosenInlineResultStore.ts";
import { memberLookupLimiter } from "./lookupRateLimit.ts";
import { answerInlineQuery } from "./tools/telegramTools.ts";
import { getArchiveEntriesForTarget } from "./archiveStore.ts";
import { getBusinessProfileByUsername } from "./archiveStore.ts";
import type { ArchiveRowForCard } from "./inlineCard.ts";

type LoggerLike = {
  info?: (ctx: any, msg: string) => void;
  warn?: (ctx: any, msg: string) => void;
};

function buildDeps(logger?: LoggerLike): InlineQueryDeps {
  return {
    isMember: async (userId) => {
      try {
        return await dbIsMember(userId);
      } catch (error) {
        logger?.warn?.({ error, userId }, "[inline] isMember check failed; treating as non-member");
        return false;
      }
    },
    fetchArchive: async (targetUsername) => {
      const profile = await getBusinessProfileByUsername(targetUsername);
      if (!profile) return null;
      const entries = await getArchiveEntriesForTarget(targetUsername, 50);
      const rows: Array<ArchiveRowForCard> = entries.map((e) => ({
        reviewerUsername: e.reviewerUsername ?? "unknown",
        result: (e.result as "POS" | "NEG" | "MIX") ?? "POS",
        bodyText: e.bodyText ?? "",
        createdAt: e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt),
      }));
      return { targetId: profile.id, rows };
    },
    rateLimit: (userId, now) =>
      memberLookupLimiter.tryConsume(userId, now, "inline"),
    answer: async (input) => {
      await answerInlineQuery(input, logger);
    },
    recordChoice: async (input) => recordChosenInlineResult(input),
    logger,
  };
}

export async function runInlineQuery(
  update: any,
  logger?: LoggerLike,
): Promise<InlineHandleResult> {
  return handleInlineQuery(buildDeps(logger), update);
}

export async function runChosenInlineResult(update: any, logger?: LoggerLike): Promise<void> {
  await handleChosenInlineResult(buildDeps(logger), update);
}
