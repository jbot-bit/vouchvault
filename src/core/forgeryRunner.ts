// Inline-cards phase 1: thin runtime wiring for forgery enforcement.
//
// Owns the boring glue between the pure detector + enforcement
// orchestrator and the real Telegram + DB I/O. Kept separate so
// telegramBot.ts only needs to call one entry point per branch
// (group message, edited_message), and so the plumbing can be
// swapped in tests if ever needed.

import {
  detectForgery,
  type ForgeryVerdict,
} from "./forgeryDetector.ts";
import {
  enforceForgery,
  type EnforcementDeps,
} from "./forgeryEnforcement.ts";
import {
  countRecentStrikes,
  recordStrike,
} from "./forgeryStore.ts";
import { recordAdminAction } from "./adminAuditStore.ts";
import {
  deleteTelegramMessage,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import { TelegramApiError, TelegramForbiddenError } from "./typedTelegramErrors.ts";

type LoggerLike = {
  info?: (ctx: any, msg: string) => void;
  warn?: (ctx: any, msg: string) => void;
  error?: (ctx: any, msg: string) => void;
};

function buildDeps(logger?: LoggerLike): EnforcementDeps {
  return {
    deleteMessage: async ({ chatId, messageId }) => {
      try {
        await deleteTelegramMessage({ chatId, messageId }, logger);
        return { deleted: true };
      } catch (error) {
        if (error instanceof TelegramApiError && /not found/i.test(error.message ?? "")) {
          return { deleted: false };
        }
        throw error;
      }
    },
    dmUser: async ({ userId, text }) => {
      try {
        await sendTelegramMessage({ chatId: userId, text }, logger);
      } catch (error) {
        if (error instanceof TelegramForbiddenError) return; // user blocked the bot
        throw error;
      }
    },
    recordStrike: async (input) => recordStrike(input),
    countRecentStrikes: async (input) => countRecentStrikes(input),
    audit: async (input) => {
      await recordAdminAction({
        adminTelegramId: 0, // system actor
        adminUsername: null,
        command: `forgery:${input.kind}`,
        targetChatId: input.chatId,
        targetUsername: null,
        reason: `deleted=${input.deleted} freeze=${input.escalatedToFreeze} hash=${input.contentHash}`,
        denied: false,
      });
    },
    freezeUser: async ({ userId, reason }) => {
      // Freeze targets a business_profiles row by username; for system-
      // initiated forgery freezes we don't always know the username from
      // the message. Best effort: log and skip when no username present.
      // Future: extend to a user-id-keyed freeze pathway.
      logger?.warn?.(
        { userId, reason },
        "[forgery] freeze pathway is profile-keyed; system freeze on user_id deferred",
      );
      return { frozen: false };
    },
    logger,
  };
}

function freezeConfig() {
  const t = Number(process.env.FORGERY_FREEZE_THRESHOLD);
  const w = Number(process.env.FORGERY_FREEZE_WINDOW_HOURS);
  return {
    freezeThreshold: Number.isFinite(t) && t > 0 ? t : undefined,
    freezeWindowHours: Number.isFinite(w) && w > 0 ? w : undefined,
  };
}

// Returns true when a forgery was detected and enforcement ran.
// Caller (telegramBot.ts) uses the return to short-circuit further
// handling (mirror, command routing) so a forgery never reaches the
// backup channel.
export async function runForgeryCheckOnMessage(
  message: any,
  ourBotId: number | undefined,
  logger?: LoggerLike,
): Promise<{ enforced: boolean; verdict?: ForgeryVerdict }> {
  const verdict = detectForgery({ message, ourBotId, kind: "message" });
  if (!verdict) return { enforced: false };
  await runEnforcement(message, verdict, logger);
  return { enforced: true, verdict };
}

export async function runForgeryCheckOnEdit(
  edited: any,
  ourBotId: number | undefined,
  logger?: LoggerLike,
): Promise<{ enforced: boolean; verdict?: ForgeryVerdict }> {
  const verdict = detectForgery({ message: edited, ourBotId, kind: "edited_message" });
  if (!verdict) return { enforced: false };
  await runEnforcement(edited, verdict, logger);
  return { enforced: true, verdict };
}

async function runEnforcement(
  message: any,
  verdict: ForgeryVerdict,
  logger?: LoggerLike,
): Promise<void> {
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const userId = message?.from?.id;
  if (typeof chatId !== "number" || typeof messageId !== "number" || typeof userId !== "number") {
    logger?.warn?.({ chatId, messageId, userId }, "[forgery] insufficient ids for enforcement");
    return;
  }
  const deps = buildDeps(logger);
  await enforceForgery(deps, {
    chatId,
    messageId,
    userId,
    verdict,
    config: freezeConfig(),
  });
}
