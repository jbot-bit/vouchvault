import {
  buildAdminHelpText,
  buildAdminOnlyText,
  buildFrozenListText,
  buildGroupLauncherReplyText,
  buildLookupText,
  buildPreviewText,
  buildProfileText,
  buildPublishedDraftText,
  buildRecentEntriesText,
  buildResultPromptText,
  buildTagPromptText,
  buildTargetPromptText,
  buildWelcomeText,
  DEFAULT_DUPLICATE_COOLDOWN_HOURS,
  DEFAULT_DRAFT_TIMEOUT_HOURS,
  MAINTENANCE_EVERY_N_UPDATES,
  formatUsername,
  getAllowedTagsForResult,
  isEntryResult,
  normalizeUsername,
  parseSelectedTags,
  RESULT_LABELS,
  TAG_LABELS,
  toggleTag,
  MAX_LOOKUP_ENTRIES,
  MAX_RECENT_ENTRIES,
  type EntryResult,
  type EntrySource,
  type EntryTag,
} from "./core/archive.ts";
import { publishArchiveEntryRecord } from "./core/archivePublishing.ts";
import {
  getPrimaryGroupChatId,
  isAllowedGroupChatId,
  refreshGroupLauncher,
  sendLauncherPrompt,
} from "./core/archiveLauncher.ts";
import {
  clearDraftByReviewerTelegramId,
  completeTelegramUpdate,
  countRecentEntriesByReviewer,
  createArchiveEntry,
  createOrResetDraft,
  getArchiveEntriesForTarget,
  getArchiveEntryById,
  getBusinessProfileByUsername,
  getDraftByReviewerTelegramId,
  getOrCreateBusinessProfile,
  getRecentArchiveEntries,
  getProfileSummary,
  hasRecentEntryForReviewerAndTarget,
  listFrozenProfiles,
  markArchiveEntryRemoved,
  releaseTelegramUpdate,
  setArchiveEntryStatus,
  reserveTelegramUpdate,
  runArchiveMaintenance,
  setBusinessProfileFrozen,
  updateDraftByReviewerTelegramId,
  withReviewerDraftLock,
} from "./core/archiveStore.ts";
import {
  buildTargetRequestReplyMarkup,
  buildThreadedGroupReplyOptions,
  shouldSendThreadedLauncherReply,
  TARGET_USER_REQUEST_ID,
} from "./core/telegramUx.ts";
import { getAllowedTelegramChatIdSet } from "./core/telegramChatConfig.ts";
import { createOrUpdateUser } from "./core/tools/userTools.ts";
import {
  answerTelegramCallbackQuery,
  buildInlineKeyboard,
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramMessage,
} from "./core/tools/telegramTools.ts";
import {
  isChatPaused,
  setChatKicked,
  setChatMigrated,
  setChatPaused,
} from "./core/chatSettingsStore.ts";
import { recordAdminAction } from "./core/adminAuditStore.ts";
import { parseTypedTargetUsername } from "./telegramTargetInput.ts";

type LoggerLike = Pick<Console, "info" | "warn" | "error">;

const SERVICE_ENTRY_TYPE = "service";
const allowedTelegramChatIds = getAllowedTelegramChatIdSet();

function buildEntryDeepLink(chatId: number, messageId: number): string {
  // Telegram URL format: https://t.me/c/<chatPart>/<messageId>
  // Supergroup chat IDs are like -1001234567890; the chatPart drops the -100 prefix.
  const stringId = String(chatId);
  const chatPart = stringId.startsWith("-100")
    ? stringId.slice(4)
    : stringId.replace(/^-/, "");
  return `https://t.me/c/${chatPart}/${messageId}`;
}

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

function getStartPayload(text: string) {
  const { command, args } = getCommandParts(text);
  if (command !== "/start") {
    return null;
  }

  return args[0] ?? null;
}

function getTargetGroupChatIdFromStartPayload(payload: string | null): number | null {
  if (!payload) {
    return null;
  }

  if (!payload.startsWith("vouch_")) {
    return null;
  }

  const value = Number(payload.slice("vouch_".length));
  return Number.isSafeInteger(value) && isAllowedGroupChatId(value) ? value : null;
}

