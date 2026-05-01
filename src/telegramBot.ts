import {
  buildAdminHelpText,
  buildAdminOnlyText,
  buildDbStatsText,
  buildFrozenListText,
  buildInlineLookupResult,
  buildLookupReplyMarkup,
  buildLookupText,
  buildMeText,
  buildMirrorStatsText,
  buildModStatsText,
  buildPolicyText,
  buildRemoveEntryConfirmMarkup,
  buildRemoveEntryConfirmText,
  buildWelcomeText,
  isReservedTarget,
  LOOKUP_GROUP_PREVIEW_ENTRIES,
  LOOKUP_PREVIEW_ENTRIES,
  MAINTENANCE_EVERY_N_UPDATES,
  FREEZE_REASONS,
  formatUsername,
  isFreezeReason,
  normalizeUsername,
  parseLookupExpandCallback,
  parseLookupNegCallback,
  parseRemoveEntryCancelCallback,
  parseRemoveEntryConfirmCallback,
  parseSelectedTags,
  MAX_LOOKUP_ENTRIES,
  type EntryResult,
  type EntrySource,
} from "./core/archive.ts";
import { runChatModeration } from "./core/chatModeration.ts";
import {
  beginForget,
  buildForgetCancelledText,
  buildForgetDoneText,
  buildForgetExpiredText,
  buildForgetGroupRedirectText,
  buildForgetPromptText,
  executeForget,
  memberForgetState,
  tryConfirmForget,
} from "./core/forgetMe.ts";
import { defaultForgetDeps } from "./core/forgetMeStore.ts";
import { resolveMirrorConfig, shouldMirror } from "./core/mirrorPublish.ts";
import {
  getMirrorDiagnostics,
  recordMirror,
  wasAlreadyMirrored,
} from "./core/mirrorStore.ts";
import { memberLookupLimiter } from "./core/lookupRateLimit.ts";
import { getTelegramBotId } from "./core/tools/telegramTools.ts";
import {
  completeTelegramUpdate,
  getArchiveCountsForTarget,
  getArchiveDiagnostics,
  getArchiveEntriesForTarget,
  getArchiveEntryById,
  getAuthoredCountForReviewer,
  getBusinessProfileByUsername,
  getModerationDiagnostics,
  listFrozenProfiles,
  markArchiveEntryRemoved,
  releaseTelegramUpdate,
  setArchiveEntryStatus,
  reserveTelegramUpdate,
  runArchiveMaintenance,
  setBusinessProfileFrozen,
} from "./core/archiveStore.ts";
import { buildThreadedGroupReplyOptions } from "./core/telegramUx.ts";
import { getAllowedTelegramChatIdSet } from "./core/telegramChatConfig.ts";
import {
  answerTelegramCallbackQuery,
  answerTelegramInlineQuery,
  deleteTelegramMessage,
  forwardTelegramMessage,
  sendTelegramMessage,
} from "./core/tools/telegramTools.ts";
import {
  isChatDisabled,
  setChatActive,
  setChatGone,
  setChatKicked,
  setChatMigrated,
  setChatPaused,
} from "./core/chatSettingsStore.ts";
import { recordAdminAction } from "./core/adminAuditStore.ts";
import { handleChatGone } from "./core/chatGoneHandler.ts";
import {
  buildVelocityAlertText,
  classifyChatMemberTransition,
  createMemberVelocityState,
  recordMemberEvent,
} from "./core/memberVelocity.ts";
import { TelegramChatGoneError } from "./core/typedTelegramErrors.ts";
import { parseChatMigration, shouldMarkChatKicked } from "./core/telegramDispatch.ts";
import { recordUserFirstSeen } from "./core/userTracking.ts";
import { extractUpdateUserId } from "./core/webhookUserId.ts";
import { fingerprintInviteLink, recordInviteLinkUsed } from "./core/inviteLinks.ts";

type LoggerLike = Pick<Console, "info" | "warn" | "error">;

const allowedTelegramChatIds = getAllowedTelegramChatIdSet();

// Per takedown spec §3.4. In-memory; resets on deploy. The alert is a
// heuristic; a fresh window after redeploy is acceptable.
const velocityState = createMemberVelocityState();

function getAdminIds(): Set<number> {
  return new Set(
    (process.env.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value)),
  );
}

function isAdmin(telegramId: number | null | undefined): boolean {
  return telegramId != null && getAdminIds().has(telegramId);
}

function getCommandParts(text: string) {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  // split on non-empty string always yields at least one element
  const rawCommand = parts[0]!;
  const args = parts.slice(1);
  const command = rawCommand.split("@")[0]!.toLowerCase();
  return { command, args };
}

function buildReplyOptions(
  replyToMessageId?: number | null,
  disableNotification = false,
  messageThreadId?: number | null,
) {
  const threadOptions =
    typeof messageThreadId === "number" ? { messageThreadId } : {};
  if (replyToMessageId == null) {
    return {
      ...threadOptions,
      ...(disableNotification ? { disableNotification } : {}),
    };
  }

  return {
    ...buildThreadedGroupReplyOptions(replyToMessageId, messageThreadId),
    disableNotification,
  };
}

