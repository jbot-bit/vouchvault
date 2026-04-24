import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  buildAdminOnlyText,
  buildGroupLauncherReplyText,
  buildLookupText,
  buildPreviewText,
  buildPublishedDraftText,
  buildRecentEntriesText,
  buildResultPromptText,
  buildTagPromptText,
  buildTargetPromptText,
  buildTypePromptText,
  buildWelcomeText,
  DEFAULT_DUPLICATE_COOLDOWN_HOURS,
  DEFAULT_DRAFT_TIMEOUT_HOURS,
  MAINTENANCE_EVERY_N_UPDATES,
  type EntryResult,
  type EntrySource,
  type EntryTag,
  type EntryType,
  formatUsername,
  getAllowedTagsForResult,
  isEntryResult,
  isEntryType,
  normalizeUsername,
  parseSelectedTags,
  RESULT_LABELS,
  TAG_LABELS,
  toggleTag,
  TYPE_LABELS,
  MAX_LOOKUP_ENTRIES,
  MAX_RECENT_ENTRIES,
} from "../archive";
import { publishArchiveEntryRecord } from "../archivePublishing";
import { getPrimaryGroupChatId, isAllowedGroupChatId, refreshGroupLauncher, sendLauncherMessage } from "../archiveLauncher";
import {
  clearDraftByReviewerTelegramId,
  completeTelegramUpdate,
  createArchiveEntry,
  createOrResetDraft,
  getArchiveEntriesForTarget,
  getArchiveEntryById,
  getBusinessProfileByUsername,
  getDraftByReviewerTelegramId,
  getOrCreateBusinessProfile,
  getRecentArchiveEntries,
  hasRecentEntryForReviewerAndTarget,
  markArchiveEntryRemoved,
  releaseTelegramUpdate,
  reserveTelegramUpdate,
  runArchiveMaintenance,
  setBusinessProfileFrozen,
  updateDraftByReviewerTelegramId,
  withReviewerDraftLock,
} from "../archiveStore";
import { buildTargetForceReplyMarkup, buildThreadedGroupReplyOptions, shouldSendThreadedLauncherReply } from "../telegramUx";
import { createOrUpdateUserTool } from "../tools/userTools";
import {
  answerTelegramCallbackQuery,
  buildInlineKeyboard,
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramMessage,
} from "../tools/telegramTools";

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
  const [rawCommand, ...args] = trimmed.split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();
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

  if (payload === "vouch") {
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
    [{
      text: "Start a Vouch",
      callback_data: targetGroupChatId != null && isAllowedGroupChatId(targetGroupChatId)
        ? `archive:start:${targetGroupChatId}`
        : "archive:start",
    }],
  ]);
}

function buildRestartKeyboard(targetGroupChatId?: number | null) {
  return buildInlineKeyboard([
    [{
      text: "Start Another Vouch",
      callback_data: targetGroupChatId != null && isAllowedGroupChatId(targetGroupChatId)
        ? `archive:start:${targetGroupChatId}`
        : "archive:start",
    }],
  ]);
}

function buildTypeKeyboard() {
  return buildInlineKeyboard([
    [{ text: TYPE_LABELS.service, callback_data: "archive:type:service" }],
    [{ text: TYPE_LABELS.item, callback_data: "archive:type:item" }],
    [{ text: TYPE_LABELS.product, callback_data: "archive:type:product" }],
    [{ text: "Cancel", callback_data: "archive:cancel" }],
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
  logger?: any;
  text?: string;
}) {
  return sendLauncherMessage(
    input.chatId,
    input.logger,
    {
      text: input.text ?? buildGroupLauncherReplyText(),
      ...buildThreadedGroupReplyOptions(input.replyToMessageId),
    },
  );
}

async function syncReviewerRecord(input: {
  reviewerTelegramId: number;
  reviewerUsername: string | null;
  reviewerFirstName: string | null;
  reviewerLastName: string | null;
  mastra: any;
}) {
  return createOrUpdateUserTool.execute({
    context: {
      telegramId: input.reviewerTelegramId,
      username: input.reviewerUsername,
      firstName: input.reviewerFirstName,
      lastName: input.reviewerLastName,
    },
    mastra: input.mastra,
    runtimeContext: undefined as any,
  });
}

async function startDraftFlow(input: {
  chatId: number;
  from: any;
  targetGroupChatId?: number | null;
  mastra: any;
}) {
  const logger = input.mastra?.getLogger();
  const resolvedTargetGroupChatId = input.targetGroupChatId == null
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
      logger,
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
        logger,
      );
      return;
    }

    await syncReviewerRecord({
      reviewerTelegramId: input.from.id,
      reviewerUsername,
      reviewerFirstName: input.from.first_name ?? null,
      reviewerLastName: input.from.last_name ?? null,
      mastra: input.mastra,
    });

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
        replyMarkup: buildTargetForceReplyMarkup(),
      },
      logger,
    );
  });
}