function isDraftExpired(draft: { updatedAt: Date }) {
  return Date.now() - draft.updatedAt.getTime() > DEFAULT_DRAFT_TIMEOUT_HOURS * 60 * 60 * 1000;
}

function buildStartKeyboard(targetGroupChatId?: number | null) {
  return buildInlineKeyboard([
    [
      {
        text: "Start a Vouch",
        callback_data:
          targetGroupChatId != null && isAllowedGroupChatId(targetGroupChatId)
            ? `archive:start:${targetGroupChatId}`
            : "archive:start",
      },
    ],
  ]);
}

function buildRestartKeyboard(targetGroupChatId?: number | null) {
  return buildInlineKeyboard([
    [
      {
        text: "Start Another Vouch",
        callback_data:
          targetGroupChatId != null && isAllowedGroupChatId(targetGroupChatId)
            ? `archive:start:${targetGroupChatId}`
            : "archive:start",
      },
    ],
  ]);
}

function buildResultKeyboard() {
  return buildInlineKeyboard([
    [{ text: RESULT_LABELS.positive, callback_data: "archive:result:positive" }],
    [{ text: RESULT_LABELS.mixed, callback_data: "archive:result:mixed" }],
    [{ text: RESULT_LABELS.negative, callback_data: "archive:result:negative" }],
    [{ text: "Cancel", callback_data: "archive:cancel" }],
  ]);
}

function buildTagKeyboard(result: EntryResult, selectedTags: EntryTag[]) {
  const tagRows = getAllowedTagsForResult(result).map((tag) => [
    {
      text: `${selectedTags.includes(tag) ? "✓ " : ""}${TAG_LABELS[tag]}`,
      callback_data: `archive:tag:${tag}`,
    },
  ]);

  return buildInlineKeyboard([
    ...tagRows,
    [{ text: "Done", callback_data: "archive:done" }],
    [{ text: "Cancel", callback_data: "archive:cancel" }],
  ]);
}

function buildPreviewKeyboard() {
  return buildInlineKeyboard([
    [{ text: "Publish", callback_data: "archive:confirm" }],
    [{ text: "Cancel", callback_data: "archive:cancel" }],
  ]);
}

function buildReplyOptions(replyToMessageId?: number | null, disableNotification = false) {
  if (replyToMessageId == null) {
    return disableNotification ? { disableNotification } : {};
  }

  return {
    ...buildThreadedGroupReplyOptions(replyToMessageId),
    disableNotification,
  };
}

async function sendGroupLauncherReply(input: {
  chatId: number;
  replyToMessageId: number;
  logger?: LoggerLike;
  text?: string;
}) {
  return sendLauncherPrompt(input.chatId, input.logger, {
    text: input.text ?? buildGroupLauncherReplyText(),
    ...buildThreadedGroupReplyOptions(input.replyToMessageId),
  });
}

async function startDraftFlow(input: {
  chatId: number;
  from: any;
  targetGroupChatId?: number | null;
  logger?: LoggerLike;
}) {
  const resolvedTargetGroupChatId =
    input.targetGroupChatId == null
      ? getPrimaryGroupChatId()
      : isAllowedGroupChatId(input.targetGroupChatId)
        ? input.targetGroupChatId
        : null;

  if (resolvedTargetGroupChatId == null) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "That launcher is no longer active. Open the current group launcher and try again.",
        replyMarkup: buildStartKeyboard(),
      },
      input.logger,
    );
    return;
  }

  if (await isChatPaused(resolvedTargetGroupChatId)) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Vouching is paused. An admin will lift this when ready. Use /recent to see the archive.",
      },
      input.logger,
    );
    return;
  }

  await withReviewerDraftLock(input.from.id, async () => {
    const reviewerUsername = input.from?.username ? normalizeUsername(input.from.username) : null;
    if (!reviewerUsername) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "You need a public Telegram @username to create a vouch entry.",
        },
        input.logger,
      );
      return;
    }

    await createOrUpdateUser(
      {
        telegramId: input.from.id,
        username: reviewerUsername,
        firstName: input.from.first_name ?? null,
        lastName: input.from.last_name ?? null,
      },
      input.logger,
    );

    await createOrResetDraft({
      reviewerTelegramId: input.from.id,
      reviewerUsername,
      reviewerFirstName: input.from.first_name ?? null,
      privateChatId: input.chatId,
      targetGroupChatId: resolvedTargetGroupChatId,
    });

    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildTargetPromptText(),
        replyMarkup: buildTargetRequestReplyMarkup(),
      },
      input.logger,
    );
  });
}