async function handleLookupCommand(input: {
  chatId: number;
  rawUsername: string | null | undefined;
  // "admin" → full audit (private NEGs + private_note included).
  // "member" → public view (POS + MIX only, private_note hidden).
  viewerScope: "admin" | "member";
  // "preview" → first N entries (5 in DM, 3 in group) + buttons.
  // "all" → up to MAX_LOOKUP_ENTRIES, no button.
  // "neg" → admin-only NEG-filter view (callback target).
  mode?: "preview" | "all" | "neg";
  // Group surface uses 3-entry preview + URL deep-link button to the
  // bot DM (so the rest doesn't spam the group). When true, the
  // "See all" button becomes a t.me/<bot>?start=search_<user> URL.
  inGroup?: boolean;
  replyToMessageId?: number | null;
  messageThreadId?: number | null;
  disableNotification?: boolean;
  logger?: LoggerLike;
}) {
  const targetUsername = normalizeUsername(input.rawUsername ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Search requires /search @username.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  const mode = input.mode ?? "preview";
  const [entries, profile, rawCounts, authoredCount] = await Promise.all([
    getArchiveEntriesForTarget(
      targetUsername,
      MAX_LOOKUP_ENTRIES,
      mode === "neg" ? "negative" : undefined,
    ),
    getBusinessProfileByUsername(targetUsername),
    getArchiveCountsForTarget(targetUsername),
    getAuthoredCountForReviewer(targetUsername),
  ]);
  // Member view filters out NEGs in both display AND counts (the
  // existence of NEGs is itself private — admins only).
  const visibleEntries =
    input.viewerScope === "admin"
      ? entries
      : entries.filter((entry) => entry.result !== "negative");
  const counts =
    input.viewerScope === "admin"
      ? { ...rawCounts, authoredCount }
      : {
          total: rawCounts.positive + rawCounts.mixed,
          positive: rawCounts.positive,
          mixed: rawCounts.mixed,
          negative: 0,
          firstAt: rawCounts.firstAt,
          lastAt: rawCounts.lastAt,
          recentCount: rawCounts.recentCount,
          recentCount30d: rawCounts.recentCount30d,
          distinctReviewers: rawCounts.distinctReviewers,
          distinctReviewers12mo: rawCounts.distinctReviewers12mo,
          authoredCount,
        };
  input.logger?.info?.(
    {
      targetUsername,
      viewerScope: input.viewerScope,
      mode,
      entryCount: entries.length,
      visibleCount: visibleEntries.length,
      total: counts.total,
      profileFound: profile != null,
    },
    "[Search] query executed",
  );
  const previewLimit = input.inGroup ? LOOKUP_GROUP_PREVIEW_ENTRIES : LOOKUP_PREVIEW_ENTRIES;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@+/, "") || null;
  const replyMarkup = buildLookupReplyMarkup({
    targetUsername,
    totalShown:
      mode === "preview" ? Math.min(visibleEntries.length, previewLimit) : visibleEntries.length,
    totalAvailable: counts.total,
    mode,
    // NEG-button: admin-only, only shown when target has at least one
    // negative entry. rawCounts.negative is the unfiltered ground truth
    // (member-view counts.negative is forced to 0).
    negCount: input.viewerScope === "admin" ? rawCounts.negative : 0,
    isAdmin: input.viewerScope === "admin",
    // Group context: deep-link "See all" into the bot DM so the full
    // result lands privately, not in the group.
    inGroupBotUsername: input.inGroup && botUsername ? botUsername : undefined,
  });
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildLookupText({
        targetUsername,
        isFrozen: profile?.isFrozen ?? false,
        freezeReason: profile?.freezeReason ?? null,
        counts,
        mode,
        previewLimit,
        viewerScope: input.viewerScope,
        entries: visibleEntries.map((entry) => ({
          id: entry.id,
          reviewerUsername: entry.reviewerUsername,
          result: entry.result as EntryResult,
          tags: parseSelectedTags(entry.selectedTags),
          createdAt: entry.createdAt,
          source: entry.source as EntrySource,
          privateNote: input.viewerScope === "admin" ? entry.privateNote ?? null : null,
          bodyText: entry.bodyText ?? null,
        })),
      }),
      ...(replyMarkup ? { replyMarkup } : {}),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
    },
    input.logger,
  );
}

