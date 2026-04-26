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
  FREEZE_REASONS,
  fmtDate,
  fmtDateTime,
  formatUsername,
  getAllowedTagsForResult,
  isEntryResult,
  isFreezeReason,
  isReservedTarget,
  MAX_PRIVATE_NOTE_CHARS,
  normalizeUsername,
  validatePrivateNote,
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
import { runChatModeration } from "./core/chatModeration.ts";
import { getTelegramBotId } from "./core/tools/telegramTools.ts";
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
  isChatDisabled,
  isChatPaused,
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
import { parseTypedTargetUsername } from "./telegramTargetInput.ts";

type LoggerLike = Pick<Console, "info" | "warn" | "error">;

const SERVICE_ENTRY_TYPE = "service";
const allowedTelegramChatIds = getAllowedTelegramChatIdSet();

// Per takedown spec §3.4. In-memory; resets on deploy. The alert is a
// heuristic; a fresh window after redeploy is acceptable.
const velocityState = createMemberVelocityState();

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

function buildAdminNoteKeyboard() {
  return buildInlineKeyboard([
    [{ text: "Skip", callback_data: "archive:skip_admin_note" }],
    [{ text: "Cancel", callback_data: "archive:cancel" }],
  ]);
}

function buildAdminNotePromptText(): string {
  return [
    "<b>Optional: add a short note for admins</b>",
    "",
    `Up to ${MAX_PRIVATE_NOTE_CHARS} characters. Send the note text here, or tap <b>Skip</b>.`,
    "",
    "<i>This note is visible to admins only. It is never published to the group.</i>",
  ].join("\n");
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

  const [entries, profile] = await Promise.all([
    getArchiveEntriesForTarget(targetUsername, MAX_LOOKUP_ENTRIES),
    getBusinessProfileByUsername(targetUsername),
  ]);
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildLookupText({
        targetUsername,
        isFrozen: profile?.isFrozen ?? false,
        freezeReason: profile?.freezeReason ?? null,
        entries: entries.map((entry) => ({
          id: entry.id,
          reviewerUsername: entry.reviewerUsername,
          result: entry.result as EntryResult,
          tags: parseSelectedTags(entry.selectedTags),
          createdAt: entry.createdAt,
          source: entry.source as EntrySource,
          privateNote: entry.privateNote ?? null,
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
      text: buildProfileText({
        targetUsername,
        ...summary,
        hasCaution: summary.totals.negative > 0,
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
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
            ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/remove_entry") {
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
          text: "Send /remove_entry &lt;id&gt;",
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
        },
        input.logger,
      );
      return;
    }

    // Mark removed in DB FIRST so the source of truth flips before we touch
    // Telegram. If the Telegram delete fails (or is interrupted), the entry
    // is still treated as removed by /lookup, /profile, and /recent. The
    // alternative ordering (delete from Telegram first, then DB) leaves a
    // ghost entry visible in DB-driven views when the DB write fails after
    // the message is already gone.
    await markArchiveEntryRemoved(entryId);

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
        input.logger?.warn({ error, entryId }, "Failed to delete published entry");
      }
    }

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
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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
          ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
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

  if (isReservedTarget(input.targetUsername)) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: "That handle can't be a vouch subject.",
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

  const lastVouchedAt = await hasRecentEntryForReviewerAndTarget({
    reviewerTelegramId: input.reviewerTelegramId,
    targetUsername: input.targetUsername,
    withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
  });

  if (lastVouchedAt) {
    const cooldownEnd = new Date(
      lastVouchedAt.getTime() + DEFAULT_DUPLICATE_COOLDOWN_HOURS * 60 * 60 * 1000,
    );
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `You vouched <b>${formatUsername(input.targetUsername)}</b> on ${fmtDate(lastVouchedAt)}.\nCooldown ends ${fmtDate(cooldownEnd)}.`,
        replyMarkup: buildRestartKeyboard(input.draft.targetGroupChatId),
      },
      input.logger,
    );
    return;
  }

  const daily = await countRecentEntriesByReviewer({
    reviewerTelegramId: input.reviewerTelegramId,
    withinHours: 24,
  });
  if (daily.count >= 5 && daily.oldestInWindow) {
    const resetAt = new Date(daily.oldestInWindow.getTime() + 24 * 60 * 60 * 1000);
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `Daily limit reached. Try again after ${fmtDateTime(resetAt)}.`,
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

    if (draft.step === "awaiting_admin_note") {
      const validation = validatePrivateNote(text);
      if (!validation.ok) {
        const reason =
          validation.reason === "too_long"
            ? `Note too long. Keep it under ${MAX_PRIVATE_NOTE_CHARS} characters.`
            : validation.reason === "control_chars"
              ? "Note contains characters that aren't allowed."
              : "Note is empty. Send the note text or tap Skip.";
        await sendTelegramMessage(
          { chatId, text: reason, replyMarkup: buildAdminNoteKeyboard() },
          logger,
        );
        return;
      }
      const latestTargetUsername = draft.targetUsername;
      const latestResult = isEntryResult(draft.result) ? draft.result : null;
      const latestSelectedTags = parseSelectedTags(draft.selectedTags);
      if (!latestTargetUsername || !latestResult || latestSelectedTags.length === 0) {
        await sendTelegramMessage(
          { chatId, text: "Draft is incomplete. Use /vouch to restart." },
          logger,
        );
        return;
      }
      await updateDraftByReviewerTelegramId(message.from.id, {
        step: "preview",
        privateNote: validation.value,
      });
      await sendTelegramMessage(
        {
          chatId,
          text: buildPreviewText({
            reviewerUsername:
              draft.reviewerUsername || message.from?.username || "",
            targetUsername: latestTargetUsername,
            result: latestResult,
            tags: latestSelectedTags,
            privateNote: validation.value,
          }),
          replyMarkup: buildPreviewKeyboard(),
        },
        logger,
      );
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
  if (typeof botId === "number") {
    const mod = await runChatModeration({
      message,
      isAdmin,
      botTelegramId: botId,
      logger,
    });
    if (mod.deleted) return;
  }

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
          ...buildReplyOptions(message.message_id, true),
        },
        logger,
      );
      return;
    }
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
    // Open to all members in the host group — /profile is the read path for
    // the Caution status (private NEGs aren't published, so this is how the
    // community signal flows). Audit row recorded non-denied for soft
    // visibility on who is checking whom.
    await recordAdminAction({
      adminTelegramId: message.from?.id ?? 0,
      adminUsername: message.from?.username ?? null,
      command,
      targetChatId: chatId,
      targetUsername: args[0] ?? null,
      denied: false,
    });
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
  // 'active'. This deliberately ignores oldStatus — Telegram's
  // my_chat_member events don't always carry a clean kicked→member
  // transition (e.g. when a chat marked 'gone' from a transient API quirk
  // resolves, the next event may show oldStatus='member' already), and
  // staying disabled in that case would leave the bot silently dead in a
  // working chat.
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