async function handleLookupCommand(input: {
  chatId: number;
  rawUsername: string | null | undefined;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: LoggerLike;
}) {
  const targetUsername = normalizeUsername(input.rawUsername ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Lookup requires /lookup @username.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  const entries = await getArchiveEntriesForTarget(targetUsername, MAX_LOOKUP_ENTRIES);
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildLookupText({
        targetUsername,
        entries: entries.map((entry) => ({
          id: entry.id,
          reviewerUsername: entry.reviewerUsername,
          result: entry.result as EntryResult,
          tags: parseSelectedTags(entry.selectedTags),
          createdAt: entry.createdAt,
          source: entry.source as EntrySource,
        })),
      }),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
}

async function handleProfileCommand(input: {
  chatId: number;
  rawUsername: string | null | undefined;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: LoggerLike;
}) {
  const targetUsername = normalizeUsername(input.rawUsername ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Use: /profile @username.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
  const summary = await getProfileSummary(targetUsername);
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildProfileText({ targetUsername, ...summary }),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
}

async function handleRecentCommand(input: {
  chatId: number;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: LoggerLike;
}) {
  const entries = await getRecentArchiveEntries(MAX_RECENT_ENTRIES);
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildRecentEntriesText(
        entries.map((entry) => ({
          id: entry.id,
          reviewerUsername: entry.reviewerUsername,
          targetUsername: entry.targetUsername,
          entryType: SERVICE_ENTRY_TYPE,
          result: entry.result as EntryResult,
          createdAt: entry.createdAt,
          source: entry.source as EntrySource,
        })),
      ),
      ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
    },
    input.logger,
  );
}

async function handleAdminCommand(input: {
  command: string;
  args: string[];
  chatId: number;
  replyToMessageId?: number | null;
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/freeze" || input.command === "/unfreeze") {
    const targetUsername = normalizeUsername(input.args[0] ?? "");
    if (!targetUsername) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Use: ${input.command} @username${input.command === "/freeze" ? " [reason]" : ""}.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }

    const reason = input.command === "/freeze" ? input.args.slice(1).join(" ") || null : null;
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/remove_entry") {
    const entryId = Number(input.args[0]);
    if (!Number.isInteger(entryId)) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "Send /remove_entry &lt;id&gt;",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }

    const entry = await getArchiveEntryById(entryId);
    if (!entry) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} not found.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }

    if (entry.publishedMessageId) {
      try {
        await deleteTelegramMessage(
          {
            chatId: entry.chatId,
            messageId: entry.publishedMessageId,
          },
          input.logger,
        );
      } catch (error) {
        input.logger?.warn("Failed to delete published entry", { error, entryId });
      }
    }

    await markArchiveEntryRemoved(entryId);
    await refreshGroupLauncher(entry.chatId, input.logger);
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
        text: `Entry #${entryId} removed.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/recover_entry") {
    const entryId = Number(input.args[0]);
    if (!Number.isInteger(entryId)) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "Use: /recover_entry &lt;id&gt;.",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }
    const entry = await getArchiveEntryById(entryId);
    if (!entry) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} not found.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }
    if (entry.status !== "publishing") {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Entry #${entryId} is in status="${entry.status}", no recovery needed.`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }
}