async function handleAdminCommand(input: {
  command: string;
  args: string[];
  chatId: number;
  replyToMessageId?: number | null;
  messageThreadId?: number | null;
  disableNotification?: boolean;
  from: any;
  logger?: LoggerLike;
}) {
  if (!isAdmin(input.from?.id)) {
    await recordAdminAction({
      adminTelegramId: input.from?.id ?? 0,
      adminUsername: input.from?.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      targetUsername: input.args[0] ?? null,
      denied: true,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildAdminOnlyText(),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/freeze" || input.command === "/unfreeze") {
    const targetUsername = normalizeUsername(input.args[0] ?? "");
    if (!targetUsername) {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        targetUsername: input.args[0] ?? null,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Use: ${input.command} @username${input.command === "/freeze" ? " [reason]" : ""}.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }

    let reason: string | null = null;
    if (input.command === "/freeze") {
      const rawReason = input.args[1] ?? "";
      if (!isFreezeReason(rawReason)) {
        await recordAdminAction({
          adminTelegramId: input.from.id,
          adminUsername: input.from.username ?? null,
          command: input.command,
          targetChatId: input.chatId,
          targetUsername,
          denied: true,
        });
        await sendTelegramMessage(
          {
            chatId: input.chatId,
            text:
              "Reason must be one of:\n" +
              FREEZE_REASONS.map((r) => `• <code>${r}</code>`).join("\n"),
            ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
          },
          input.logger,
        );
        return;
      }
      reason = rawReason;
    }
    const updated = await setBusinessProfileFrozen({
      username: targetUsername,
      isFrozen: input.command === "/freeze",
      reason,
      byTelegramId: input.from.id,
    });
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      targetUsername,
      reason,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `${formatUsername(updated.username)} is now ${updated.isFrozen ? "frozen" : "active"}.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/remove_entry") {
    const entryId = Number(input.args[0]);
    if (!Number.isSafeInteger(entryId) || entryId <= 0) {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "Send /remove_entry &lt;id&gt;",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }

    const entry = await getArchiveEntryById(entryId);
    if (!entry) {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        entryId,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} not found.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }

    // Two-step destructive: render a preview + Confirm/Cancel buttons.
    // The actual removal happens in handleCallbackQuery on the
    // re:y:<id> callback. Audit row writes here record the prompt
    // (denied=true so it doesn't read as a successful removal).
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: `${input.command}:prompt`,
      targetChatId: input.chatId,
      entryId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildRemoveEntryConfirmText({
          entryId,
          reviewerUsername: entry.reviewerUsername,
          targetUsername: entry.targetUsername,
          result: entry.result as EntryResult,
          createdAt: entry.createdAt,
          bodyText: entry.bodyText ?? null,
        }),
        replyMarkup: buildRemoveEntryConfirmMarkup(entryId),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/mirrorstats") {
    const config = resolveMirrorConfig();
    const diag = await getMirrorDiagnostics();
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildMirrorStatsText({
          enabled: config != null,
          total: diag.total,
          last24h: diag.last24h,
          last1h: diag.last1h,
          lastForwardedAt: diag.lastForwardedAt,
        }),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/modstats") {
    const diag = await getModerationDiagnostics();
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildModStatsText(diag),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/frozen_list") {
    const rows = await listFrozenProfiles();
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildFrozenListText(rows),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/recover_entry") {
    const entryId = Number(input.args[0]);
    if (!Number.isSafeInteger(entryId)) {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "Use: /recover_entry &lt;id&gt;.",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }
    const entry = await getArchiveEntryById(entryId);
    if (!entry) {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        entryId,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} not found.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }
    if (entry.status !== "publishing") {
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        entryId,
        reason: `wrong status: ${entry.status}`,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} is in status="${entry.status}", no recovery needed.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
      return;
    }
    await setArchiveEntryStatus(entryId, "pending");
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      entryId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Entry #${entryId} reset to pending.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/pause" || input.command === "/unpause") {
    await setChatPaused({
      chatId: input.chatId,
      paused: input.command === "/pause",
      byTelegramId: input.from.id,
    });
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: input.command === "/pause" ? "Vouching paused." : "Vouching resumed.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/dbstats") {
    try {
      const stats = await getArchiveDiagnostics();
      await recordAdminAction({
        adminTelegramId: input.from.id,
        adminUsername: input.from.username ?? null,
        command: input.command,
        targetChatId: input.chatId,
        denied: false,
      });
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: buildDbStatsText(stats),
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
    } catch (error) {
      input.logger?.error?.({ err: error }, "[Admin] /dbstats failed");
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `DB diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
        },
        input.logger,
      );
    }
    return;
  }

  if (input.command === "/admin_help") {
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildAdminHelpText(),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }
}