async function handleLookupCommand(input: {
  chatId: number;
  rawUsername: string | null | undefined;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: any;
}) {
  const targetUsername = normalizeUsername(input.rawUsername ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "Send /lookup @username",
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
          entryType: entry.entryType as EntryType,
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

async function handleRecentCommand(input: {
  chatId: number;
  replyToMessageId?: number | null;
  disableNotification?: boolean;
  logger?: any;
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
          entryType: entry.entryType as EntryType,
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
  mastra: any;
}) {
  const logger = input.mastra?.getLogger();

  if (!isAdmin(input.from?.id)) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: buildAdminOnlyText(),
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      logger,
    );
    return;
  }

  if (input.command === "/freeze" || input.command === "/unfreeze") {
    const targetUsername = normalizeUsername(input.args[0] ?? "");
    if (!targetUsername) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: `Send ${input.command} @username`,
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        logger,
      );
      return;
    }

    const updated = await setBusinessProfileFrozen(targetUsername, input.command === "/freeze");
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `${formatUsername(updated.username)} is now ${updated.isFrozen ? "frozen" : "active"}.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      logger,
    );
    return;
  }

  if (input.command === "/remove_entry") {
    const entryId = Number(input.args[0]);
    if (!Number.isInteger(entryId)) {
      await sendTelegramMessage(
        {
          chatId: input.chatId,
          text: "Send /remove_entry <id>",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        logger,
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
        logger,
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
          logger,
        );
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to delete published entry", { error, entryId });
      }
    }

    await markArchiveEntryRemoved(entryId);
    await refreshGroupLauncher(entry.chatId, logger);

    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Entry #${entryId} removed.`,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      logger,
    );
  }
}