async function handleCallbackQuery(callbackQuery: any, logger?: LoggerLike) {
  const data = typeof callbackQuery.data === "string" ? callbackQuery.data : "";
  const reviewerTelegramId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!data.startsWith("archive:") || !reviewerTelegramId || !chatId || !messageId) {
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
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
          chatId,
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
          chatId,
          text: "That launcher is no longer active.",
          showAlert: true,
        },
        logger,
      );
      return;
    }

    await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
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
          chatId,
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
          chatId,
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
        { callbackQueryId: callbackQuery.id,
          chatId, text: "Cancelled." },
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
          { callbackQueryId: callbackQuery.id,
          chatId, text: "Choose a target first." },
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

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
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
          { callbackQueryId: callbackQuery.id,
          chatId, text: "Choose a result first." },
          logger,
        );
        return;
      }

      const nextTags = toggleTag(latestSelectedTags, value as EntryTag);
      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        selectedTags: nextTags,
        step: "selecting_tags",
      });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
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
          chatId,
            text: "Select at least one tag.",
          },
          logger,
        );
        return;
      }

      // NEG drafts get an extra step: an optional admin-only note before
      // preview. POS/MIX skip straight to preview as today.
      if (latestResult === "negative") {
        await updateDraftByReviewerTelegramId(reviewerTelegramId, {
          step: "awaiting_admin_note",
          privateNote: null,
        });

        await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
        await editTelegramMessage(
          {
            chatId,
            messageId,
            text: buildAdminNotePromptText(),
            replyMarkup: buildAdminNoteKeyboard(),
          },
          logger,
        );
        return;
      }

      await updateDraftByReviewerTelegramId(reviewerTelegramId, { step: "preview" });

      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
      // POS/MIX path — no privateNote (validator and DB constraint both
      // forbid notes on non-NEG entries).
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

    if (action === "skip_admin_note") {
      const latestDraft = await getDraftByReviewerTelegramId(reviewerTelegramId);
      if (!latestDraft || latestDraft.step !== "awaiting_admin_note") {
        await answerTelegramCallbackQuery(
          { callbackQueryId: callbackQuery.id, chatId, text: "Not at the note step." },
          logger,
        );
        return;
      }
      const latestTargetUsername = latestDraft.targetUsername ?? targetUsername;
      const latestResult =
        isEntryResult(latestDraft.result) ? latestDraft.result : result;
      const latestSelectedTags = parseSelectedTags(latestDraft.selectedTags);
      if (!latestTargetUsername || !latestResult || latestSelectedTags.length === 0) {
        await answerTelegramCallbackQuery(
          { callbackQueryId: callbackQuery.id, chatId, text: "Draft is incomplete." },
          logger,
        );
        return;
      }
      await updateDraftByReviewerTelegramId(reviewerTelegramId, {
        step: "preview",
        privateNote: null,
      });
      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: buildPreviewText({
            reviewerUsername: draft.reviewerUsername || callbackQuery.from.username,
            targetUsername: latestTargetUsername,
            result: latestResult,
            tags: latestSelectedTags,
            privateNote:
              latestResult === "negative" ? (latestDraft?.privateNote ?? null) : null,
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
          chatId,
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
          chatId,
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
          chatId,
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
          chatId,
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
          chatId,
            text: "That target is currently frozen.",
          },
          logger,
        );
        return;
      }

      const recentEntryAt = await hasRecentEntryForReviewerAndTarget({
        reviewerTelegramId,
        targetUsername: latestTargetUsername,
        withinHours: DEFAULT_DUPLICATE_COOLDOWN_HOURS,
      });

      if (recentEntryAt) {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
          chatId,
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
        privateNote: latestResult === "negative" ? (latestDraft?.privateNote ?? null) : null,
      });

      await publishArchiveEntryRecord(createdEntry, logger);

      try {
        await refreshGroupLauncher(latestTargetGroupChatId, logger);
      } catch (error) {
        // Rethrow chat-gone so processTelegramUpdate's outer catch can route
        // to handleChatGone. Swallowing it here would leave the chat
        // permanently un-flagged and we'd silently log "Failed to refresh
        // launcher" forever.
        if (error instanceof TelegramChatGoneError) throw error;
        logger?.warn?.(
          { error, groupChatId: latestTargetGroupChatId },
          "Failed to refresh launcher",
        );
      }

      try {
        await clearDraftByReviewerTelegramId(reviewerTelegramId);
      } catch (error) {
        logger?.warn({ error, reviewerTelegramId }, "Failed to clear published draft");
      }

      const isPrivateNeg = latestResult === "negative";

      try {
        await answerTelegramCallbackQuery(
          {
            callbackQueryId: callbackQuery.id,
          chatId,
            text: isPrivateNeg ? "Recorded." : "Posted.",
          },
          logger,
        );
      } catch (error) {
        logger?.warn(
          { error, reviewerTelegramId, entryId: createdEntry.id },
          "Failed to answer publish callback",
        );
      }

      const publishedEntry = await getArchiveEntryById(createdEntry.id);
      const viewUrl =
        !isPrivateNeg && publishedEntry?.publishedMessageId
          ? buildEntryDeepLink(latestTargetGroupChatId, publishedEntry.publishedMessageId)
          : null;

      const confirmKeyboard = viewUrl
        ? buildInlineKeyboard([
            [{ text: "Start Another Vouch", callback_data: `archive:start:${latestTargetGroupChatId}` }],
            [{ text: "View this entry", url: viewUrl }],
          ])
        : buildRestartKeyboard(latestTargetGroupChatId);

      const confirmText = isPrivateNeg
        ? [
            "<b>✓ Concern recorded</b>",
            "",
            `Your concern about ${formatUsername(latestTargetUsername)} has been recorded as <code>#${createdEntry.id}</code>.`,
            "Admins will see it; the wider group will not.",
          ].join("\n")
        : buildPublishedDraftText(latestTargetUsername, latestResult);

      try {
        await editTelegramMessage(
          {
            chatId,
            messageId,
            text: confirmText,
            replyMarkup: confirmKeyboard,
          },
          logger,
        );
      } catch (error) {
        logger?.warn(
          { error, reviewerTelegramId, entryId: createdEntry.id },
          "Failed to edit published draft message",
        );
      }
      return;
    }

    await answerTelegramCallbackQuery(
      {
        callbackQueryId: callbackQuery.id,
          chatId,
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

  try {
    if (payload.callback_query) {
      await handleCallbackQuery(payload.callback_query, logger);
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
          payload.message ||
          payload.my_chat_member ||
          payload.chat_member,
      ),
    };
  } catch (error) {
    if (error instanceof TelegramChatGoneError) {
      // Only treat as a "group gone" event when the offending chatId is in
      // the allowlist. answerCallbackQuery now threads chatId from DM
      // callbacks too (positive user-id, not a group id); a 'chat not found'
      // 400 against a deleted user account would otherwise be misclassified
      // as a takedown of a non-existent group.
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