async function handlePrivateMessage(message: any, logger?: LoggerLike) {
  const chatId = message.chat.id;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const fromId = message.from?.id;
  const fromUsername =
    typeof message.from?.username === "string" ? message.from.username : null;

  if (!text || !text.startsWith("/")) {
    // v9: bot has no DM wizard. Non-command DMs are either a /forgetme
    // YES confirmation or stray chat — fall through to the welcome
    // explainer when neither applies.
    if (typeof fromId === "number" && text) {
      const step = tryConfirmForget(memberForgetState, fromId, text);
      if (step.kind === "execute") {
        const total = await executeForget(
          { userId: fromId, username: fromUsername },
          defaultForgetDeps(),
        );
        await sendTelegramMessage(
          { chatId, text: buildForgetDoneText(total) },
          logger,
        );
        return;
      }
      if (step.kind === "expired") {
        await sendTelegramMessage(
          { chatId, text: buildForgetExpiredText() },
          logger,
        );
        return;
      }
    }
    if (text) {
      await sendTelegramMessage({ chatId, text: buildWelcomeText() }, logger);
    }
    return;
  }

  const { command, args } = getCommandParts(text);

  if (command === "/start" || command === "/help") {
    // Deep-link payload: /start search_<username> routes straight to
    // /search. This is what the group "See all in DM" button hits when
    // an admin clicks it — Telegram opens the DM and auto-sends
    // /start with the encoded payload.
    const payload = args[0]?.trim();
    if (command === "/start" && payload && payload.startsWith("search_")) {
      const target = payload.slice("search_".length);
      if (/^[a-z0-9_]{5,32}$/i.test(target)) {
        const isAdminCaller = isAdmin(fromId);
        if (!isAdminCaller && typeof fromId === "number") {
          const limited = memberLookupLimiter.tryConsume(fromId);
          if (!limited.allowed) {
            const seconds = Math.max(1, Math.ceil(limited.retryAfterMs / 1000));
            await sendTelegramMessage(
              { chatId, text: `Hold on — try again in ${seconds}s.` },
              logger,
            );
            return;
          }
        }
        await handleLookupCommand({
          chatId,
          rawUsername: target,
          viewerScope: isAdminCaller ? "admin" : "member",
          logger,
        });
        return;
      }
    }
    await sendTelegramMessage({ chatId, text: buildWelcomeText() }, logger);
    return;
  }

  if (command === "/policy" || command === "/privacy" || command === "/tos") {
    await sendTelegramMessage(
      {
        chatId,
        text: buildPolicyText(),
        linkPreviewOptions: { isDisabled: true },
      },
      logger,
    );
    return;
  }

  if (command === "/me") {
    // Self-summary. Caller's own @-handle only — never accepts an
    // argument (use /search for that). Admins are fine to use /me too;
    // it just shows their own data.
    if (!fromUsername) {
      await sendTelegramMessage(
        {
          chatId,
          text: "Set a Telegram @username on your profile to use /me.",
        },
        logger,
      );
      return;
    }
    const normalized = normalizeUsername(fromUsername);
    if (!normalized) {
      await sendTelegramMessage(
        { chatId, text: "Your @username isn't supported by /me." },
        logger,
      );
      return;
    }
    const [counts, authoredCount] = await Promise.all([
      getArchiveCountsForTarget(normalized),
      getAuthoredCountForReviewer(normalized),
    ]);
    await sendTelegramMessage(
      {
        chatId,
        text: buildMeText({
          username: normalized,
          counts: {
            total: counts.positive + counts.mixed,
            positive: counts.positive,
            mixed: counts.mixed,
            // NEG count not surfaced to self — the existence of NEGs
            // is admin-only per v9 design.
            negative: 0,
            firstAt: counts.firstAt,
            lastAt: counts.lastAt,
          },
          authoredCount,
        }),
      },
      logger,
    );
    return;
  }

  if (command === "/forgetme") {
    if (typeof fromId !== "number") {
      await sendTelegramMessage({ chatId, text: buildForgetGroupRedirectText() }, logger);
      return;
    }
    if (args[0]?.trim().toUpperCase() === "YES") {
      // Single-shot variant: /forgetme YES executes immediately if a
      // prompt is pending. Without a pending prompt, falls through to
      // the prompt step.
      const step = tryConfirmForget(memberForgetState, fromId, "YES");
      if (step.kind === "execute") {
        const total = await executeForget(
          { userId: fromId, username: fromUsername },
          defaultForgetDeps(),
        );
        await sendTelegramMessage({ chatId, text: buildForgetDoneText(total) }, logger);
        return;
      }
      if (step.kind === "expired") {
        await sendTelegramMessage({ chatId, text: buildForgetExpiredText() }, logger);
        return;
      }
    }
    if (args[0]?.toLowerCase() === "cancel") {
      memberForgetState.pendingByUser.delete(fromId);
      await sendTelegramMessage({ chatId, text: buildForgetCancelledText() }, logger);
      return;
    }
    beginForget(memberForgetState, fromId);
    await sendTelegramMessage({ chatId, text: buildForgetPromptText() }, logger);
    return;
  }

  if (command === "/search" || command === "/lookup") {
    // v9 phase 2: DM /lookup opens to all members. Admins get the full
    // audit (private NEGs + private_note); members get the public view
    // (POS + MIX only, private_note hidden). Members are rate-limited
    // to one lookup per LOOKUP_INTERVAL_MS.
    const fromId = message.from?.id;
    const isAdminCaller = isAdmin(fromId);
    if (!isAdminCaller && typeof fromId === "number") {
      const limited = memberLookupLimiter.tryConsume(fromId);
      if (!limited.allowed) {
        const seconds = Math.max(1, Math.ceil(limited.retryAfterMs / 1000));
        await sendTelegramMessage(
          { chatId, text: `Hold on — try again in ${seconds}s.` },
          logger,
        );
        return;
      }
    }
    await handleLookupCommand({
      chatId,
      rawUsername: args[0],
      viewerScope: isAdminCaller ? "admin" : "member",
      logger,
    });
    return;
  }

  if (
    command === "/freeze" ||
    command === "/unfreeze" ||
    command === "/remove_entry" ||
    command === "/frozen_list" ||
    command === "/recover_entry" ||
    command === "/pause" ||
    command === "/unpause" ||
    command === "/admin_help" ||
    command === "/dbstats" ||
    command === "/mirrorstats" ||
    command === "/modstats"
  ) {
    await handleAdminCommand({
      command,
      args,
      chatId,
      from: message.from,
      logger,
    });
    return;
  }

  // Unknown command — point the user at the welcome explainer.
  await sendTelegramMessage({ chatId, text: buildWelcomeText() }, logger);
}