async function handlePrivateMessage(message: any, mastra: any) {
  const logger = mastra?.getLogger();
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const chatId = message.chat.id;

  if (!text) {
    return;
  }

  if (text.startsWith("/")) {
    const { command, args } = getCommandParts(text);

    if (command === "/start") {
      const payload = getStartPayload(text);
      const targetGroupChatId = getTargetGroupChatIdFromStartPayload(payload);
      if (payload === "vouch") {
        await startDraftFlow({
          chatId,
          from: message.from,
          targetGroupChatId,
          mastra,
        });
        return;
      }

      if (targetGroupChatId != null) {
        await startDraftFlow({
          chatId,
          from: message.from,
          targetGroupChatId,
          mastra,
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

    if (command === "/vouch") {
      await startDraftFlow({
        chatId,
        from: message.from,
        mastra,
      });
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

    if (command === "/recent") {
      await handleRecentCommand({
        chatId,
        logger,
      });
      return;
    }

    if (command === "/freeze" || command === "/unfreeze" || command === "/remove_entry") {
      await handleAdminCommand({
        command,
        args,
        chatId,
        from: message.from,
        mastra,
      });
      return;
    }

    if (command === "/verify") {
      await sendTelegramMessage(
        {
          chatId,
          text: "Use the group launcher or /vouch to start.",
        },
        logger,
      );
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

    if (draft.step !== "awaiting_target") {
      await sendTelegramMessage(
        {
          chatId,
          text: "Use the buttons in your current draft, or send /vouch to restart.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    const reviewerUsername = normalizeUsername(message.from?.username ?? "");
    const targetUsername = normalizeUsername(text);

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

    if (!targetUsername) {
      await sendTelegramMessage(
        {
          chatId,
          text: "Send a valid @username.",
          replyMarkup: buildTargetForceReplyMarkup(),
        },
        logger,
      );
      return;
    }

    if (targetUsername === reviewerUsername) {
      await sendTelegramMessage(
        {
          chatId,
          text: "Self-vouching is not allowed.",
          replyMarkup: buildTargetForceReplyMarkup(),
        },
        logger,
      );
      return;
    }

    const businessProfile = await getOrCreateBusinessProfile(targetUsername);
    if (businessProfile.isFrozen) {
      await sendTelegramMessage(
        {
          chatId,
          text: `${formatUsername(targetUsername)} is currently frozen and cannot receive new archive entries.`,
          replyMarkup: buildTargetForceReplyMarkup(),
        },
        logger,
      );
      return;
    }

    const duplicateExists = await hasRecentEntryForReviewerAndTarget({
      reviewerTelegramId: message.from.id,
      targetUsername,
      withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
    });

    if (duplicateExists) {
      await sendTelegramMessage(
        {
          chatId,
          text: "You already posted a recent archive entry for that target. Try again later.",
          replyMarkup: buildRestartKeyboard(draft.targetGroupChatId),
        },
        logger,
      );
      return;
    }

    await updateDraftByReviewerTelegramId(message.from.id, {
      reviewerUsername,
      reviewerFirstName: message.from.first_name ?? null,
      targetUsername,
      entryType: null,
      result: null,
      selectedTags: [],
      step: "selecting_type",
    });

    await sendTelegramMessage(
      {
        chatId,
        text: buildTypePromptText(targetUsername),
        replyMarkup: buildTypeKeyboard(),
      },
      logger,
    );
  });
}

async function handleGroupMessage(message: any, mastra: any) {
  const logger = mastra?.getLogger();
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

  if (command === "/recent") {
    await handleRecentCommand({
      chatId,
      replyToMessageId: message.message_id,
      disableNotification: true,
      logger,
    });
    return;
  }

  if (command === "/freeze" || command === "/unfreeze" || command === "/remove_entry") {
    await handleAdminCommand({
      command,
      args,
      chatId,
      replyToMessageId: message.message_id,
      disableNotification: true,
      from: message.from,
      mastra,
    });
  }
}

async function handleCallbackQuery(callbackQuery: any, mastra: any) {
  const logger = mastra?.getLogger();
  const data = typeof callbackQuery.data === "string" ? callbackQuery.data : "";
  const reviewerTelegramId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!data.startsWith("archive:") || !reviewerTelegramId || !chatId || !messageId) {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery(
        {
          callbackQueryId: callbackQuery.id,
        },
        logger,
      );
    }
    return;
  }

  const parts = data.split(":");
  const action = parts[1];
  const value = parts[2];

  if (action === "start") {
    const callbackChatType = callbackQuery.message?.chat?.type;
    if (callbackChatType !== "private") {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackQuery.id,
        text: "Open the bot in DM to start.",
        showAlert: true,
      }, logger);
      return;
    }

    const requestedTargetGroupChatId = value ? Number(value) : null;
    if (value && (!Number.isSafeInteger(requestedTargetGroupChatId) || !isAllowedGroupChatId(requestedTargetGroupChatId))) {
      await answerTelegramCallbackQuery({
        callbackQueryId: callbackQuery.id,
        text: "That launcher is no longer active.",
        showAlert: true,
      }, logger);
      return;
    }

    await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
    await startDraftFlow({
      chatId,
      from: callbackQuery.from,
      targetGroupChatId: requestedTargetGroupChatId,
      mastra,
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
          showAlert: false,
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
    const entryType = isEntryType(draft.entryType) ? draft.entryType : null;
    const result = isEntryResult(draft.result) ? draft.result : null;
    const selectedTags = parseSelectedTags(draft.selectedTags);

    if (action === "cancel") {
      await clearDraftByReviewerTelegramId(reviewerTelegramId);
      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Cancelled." }, logger);
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

    if (action === "type") {
      if (!value || !isEntryType(value) || !targetUsername) {
        await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Draft is incomplete." }, logger);
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        entryType: value,
        result: null,
        selectedTags: [],
        step: "selecting_result",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildResultPromptText(targetUsername, value),
          replyMarkup: buildResultKeyboard(),
        },
        logger,
      );
      return;
    }

    if (action === "result") {
      if (!value || !isEntryResult(value) || !targetUsername || !entryType) {
        await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Choose a type first." }, logger);
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        result: value,
        selectedTags: [],
        step: "selecting_tags",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildTagPromptText(targetUsername, entryType, value, []),
          replyMarkup: buildTagKeyboard(value, []),
        },
        logger,
      );
      return;
    }

    if (action === "tag") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      const latestTargetUsername = latestDraft?.targetUsername ?? targetUsername;
      const latestEntryType = latestDraft && isEntryType(latestDraft.entryType) ? latestDraft.entryType : entryType;
      const latestResult = latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft ? parseSelectedTags(latestDraft.selectedTags) : selectedTags;

      if (!value || !latestResult || !latestEntryType || !latestTargetUsername || !getAllowedTagsForResult(latestResult).includes(value as EntryTag)) {
        await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Choose a result first." }, logger);
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
          text: buildTagPromptText(latestTargetUsername, latestEntryType, latestResult, nextTags),
          replyMarkup: buildTagKeyboard(latestResult, nextTags),
        },
        logger,
      );
      return;
    }

    if (action === "done") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      const latestTargetUsername = latestDraft?.targetUsername ?? targetUsername;
      const latestEntryType = latestDraft && isEntryType(latestDraft.entryType) ? latestDraft.entryType : entryType;
      const latestResult = latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft ? parseSelectedTags(latestDraft.selectedTags) : selectedTags;

      if (!latestTargetUsername || !latestEntryType || !latestResult || latestSelectedTags.length === 0) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "Select at least one tag.",
        }, logger);
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        step: "preview",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildPreviewText({
            reviewerUsername: draft.reviewerUsername || callbackQuery.from.username,
            targetUsername: latestTargetUsername,
            entryType: latestEntryType,
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
      const latestEntryType = latestDraft && isEntryType(latestDraft.entryType) ? latestDraft.entryType : entryType;
      const latestResult = latestDraft && isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = latestDraft ? parseSelectedTags(latestDraft.selectedTags) : selectedTags;
      const latestTargetGroupChatId = latestDraft?.targetGroupChatId ?? draft.targetGroupChatId ?? null;

      if (!latestTargetUsername || !latestEntryType || !latestResult || latestSelectedTags.length === 0) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "Draft is incomplete.",
        }, logger);
        return;
      }

      if (latestTargetGroupChatId == null || !isAllowedGroupChatId(latestTargetGroupChatId)) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "This draft no longer points to an active group. Start again from the current launcher.",
          showAlert: true,
        }, logger);
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

      const reviewerUsername = normalizeUsername(draft.reviewerUsername || callbackQuery.from?.username || "");
      if (!reviewerUsername) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "You need a public @username.",
          showAlert: true,
        }, logger);
        return;
      }

      const targetProfile = await getBusinessProfileByUsername(latestTargetUsername);
      if (targetProfile?.isFrozen) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "That target is currently frozen.",
        }, logger);
        return;
      }

      const duplicateExists = await hasRecentEntryForReviewerAndTarget({
        reviewerTelegramId,
        targetUsername: latestTargetUsername,
        withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
      });

      if (duplicateExists) {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "A recent entry already exists for that target.",
        }, logger);
        return;
      }

      const reviewer = await syncReviewerRecord({
        reviewerTelegramId,
        reviewerUsername,
        reviewerFirstName: callbackQuery.from?.first_name ?? null,
        reviewerLastName: callbackQuery.from?.last_name ?? null,
        mastra,
      });

      const businessProfile = targetProfile ?? await getOrCreateBusinessProfile(latestTargetUsername);
      const createdEntry = await createArchiveEntry({
        reviewerUserId: reviewer.id,
        reviewerTelegramId,
        reviewerUsername,
        targetProfileId: businessProfile.id,
        targetUsername: latestTargetUsername,
        chatId: latestTargetGroupChatId,
        entryType: latestEntryType,
        result: latestResult,
        selectedTags: latestSelectedTags,
      });

      try {
        await publishArchiveEntryRecord(createdEntry, logger);
      } catch (error) {
        throw error;
      }

      try {
        await refreshGroupLauncher(latestTargetGroupChatId, logger);
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to refresh launcher", { error, groupChatId: latestTargetGroupChatId });
      }

      try {
        await clearDraftByReviewerTelegramId(reviewerTelegramId);
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to clear published draft", { error, reviewerTelegramId });
      }

      try {
        await answerTelegramCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: "Posted.",
        }, logger);
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to answer publish callback", { error, reviewerTelegramId, entryId: createdEntry.id });
      }

      try {
        await editTelegramMessage(
          {
            chatId,
            messageId,
            text: buildPublishedDraftText(latestTargetUsername, latestResult),
            replyMarkup: buildRestartKeyboard(latestTargetGroupChatId),
          },
          logger,
        );
      } catch (error) {
        logger?.warn("⚠️ [Archive] Failed to edit published draft message", { error, reviewerTelegramId, entryId: createdEntry.id });
      }
      return;
    }

    await answerTelegramCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: "Unsupported action.",
    }, logger);
  });
}