async function applySelectedTarget(input: {
  reviewerTelegramId: number;
  reviewerUsername: string;
  reviewerFirstName: string | null;
  chatId: number;
  draft: Awaited<ReturnType<typeof getDraftByReviewerTelegramId>>;
  targetUsername: string;
  logger?: LoggerLike;
}) {
  if (!input.draft) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Open the group launcher and start again.",
        replyMarkup: buildStartKeyboard(),
      },
      input.logger,
    );
    return;
  }

  if (input.targetUsername === input.reviewerUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Self-vouching is not allowed.",
        replyMarkup: buildTargetRequestReplyMarkup(),
      },
      input.logger,
    );
    return;
  }

  const businessProfile = await getOrCreateBusinessProfile(input.targetUsername);
  if (businessProfile.isFrozen) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `${formatUsername(input.targetUsername)} is currently frozen and cannot receive new archive entries.`,
        replyMarkup: buildTargetRequestReplyMarkup(),
      },
      input.logger,
    );
    return;
  }

  const duplicateExists = await hasRecentEntryForReviewerAndTarget({
    reviewerTelegramId: input.reviewerTelegramId,
    targetUsername: input.targetUsername,
    withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
  });

  if (duplicateExists) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "You already posted a recent archive entry for that target. Try again later.",
        replyMarkup: buildRestartKeyboard(input.draft.targetGroupChatId),
      },
      input.logger,
    );
    return;
  }

  const dailyCount = await countRecentEntriesByReviewer({
    reviewerTelegramId: input.reviewerTelegramId,
    withinHours: 24,
  });
  if (dailyCount >= 5) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Daily limit reached. Try again tomorrow.",
        replyMarkup: buildRestartKeyboard(input.draft.targetGroupChatId),
      },
      input.logger,
    );
    return;
  }

  await updateDraftByReviewerTelegramId(input.reviewerTelegramId, {
    reviewerUsername: input.reviewerUsername,
    reviewerFirstName: input.reviewerFirstName,
    targetUsername: input.targetUsername,
    entryType: SERVICE_ENTRY_TYPE,
    result: null,
    selectedTags: [],
    step: "selecting_result",
  });

  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildResultPromptText(input.targetUsername),
      replyMarkup: buildResultKeyboard(),
    },
    input.logger,
  );
}