async function maybeMirrorToBackupChannel(
  message: any,
  moderationDeleted: boolean,
  logger?: LoggerLike,
): Promise<void> {
  const config = resolveMirrorConfig();
  if (config == null) return;

  const allowed = Array.from(allowedTelegramChatIds);
  if (!shouldMirror({ message, allowedGroupChatIds: allowed, moderationDeleted })) {
    return;
  }

  const groupChatId = message.chat.id as number;
  const groupMessageId = message.message_id as number;

  try {
    if (await wasAlreadyMirrored({ groupChatId, groupMessageId })) {
      return;
    }
    const result = await forwardTelegramMessage(
      {
        fromChatId: groupChatId,
        toChatId: config.channelChatId,
        messageId: groupMessageId,
        disableNotification: true,
      },
      logger,
    );
    await recordMirror({
      groupChatId,
      groupMessageId,
      channelChatId: config.channelChatId,
      channelMessageId: result.message_id,
    });
  } catch (error) {
    logger?.warn?.(
      { err: error, groupChatId, groupMessageId, channelChatId: config.channelChatId },
      "mirror: forward to backup channel failed (non-fatal)",
    );
  }
}

async function handleGroupMessage(message: any, logger?: LoggerLike) {
  const migration = parseChatMigration(message);
  if (migration) {
    await setChatMigrated(migration.oldId, migration.newId);
    logger?.info?.(migration, "[Group] Chat migrated to supergroup");
    return;
  }
  if (message?.migrate_to_chat_id != null) {
    return;
  }

  // ── Chat moderation runs first. A delete short-circuits everything,
  // including command parsing — a member cannot smuggle a phrase past
  // moderation by prefixing it with a slash command.
  const botId = await getTelegramBotId(logger);
  let moderationDeleted = false;
  if (typeof botId === "number") {
    const mod = await runChatModeration({
      message,
      isAdmin,
      botTelegramId: botId,
      logger,
    });
    if (mod.deleted) {
      moderationDeleted = true;
    }
  }

  // v9 phase 1: backup-channel mirror via forwardMessage. Best-effort,
  // non-blocking — a forward failure logs but does not stop downstream
  // command processing. Idempotent via mirror_log unique on
  // (group_chat_id, group_message_id).
  await maybeMirrorToBackupChannel(message, moderationDeleted, logger);

  if (moderationDeleted) return;

  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (!text.startsWith("/")) {
    return;
  }

  const { command, args } = getCommandParts(text);
  const chatId = message.chat.id;

  // Forum-mode: preserve topic context for every bot reply. Bot API:
  // https://core.telegram.org/bots/api#sendmessage (message_thread_id).
  // Without this, replies to /lookup in a topic land in General.
  const messageThreadId =
    typeof message.message_thread_id === "number" ? message.message_thread_id : undefined;

  if (command === "/forgetme") {
    await sendTelegramMessage(
      {
        chatId,
        text: buildForgetGroupRedirectText(),
        ...buildReplyOptions(message.message_id, true, messageThreadId),
      },
      logger,
    );
    return;
  }

  if (command === "/policy" || command === "/privacy" || command === "/tos") {
    await sendTelegramMessage(
      {
        chatId,
        text: buildPolicyText(),
        linkPreviewOptions: { isDisabled: true },
        ...buildReplyOptions(message.message_id, true, messageThreadId),
      },
      logger,
    );
    return;
  }

  if (command === "/search" || command === "/lookup") {
    if (!isAdmin(message.from?.id)) {
      await recordAdminAction({
        adminTelegramId: message.from?.id ?? 0,
        adminUsername: message.from?.username ?? null,
        command,
        targetChatId: chatId,
        targetUsername: args[0] ?? null,
        denied: true,
      });
      await sendTelegramMessage(
        {
          chatId,
          text: buildAdminOnlyText(),
          ...buildReplyOptions(message.message_id, true, messageThreadId),
        },
        logger,
      );
      return;
    }
    await handleLookupCommand({
      chatId,
      rawUsername: args[0],
      viewerScope: "admin",
      inGroup: true,
      replyToMessageId: message.message_id,
      messageThreadId,
      disableNotification: true,
      logger,
    });
    return;
  }

  if (
    command === "/freeze" ||
    command === "/unfreeze" ||
    command === "/remove_entry" ||
    command === "/frozen_list" ||
    command === "/recover_entry" ||
    command === "/pause" ||
    command === "/unpause" ||
    command === "/admin_help" ||
    command === "/dbstats" ||
    command === "/mirrorstats" ||
    command === "/modstats"
  ) {
    await handleAdminCommand({
      command,
      args,
      chatId,
      replyToMessageId: message.message_id,
      messageThreadId,
      disableNotification: true,
      from: message.from,
      logger,
    });
    // Admin-only delete: a non-admin attempt hits the "admin only"
    // rejection reply, and we want their original message to stay so
    // that reply makes sense. Best-effort — a missing
    // can_delete_messages right or any 400 must not break the admin
    // action that already ran.
    if (isAdmin(message.from?.id)) {
      try {
        await deleteTelegramMessage(
          { chatId, messageId: message.message_id },
          logger,
        );
      } catch (error) {
        logger?.warn?.(
          { err: error, command, messageId: message.message_id },
          "[Group] failed to auto-delete admin command (non-fatal)",
        );
      }
    }
  }
}