const processTelegramUpdateStep = createStep({
  id: "process-telegram-update",
  description: "Processes Telegram messages and callback queries for the structured archive flow",
  inputSchema: z.object({
    telegramPayload: z.any().describe("Full Telegram webhook payload"),
    threadId: z.string().describe("Thread ID for conversation memory"),
  }),
  outputSchema: z.object({
    handled: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const payload = inputData.telegramPayload;
    const updateId = Number.isSafeInteger(payload.update_id) ? payload.update_id : null;

    logger?.info("🧭 [Archive Workflow] Processing Telegram update", {
      updateId,
      hasMessage: Boolean(payload.message),
      hasCallbackQuery: Boolean(payload.callback_query),
      hasPollAnswer: Boolean(payload.poll_answer),
    });

    if (updateId != null) {
      const reservation = await reserveTelegramUpdate(updateId);
      if (!reservation.reserved) {
        logger?.info("📝 [Archive Workflow] Duplicate Telegram update ignored", { updateId, status: reservation.status });
        return { handled: true };
      }

      if (updateId % MAINTENANCE_EVERY_N_UPDATES === 0) {
        try {
          await runArchiveMaintenance();
        } catch (error) {
          logger?.warn("⚠️ [Archive Workflow] Maintenance pass failed", { error, updateId });
        }
      }
    }

    try {
      if (payload.callback_query) {
        await handleCallbackQuery(payload.callback_query, mastra);
      } else if (payload.message?.chat?.type === "private") {
        await handlePrivateMessage(payload.message, mastra);
      } else if (payload.message) {
        await handleGroupMessage(payload.message, mastra);
      } else {
        logger?.info("📝 [Archive Workflow] Ignored unsupported Telegram update");
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
  },
});

export const reputationWorkflow = createWorkflow({
  id: "reputation-workflow",
  description: "Telegram vouch archive workflow",
  inputSchema: z.object({
    telegramPayload: z.any().describe("Full Telegram webhook payload"),
    threadId: z.string().describe("Thread ID for conversation memory"),
  }),
  outputSchema: z.object({
    handled: z.boolean(),
  }),
})
  .then(processTelegramUpdateStep)
  .commit();