async function handleSharedTargetSelection(message: any, logger?: LoggerLike) {
  const reviewerTelegramId = message.from?.id;
  const chatId = message.chat?.id;

  if (!reviewerTelegramId || !chatId) {
    return;
  }

  const usersShared = message.users_shared;
  if (!usersShared || usersShared.request_id !== TARGET_USER_REQUEST_ID) {
    return;
  }

  await withReviewerDraftLock(reviewerTelegramId, async () => {
    const draft = await getDraftByReviewerTelegramId(reviewerTelegramId);
    if (draft && isDraftExpired(draft)) {
      await clearDraftByReviewerTelegramId(reviewerTelegramId);
      await sendTelegramMessage(
        {
          chatId,
          text: "Your last draft expired. Start again.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    if (!draft) {
      await sendTelegramMessage(
        {
          chatId,
          text: "Open the group launcher and start again.",
          replyMarkup: buildStartKeyboard(),
        },
        logger,
      );
      return;
    }

    const sharedUser = Array.isArray(usersShared.users) ? usersShared.users[0] : null;
    const reviewerUsername = normalizeUsername(
      draft.reviewerUsername || message.from?.username || "",
    );
    if (!reviewerUsername) {
      await sendTelegramMessage(
        {
          chatId,
          text: "You need a public Telegram @username to create a vouch entry.",
        },
        logger,
      );
      return;
    }

    const targetUsername = normalizeUsername(sharedUser?.username ?? "");
    if (!targetUsername) {
      await sendTelegramMessage(
        {
          chatId,
          text: "The selected account needs a public @username. Choose another target.",
          replyMarkup: buildTargetRequestReplyMarkup(),
        },
        logger,
      );
      return;
    }

    await applySelectedTarget({
      reviewerTelegramId,
      reviewerUsername,
      reviewerFirstName: message.from?.first_name ?? null,
      chatId,
      draft,
      targetUsername,
      logger,
    });
  });
}

async function handlePrivateMessage(message: any, logger?: LoggerLike) {
  const chatId = message.chat.id;
  const text = typeof message.text === "string" ? message.text.trim() : "";

  if (message.users_shared) {
    await handleSharedTargetSelection(message, logger);
    return;
  }

  if (!text) {
    return;
  }

  if (text.startsWith("/")) {
    const { command, args } = getCommandParts(text);

    if (command === "/start") {
      const payload = getStartPayload(text);
      const targetGroupChatId = getTargetGroupChatIdFromStartPayload(payload);
      if (payload === "vouch" || targetGroupChatId != null) {
        await startDraftFlow({
          chatId,
          from: message.from,
          targetGroupChatId,
          logger,
        });
        return;
      }

      if (payload?.startsWith("vouch_")) {
        await sendTelegramMessage(
          {
            chatId,
            text: "That launcher is no longer active. Open the current group launcher and try again.",
            replyMarkup: buildStartKeyboard(),
          },
          logger,
        );
        return;
      }

      await sendTelegramMessage(
        {
          chatId,
          text: buildWelcomeText(),
          replyMarkup: buildStartKeyboard(),
        },
        logger,
      );
      return;
    }

    if (command === "/help") {
      await sendTelegramMessage(
        {
          chatId,
          text: buildWelcomeText(),
          replyMarkup: buildStartKeyboard(),
        },
        logger,
      );
      return;
    }

    if (command === "/cancel") {
      await withReviewerDraftLock(message.from.id, async () => {
        const draft = await getDraftByReviewerTelegramId(message.from.id);
        if (!draft) {
          await sendTelegramMessage(
            { chatId, text: "No active draft." },
            logger,
          );
          return;
        }
        await clearDraftByReviewerTelegramId(message.from.id);
        await sendTelegramMessage(
          {
            chatId,
            text: "Cancelled.",
            replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
          },
          logger,
        );
      });
      return;
    }

    if (command === "/vouch") {
      await startDraftFlow({
        chatId,
        from: message.from,
        logger,
      });
      return;
    }

    if (command === "/recent") {
      await handleRecentCommand({ chatId, logger });
      return;
    }

    if (command === "/lookup") {
      await handleLookupCommand({
        chatId,
        rawUsername: args[0],
        logger,
      });
      return;
    }

    if (command === "/profile") {
      await handleProfileCommand({ chatId, rawUsername: args[0], logger });
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
      command === "/admin_help"
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
  }

  await withReviewerDraftLock(message.from.id, async () => {
    const draft = await getDraftByReviewerTelegramId(message.from.id);
    if (draft && isDraftExpired(draft)) {
      await clearDraftByReviewerTelegramId(message.from.id);
      await sendTelegramMessage(
        {
          chatId,
          text: "Your last draft expired. Start again.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    if (!draft) {
      await sendTelegramMessage(
        {
          chatId,
          text: "Use the group launcher or /vouch to start.",
          replyMarkup: buildStartKeyboard(),
        },
        logger,
      );
      return;
    }

    if (draft.step === "awaiting_target") {
      const reviewerUsername = normalizeUsername(
        draft.reviewerUsername || message.from?.username || "",
      );
      if (!reviewerUsername) {
        await sendTelegramMessage(
          {
            chatId,
            text: "You need a public Telegram @username to create a vouch entry.",
          },
          logger,
        );
        return;
      }

      const parsedTarget = parseTypedTargetUsername(text);
      if (!parsedTarget.targetUsername) {
        await sendTelegramMessage(
          {
            chatId,
            text: `${parsedTarget.error} You can also tap Choose Target below.`,
            replyMarkup: buildTargetRequestReplyMarkup(),
          },
          logger,
        );
        return;
      }

      await applySelectedTarget({
        reviewerTelegramId: message.from.id,
        reviewerUsername,
        reviewerFirstName: message.from?.first_name ?? null,
        chatId,
        draft,
        targetUsername: parsedTarget.targetUsername,
        logger,
      });
      return;
    }

    await sendTelegramMessage(
      {
        chatId,
        text: "Use the buttons in your current draft, or send /vouch to restart.",
        replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
      },
      logger,
    );
  });
}

async function handleGroupMessage(message: any, logger?: LoggerLike) {
  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (!text.startsWith("/")) {
    return;
  }

  const { command, args } = getCommandParts(text);
  const chatId = message.chat.id;

  if (shouldSendThreadedLauncherReply(command)) {
    await sendGroupLauncherReply({
      chatId,
      replyToMessageId: message.message_id,
      logger,
    });
    return;
  }

  if (command === "/recent") {
    await handleRecentCommand({
      chatId,
      replyToMessageId: message.message_id,
      disableNotification: true,
      logger,
    });
    return;
  }

  if (command === "/lookup") {
    await handleLookupCommand({
      chatId,
      rawUsername: args[0],
      replyToMessageId: message.message_id,
      disableNotification: true,
      logger,
    });
    return;
  }

  if (command === "/profile") {
    if (!isAdmin(message.from?.id)) {
      await sendTelegramMessage(
        {
          chatId,
          text: buildAdminOnlyText(),
          ...buildReplyOptions(message.message_id, true),
        },
        logger,
      );
      return;
    }
    await handleProfileCommand({
      chatId,
      rawUsername: args[0],
      replyToMessageId: message.message_id,
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
    command === "/admin_help"
  ) {
    await handleAdminCommand({
      command,
      args,
      chatId,
      replyToMessageId: message.message_id,
      disableNotification: true,
      from: message.from,
      logger,
    });
  }
}

async function handleMyChatMember(update: any, logger?: LoggerLike) {
  const chatId = update?.chat?.id;
  const newStatus = update?.new_chat_member?.status;
  if (typeof chatId !== "number" || typeof newStatus !== "string") {
    return;
  }

  if (newStatus === "kicked" || newStatus === "left") {
    await setChatKicked(chatId);
    logger?.info?.("[Group] Bot lost access", { chatId, newStatus });
  }
}

async function handleCallbackQuery(callbackQuery: any, logger?: LoggerLike) {
  const data = typeof callbackQuery.data === "string" ? callbackQuery.data : "";
  const reviewerTelegramId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!data.startsWith("archive:") || !reviewerTelegramId || !chatId || !messageId) {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
    }
    return;
  }

  const parts = data.split(":");
  const action = parts[1];
  const value = parts[2];

  if (action === "start") {
    if (callbackQuery.message?.chat?.type !== "private") {
      await answerTelegramCallbackQuery(
        {
          callbackQueryId: callbackQuery.id,
          text: "Open the bot in DM to start.",
          showAlert: true,
        },
        logger,
      );
      return;
    }

    const requestedTargetGroupChatId = value ? Number(value) : null;
    if (
      value &&
      (!Number.isSafeInteger(requestedTargetGroupChatId) ||
        !isAllowedGroupChatId(requestedTargetGroupChatId))
    ) {
      await answerTelegramCallbackQuery(
        {
          callbackQueryId: callbackQuery.id,
          text: "That launcher is no longer active.",
          showAlert: true,
        },
        logger,
      );
      return;
    }

    await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
    await startDraftFlow({
      chatId,
      from: callbackQuery.from,
      targetGroupChatId: requestedTargetGroupChatId,
      logger,
    });
    return;
  }

  await withReviewerDraftLock(reviewerTelegramId, async () => {
    const draft = await getDraftByReviewerTelegramId(reviewerTelegramId);
    if (!draft) {
      await answerTelegramCallbackQuery(
        {
          callbackQueryId: callbackQuery.id,
          text: "Start again from the launcher.",
        },
        logger,
      );
      return;
    }

    if (isDraftExpired(draft)) {
      await clearDraftByReviewerTelegramId(reviewerTelegramId);
      await answerTelegramCallbackQuery(
        {
          callbackQueryId: callbackQuery.id,
          text: "Draft expired. Start again.",
          showAlert: true,
        },
        logger,
      );
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: "Draft expired. Start again.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    const targetUsername = draft.targetUsername;
    const result = isEntryResult(draft.result) ? draft.result : null;
    const selectedTags = parseSelectedTags(draft.selectedTags);

    if (action === "cancel") {
      await clearDraftByReviewerTelegramId(reviewerTelegramId);
      await answerTelegramCallbackQuery(
        { callbackQueryId: callbackQuery.id, text: "Cancelled." },
        logger,
      );
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: "Cancelled.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    if (action === "result") {
      if (!value || !isEntryResult(value) || !targetUsername) {
        await answerTelegramCallbackQuery(
          { callbackQueryId: callbackQuery.id, text: "Choose a target first." },
          logger,
        );
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        entryType: SERVICE_ENTRY_TYPE,
        result: value,
        selectedTags: [],
        step: "selecting_tags",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildTagPromptText(targetUsername, value, []),
          replyMarkup: buildTagKeyboard(value, []),
        },
        logger,
      );
      return;
    }

    if (action === "tag") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      const latestTargetUsername = latestDraft?.targetUsername ?? targetUsername;
      const latestResult =
        latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft
        ? parseSelectedTags(latestDraft.selectedTags)
        : selectedTags;

      if (
        !value ||
        !latestResult ||
        !latestTargetUsername ||
        !getAllowedTagsForResult(latestResult).includes(value as EntryTag)
      ) {
        await answerTelegramCallbackQuery(
          { callbackQueryId: callbackQuery.id, text: "Choose a result first." },
          logger,
        );
        return;
      }

      const nextTags = toggleTag(latestSelectedTags, value as EntryTag);
      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        selectedTags: nextTags,
        step: "selecting_tags",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildTagPromptText(latestTargetUsername, latestResult, nextTags),
          replyMarkup: buildTagKeyboard(latestResult, nextTags),
        },
        logger,
      );
      return;
    }

    if (action === "done") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      const latestTargetUsername = latestDraft?.targetUsername ?? targetUsername;
      const latestResult =
        latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft
        ? parseSelectedTags(latestDraft.selectedTags)
        : selectedTags;

      if (!latestTargetUsername || !latestResult || latestSelectedTags.length === 0) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "Select at least one tag.",
          },
          logger,
        );
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, { step: "preview" });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildPreviewText({
            reviewerUsername: draft.reviewerUsername || callbackQuery.from.username,
            targetUsername: latestTargetUsername,
            result: latestResult,
            tags: latestSelectedTags,
          }),
          replyMarkup: buildPreviewKeyboard(),
        },
        logger,
      );
      return;
    }

    if (action === "confirm") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      const latestTargetUsername = latestDraft?.targetUsername ?? targetUsername;
      const latestResult =
        latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft
        ? parseSelectedTags(latestDraft.selectedTags)
        : selectedTags;
      const latestTargetGroupChatId =
        latestDraft?.targetGroupChatId ?? draft.targetGroupChatId ?? null;

      if (!latestTargetUsername || !latestResult || latestSelectedTags.length === 0) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "Draft is incomplete.",
          },
          logger,
        );
        return;
      }

      if (latestTargetGroupChatId == null || !isAllowedGroupChatId(latestTargetGroupChatId)) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "This draft no longer points to an active group. Start again from the current launcher.",
            showAlert: true,
          },
          logger,
        );
        await editTelegramMessage(
          {
            chatId,
            messageId,
            text: "Start again from the current group launcher.",
            replyMarkup: buildRestartKeyboard(),
          },
          logger,
        );
        return;
      }

      const reviewerUsername = normalizeUsername(
        draft.reviewerUsername || callbackQuery.from?.username || "",
      );
      if (!reviewerUsername) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "You need a public @username.",
            showAlert: true,
          },
          logger,
        );
        return;
      }

      if (await isChatPaused(latestTargetGroupChatId)) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "Vouching is paused.",
            showAlert: true,
          },
          logger,
        );
        return;
      }

      const targetProfile = await getBusinessProfileByUsername(latestTargetUsername);
      if (targetProfile?.isFrozen) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "That target is currently frozen.",
          },
          logger,
        );
        return;
      }

      const duplicateExists = await hasRecentEntryForReviewerAndTarget({
        reviewerTelegramId,
        targetUsername: latestTargetUsername,
        withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
      });

      if (duplicateExists) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "A recent entry already exists for that target.",
          },
          logger,
        );
        return;
      }

      const reviewer = await createOrUpdateUser(
        {
          telegramId: reviewerTelegramId,
          username: reviewerUsername,
          firstName: callbackQuery.from?.first_name ?? null,
          lastName: callbackQuery.from?.last_name ?? null,
        },
        logger,
      );

      const businessProfile =
        targetProfile ?? (await getOrCreateBusinessProfile(latestTargetUsername));
      const createdEntry = await createArchiveEntry({
        reviewerUserId: reviewer.id,
        reviewerTelegramId,
        reviewerUsername,
        targetProfileId: businessProfile.id,
        targetUsername: latestTargetUsername,
        chatId: latestTargetGroupChatId,
        entryType: SERVICE_ENTRY_TYPE,
        result: latestResult,
        selectedTags: latestSelectedTags,
      });

      await publishArchiveEntryRecord(createdEntry, logger);

      try {
        await refreshGroupLauncher(latestTargetGroupChatId, logger);
      } catch (error) {
        logger?.warn("Failed to refresh launcher", { error, groupChatId: latestTargetGroupChatId });
      }

      try {
        await clearDraftByReviewerTelegramId(reviewerTelegramId);
      } catch (error) {
        logger?.warn("Failed to clear published draft", { error, reviewerTelegramId });
      }

      try {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
            text: "Posted.",
          },
          logger,
        );
      } catch (error) {
        logger?.warn("Failed to answer publish callback", {
          error,
          reviewerTelegramId,
          entryId: createdEntry.id,
        });
      }

      const publishedEntry = await getArchiveEntryById(createdEntry.id);
      const viewUrl = publishedEntry?.publishedMessageId
        ? buildEntryDeepLink(latestTargetGroupChatId, publishedEntry.publishedMessageId)
        : null;

      const confirmKeyboard = viewUrl
        ? buildInlineKeyboard([
            [{ text: "Start Another Vouch", callback_data: `archive:start:${latestTargetGroupChatId}` }],
            [{ text: "View this entry", url: viewUrl }],
          ])
        : buildRestartKeyboard(latestTargetGroupChatId);

      try {
        await editTelegramMessage(
          {
            chatId,
            messageId,
            text: buildPublishedDraftText(latestTargetUsername, latestResult),
            replyMarkup: confirmKeyboard,
          },
          logger,
        );
      } catch (error) {
        logger?.warn("Failed to edit published draft message", {
          error,
          reviewerTelegramId,
          entryId: createdEntry.id,
        });
      }
      return;
    }

    await answerTelegramCallbackQuery(
      {
        callbackQueryId: callbackQuery.id,
        text: "Unsupported action.",
      },
      logger,
    );
  });
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
    logger.info("Ignoring Telegram update from chat outside allowlist", { sourceChatId });
    return { handled: false, ignored: true };
  }

  const updateId = Number.isSafeInteger(payload.update_id) ? payload.update_id : null;
  if (updateId != null) {
    const reservation = await reserveTelegramUpdate(updateId);
    if (!reservation.reserved) {
      logger.info("Duplicate Telegram update ignored", { updateId, status: reservation.status });
      return { handled: true, duplicate: true };
    }

    if (updateId % MAINTENANCE_EVERY_N_UPDATES === 0) {
      try {
        await runArchiveMaintenance();
      } catch (error) {
        logger.warn("Archive maintenance failed", { updateId, error });
      }
    }
  }

  try {
    if (payload.callback_query) {
      await handleCallbackQuery(payload.callback_query, logger);
    } else if (payload.my_chat_member) {
      await handleMyChatMember(payload.my_chat_member, logger);
    } else if (payload.message?.chat?.type === "private") {
      await handlePrivateMessage(payload.message, logger);
    } else if (payload.message) {
      await handleGroupMessage(payload.message, logger);
    } else {
      logger.info("Ignored unsupported Telegram update");
    }

    if (updateId != null) {
      await completeTelegramUpdate(updateId);
    }

    return { handled: Boolean(payload.callback_query || payload.message) };
  } catch (error) {
    if (updateId != null) {
      await releaseTelegramUpdate(updateId);
    }

    throw error;
  }
}