async function handleMyChatMember(update: any, logger?: LoggerLike) {
  const chatId = update?.chat?.id;
  const oldStatus = update?.old_chat_member?.status;
  const newStatus = update?.new_chat_member?.status;
  if (typeof chatId !== "number" || typeof newStatus !== "string") {
    return;
  }

  if (shouldMarkChatKicked(newStatus)) {
    await setChatKicked(chatId);
    logger?.info?.({ chatId, newStatus }, "[Group] Bot lost access");
    return;
  }

  // Bot is now present (member/administrator). If the chat row is currently
  // in any disabled state (kicked / gone / migrated_away), flip it back to
  // 'active'.
  if (newStatus === "member" || newStatus === "administrator") {
    if (await isChatDisabled(chatId)) {
      await setChatActive(chatId);
      try {
        await recordAdminAction({
          adminTelegramId: 0,
          adminUsername: null,
          command: "system.chat_readded",
          targetChatId: chatId,
          denied: false,
        });
      } catch (err) {
        logger?.warn?.({ chatId, err }, "Failed to write chat-readded audit entry");
      }
      logger?.info?.(
        { chatId, oldStatus, newStatus },
        "[Group] Bot present in disabled chat; reset chat status to 'active'",
      );
    }
  }
}

async function handleChatMember(update: any, logger?: LoggerLike) {
  const chatId = update?.chat?.id;
  const oldStatus = update?.old_chat_member?.status;
  const newStatus = update?.new_chat_member?.status;
  if (typeof chatId !== "number") {
    return;
  }

  const transition = classifyChatMemberTransition(oldStatus, newStatus);
  if (transition === "ignore") {
    return;
  }

  const alert = recordMemberEvent(velocityState, {
    chatId,
    kind: transition,
    nowMs: Date.now(),
  });
  if (!alert) {
    return;
  }

  const text = buildVelocityAlertText(alert);
  const adminIds = [...getAdminIds()];
  let successes = 0;
  for (const adminId of adminIds) {
    try {
      await sendTelegramMessage({ chatId: adminId, text, parseMode: "HTML" }, logger);
      successes += 1;
    } catch (error) {
      logger?.warn?.(
        { adminId, chatId, error },
        "Failed to DM admin about member-velocity alert",
      );
    }
  }
  if (adminIds.length > 0 && successes === 0) {
    logger?.error?.(
      { chatId, adminCount: adminIds.length, kind: alert.kind, count: alert.count },
      "Member-velocity alert reached zero admins; check operator visibility",
    );
  }
  logger?.info?.(
    { chatId, kind: alert.kind, count: alert.count, adminsReached: successes },
    "[Group] Member-velocity alert fired",
  );
}

async function handleInlineQuery(inlineQuery: any, logger?: LoggerLike) {
  // Inline mode: any chat can type "@<bot> @username" to look up a member
  // without leaving the chat. Read-only, member-scope view (NEG counts /
  // existence are admin-only and never surfaced through the inline path).
  // Member rate-limited via the same token bucket as DM /search.
  const inlineQueryId = typeof inlineQuery?.id === "string" ? inlineQuery.id : null;
  if (!inlineQueryId) return;

  const fromId = inlineQuery.from?.id;
  const isAdminCaller = isAdmin(fromId);
  if (!isAdminCaller && typeof fromId === "number") {
    const limited = memberLookupLimiter.tryConsume(fromId);
    if (!limited.allowed) {
      // Rate-limited: return zero results so the dropdown stays empty
      // rather than showing stale data. cache_time=0 so the next attempt
      // (after the bucket refills) actually re-queries.
      await answerTelegramInlineQuery(
        { inlineQueryId, results: [], cacheTime: 0, isPersonal: true },
        logger,
      );
      return;
    }
  }

  const rawQuery = typeof inlineQuery.query === "string" ? inlineQuery.query.trim() : "";
  const targetUsername = normalizeUsername(rawQuery);
  if (!targetUsername) {
    // Empty / malformed query — return zero results. Telegram shows the
    // "no results" placeholder; cache briefly per-user so a member typing
    // doesn't burn DB queries on every keystroke.
    await answerTelegramInlineQuery(
      { inlineQueryId, results: [], cacheTime: 5, isPersonal: true },
      logger,
    );
    return;
  }

  // Reserved target (bot self / @telegram / @notoscam etc.) — short-circuit.
  // Build a single result so the user sees the explanation rather than an
  // empty dropdown. Counts are zero by construction.
  if (isReservedTarget(targetUsername)) {
    const result = buildInlineLookupResult({
      targetUsername,
      positive: 0,
      mixed: 0,
      total: 0,
      lastAt: null,
      isFrozen: false,
    });
    await answerTelegramInlineQuery(
      { inlineQueryId, results: [result], cacheTime: 60, isPersonal: true },
      logger,
    );
    return;
  }

  const [counts, profile] = await Promise.all([
    getArchiveCountsForTarget(targetUsername),
    getBusinessProfileByUsername(targetUsername),
  ]);
  // Member-scope: total = POS+MIX, NEG counts and existence stripped.
  const visibleTotal = counts.positive + counts.mixed;
  const result = buildInlineLookupResult({
    targetUsername,
    positive: counts.positive,
    mixed: counts.mixed,
    total: visibleTotal,
    lastAt: counts.lastAt,
    isFrozen: profile?.isFrozen ?? false,
  });
  await answerTelegramInlineQuery(
    {
      inlineQueryId,
      results: [result],
      // 60s cache balances responsiveness against unnecessary DB load.
      cacheTime: 60,
      isPersonal: true,
    },
    logger,
  );
  logger?.info?.(
    {
      targetUsername,
      visibleTotal,
      isFrozen: profile?.isFrozen ?? false,
      isAdminCaller,
    },
    "[Inline] query answered",
  );
}

async function handleCallbackQuery(callbackQuery: any, logger?: LoggerLike) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = typeof callbackQuery.data === "string" ? callbackQuery.data : "";

  // /search "See all" button — re-renders the lookup with mode="all".
  const expandUsername = parseLookupExpandCallback(data);
  if (expandUsername && typeof chatId === "number") {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery(
        { callbackQueryId: callbackQuery.id, chatId },
        logger,
      );
    }
    const fromId = callbackQuery.from?.id;
    const isAdminCaller = isAdmin(fromId);
    // Member rate-limiting: even the expand button consumes a slot
    // because it triggers a fresh DB read + send.
    if (!isAdminCaller && typeof fromId === "number") {
      const limited = memberLookupLimiter.tryConsume(fromId);
      if (!limited.allowed) {
        const seconds = Math.max(1, Math.ceil(limited.retryAfterMs / 1000));
        await sendTelegramMessage(
          { chatId, text: `Hold on — try again in ${seconds}s.` },
          logger,
        );
        return;
      }
    }
    await handleLookupCommand({
      chatId,
      rawUsername: expandUsername,
      viewerScope: isAdminCaller ? "admin" : "member",
      mode: "all",
      logger,
    });
    return;
  }

  // /search "See N NEG" button — admin-only. Re-renders with mode="neg",
  // showing only negative entries. Members can't trip this even if they
  // somehow get the callback_data string because we re-check admin here.
  const negUsername = parseLookupNegCallback(data);
  if (negUsername && typeof chatId === "number") {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery(
        { callbackQueryId: callbackQuery.id, chatId },
        logger,
      );
    }
    const fromId = callbackQuery.from?.id;
    if (!isAdmin(fromId)) {
      await sendTelegramMessage(
        { chatId, text: "<b>Admin only.</b>", parseMode: "HTML" },
        logger,
      );
      return;
    }
    await handleLookupCommand({
      chatId,
      rawUsername: negUsername,
      viewerScope: "admin",
      mode: "neg",
      logger,
    });
    return;
  }

  // /remove_entry confirm/cancel — admin-only destructive action.
  // The button payload carries the entry id; we re-check admin here so
  // a non-admin who somehow gets the callback_data string can't trip it.
  const removeConfirmId = parseRemoveEntryConfirmCallback(data);
  const removeCancelId = parseRemoveEntryCancelCallback(data);
  if ((removeConfirmId != null || removeCancelId != null) && typeof chatId === "number") {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery(
        { callbackQueryId: callbackQuery.id, chatId },
        logger,
      );
    }
    const fromId = callbackQuery.from?.id;
    if (!isAdmin(fromId)) {
      await sendTelegramMessage(
        { chatId, text: buildAdminOnlyText(), parseMode: "HTML" },
        logger,
      );
      return;
    }
    const entryId = (removeConfirmId ?? removeCancelId)!;
    if (removeCancelId != null) {
      await recordAdminAction({
        adminTelegramId: fromId ?? 0,
        adminUsername: callbackQuery.from?.username ?? null,
        command: "/remove_entry:cancel",
        targetChatId: chatId,
        entryId,
        denied: false,
      });
      await sendTelegramMessage(
        { chatId, text: `Entry #${entryId} — cancelled.` },
        logger,
      );
      return;
    }

    // Confirm path: re-fetch the entry to defend against a stale prompt
    // (e.g. someone already removed it in another session).
    const entry = await getArchiveEntryById(entryId);
    if (!entry || entry.status === "removed") {
      await sendTelegramMessage(
        { chatId, text: `Entry #${entryId} not found or already removed.` },
        logger,
      );
      return;
    }

    // Mark removed in DB FIRST so the source of truth flips before we
    // touch Telegram. If the Telegram delete fails the entry is still
    // treated as removed by /search.
    await markArchiveEntryRemoved(entryId);
    if (entry.publishedMessageId) {
      try {
        await deleteTelegramMessage(
          { chatId: entry.chatId, messageId: entry.publishedMessageId },
          logger,
        );
      } catch (error) {
        logger?.warn?.({ error, entryId }, "Failed to delete published entry");
      }
    }
    await recordAdminAction({
      adminTelegramId: fromId ?? 0,
      adminUsername: callbackQuery.from?.username ?? null,
      command: "/remove_entry",
      targetChatId: chatId,
      entryId,
      denied: false,
    });
    await sendTelegramMessage(
      { chatId, text: `Entry #${entryId} removed.` },
      logger,
    );
    return;
  }

  // Unknown callback — ack so the spinner clears, do nothing else.
  if (callbackQuery.id) {
    await answerTelegramCallbackQuery(
      { callbackQueryId: callbackQuery.id, chatId },
      logger,
    );
  }
}

export async function processTelegramUpdate(payload: any, logger: LoggerLike = console) {
  const sourceChat = payload.message?.chat ?? payload.callback_query?.message?.chat;
  const sourceChatId = sourceChat?.id;
  const sourceChatType = sourceChat?.type;

  if (
    sourceChatType !== "private" &&
    sourceChatId != null &&
    !allowedTelegramChatIds.has(sourceChatId)
  ) {
    logger.info({ sourceChatId }, "Ignoring Telegram update from chat outside allowlist");
    return { handled: false, ignored: true };
  }

  const updateId = Number.isSafeInteger(payload.update_id) ? payload.update_id : null;
  if (updateId != null) {
    const reservation = await reserveTelegramUpdate(updateId);
    if (!reservation.reserved) {
      logger.info({ updateId, status: reservation.status }, "Duplicate Telegram update ignored");
      return { handled: true, duplicate: true };
    }

    if (updateId % MAINTENANCE_EVERY_N_UPDATES === 0) {
      try {
        await runArchiveMaintenance();
      } catch (error) {
        logger.warn({ updateId, error }, "Archive maintenance failed");
      }
    }
  }

  // Record first-seen timestamp for the originating user. Fire-and-forget —
  // a DB hiccup here must not block webhook processing.
  const observedUserId = extractUpdateUserId(payload);
  if (observedUserId != null) {
    void recordUserFirstSeen(observedUserId).catch((error) => {
      logger.warn({ error, observedUserId }, "recordUserFirstSeen failed (non-fatal)");
    });
  }

  try {
    if (payload.callback_query) {
      await handleCallbackQuery(payload.callback_query, logger);
    } else if (payload.inline_query) {
      await handleInlineQuery(payload.inline_query, logger);
    } else if (payload.my_chat_member) {
      await handleMyChatMember(payload.my_chat_member, logger);
    } else if (payload.chat_member) {
      const chatMemberChatId = payload.chat_member?.chat?.id;
      if (
        typeof chatMemberChatId === "number" &&
        !allowedTelegramChatIds.has(chatMemberChatId)
      ) {
        logger.info(
          { chatId: chatMemberChatId },
          "Ignoring chat_member update from chat outside allowlist",
        );
      } else {
        await handleChatMember(payload.chat_member, logger);
      }
    } else if (payload.message?.chat?.type === "private") {
      await handlePrivateMessage(payload.message, logger);
    } else if (payload.message) {
      await handleGroupMessage(payload.message, logger);
    } else if (payload.chat_join_request) {
      // Capture which one-shot invite link was used. Best-effort: links
      // not minted by us no-op in recordInviteLinkUsed.
      const joinReq = payload.chat_join_request;
      const joinChatId = joinReq?.chat?.id;
      if (typeof joinChatId === "number" && allowedTelegramChatIds.has(joinChatId)) {
        const linkStr = joinReq?.invite_link?.invite_link;
        const fromId = joinReq?.from?.id;
        if (typeof linkStr === "string" && typeof fromId === "number") {
          try {
            await recordInviteLinkUsed(linkStr, fromId, logger);
            // Log fingerprint only — full link is takedown-vector material.
            logger.info(
              {
                chatId: joinChatId,
                fromId,
                linkSuffix: fingerprintInviteLink(linkStr),
              },
              "chat_join_request: invite-link usage recorded",
            );
          } catch (error) {
            logger.warn(
              { error, chatId: joinChatId, fromId },
              "chat_join_request: recordInviteLinkUsed failed",
            );
          }
        }
      }
    } else if (payload.edited_message) {
      // Edited messages in any allowed non-private chat go through the
      // same chat-moderation path as fresh messages. A clean message
      // edited into a dirty one should still be deleted.
      const edited = payload.edited_message;
      const editedChatType = edited.chat?.type;
      const editedChatId = edited.chat?.id;
      if (
        editedChatType !== "private" &&
        typeof editedChatId === "number" &&
        allowedTelegramChatIds.has(editedChatId)
      ) {
        const botId = await getTelegramBotId(logger);
        if (typeof botId === "number") {
          await runChatModeration({
            message: edited,
            isAdmin,
            botTelegramId: botId,
            logger,
          });
        }
      }
    } else {
      logger.info("Ignored unsupported Telegram update");
    }

    if (updateId != null) {
      await completeTelegramUpdate(updateId);
    }

    return {
      handled: Boolean(
        payload.callback_query ||
          payload.inline_query ||
          payload.message ||
          payload.my_chat_member ||
          payload.chat_member,
      ),
    };
  } catch (error) {
    if (error instanceof TelegramChatGoneError) {
      // Only treat as a "group gone" event when the offending chatId is in
      // the allowlist.
      if (
        error.chatId !== undefined &&
        !allowedTelegramChatIds.has(error.chatId)
      ) {
        logger.warn(
          { chatId: error.chatId, updateId },
          "TelegramChatGoneError for non-allowlisted chat; not paging admins",
        );
        if (updateId != null) {
          await releaseTelegramUpdate(updateId);
        }
        throw error;
      }
      try {
        await handleChatGone({
          chatId: error.chatId,
          adminTelegramIds: [...getAdminIds()],
          logger,
          deps: {
            setChatGone,
            sendDM: (input) =>
              sendTelegramMessage(
                { chatId: input.chatId, text: input.text, parseMode: "HTML" },
                logger,
              ),
            recordAudit: (entry) =>
              recordAdminAction({
                adminTelegramId: 0,
                adminUsername: null,
                command: entry.command,
                targetChatId: entry.targetChatId,
                denied: entry.denied,
              }),
          },
        });
        if (updateId != null) {
          await completeTelegramUpdate(updateId);
        }
        return { handled: true, chatGone: true };
      } catch (handlerError) {
        logger.error(
          { err: handlerError, chatId: error.chatId, updateId },
          "chat-gone handler failed; releasing update",
        );
        // Fall through to release + rethrow original chat-gone error so
        // Telegram can retry the inbound update once the DB recovers.
      }
    }

    if (updateId != null) {
      await releaseTelegramUpdate(updateId);
    }

    throw error;
  }
}
