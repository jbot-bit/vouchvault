import {
  buildAdminHelpText,
  buildAdminOnlyText,
  buildFrozenListText,
  buildLookupText,
  buildWelcomeText,
  MAINTENANCE_EVERY_N_UPDATES,
  FREEZE_REASONS,
  formatUsername,
  isFreezeReason,
  normalizeUsername,
  parseSelectedTags,
  MAX_LOOKUP_ENTRIES,
  type EntryResult,
  type EntrySource,
} from "./core/archive.ts";
import { runChatModeration } from "./core/chatModeration.ts";
import { resolveMirrorConfig, shouldMirror } from "./core/mirrorPublish.ts";
import { recordMirror, wasAlreadyMirrored } from "./core/mirrorStore.ts";
import { memberLookupLimiter } from "./core/lookupRateLimit.ts";
import { sharedSeenCache, statusIsActive } from "./core/sc45Members.ts";
import {
  removeMember as removeSc45Member,
  upsertMember as upsertSc45Member,
} from "./core/sc45MembersStore.ts";
import {
  runForgeryCheckOnEdit,
  runForgeryCheckOnMessage,
} from "./core/forgeryRunner.ts";
import {
  runChosenInlineResult,
  runInlineQuery,
} from "./core/inlineRunner.ts";
import { purgeForgeries, renderForgeriesPage } from "./core/forgeriesAdmin.ts";
import { fetchForgeriesPage } from "./core/forgeriesStore.ts";
import { getTelegramBotId } from "./core/tools/telegramTools.ts";
import {
  completeTelegramUpdate,
  getArchiveEntriesForTarget,
  getArchiveEntryById,
  getBusinessProfileByUsername,
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
  deleteTelegramMessage,
  editTelegramMessage,
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
import { recordInviteLinkUsed } from "./core/inviteLinks.ts";

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
        text: "Lookup requires /lookup @username.",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  const [entries, profile] = await Promise.all([
    getArchiveEntriesForTarget(targetUsername, MAX_LOOKUP_ENTRIES),
    getBusinessProfileByUsername(targetUsername),
  ]);
  const visibleEntries =
    input.viewerScope === "admin"
      ? entries
      : entries.filter((entry) => entry.result !== "negative");
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: buildLookupText({
        targetUsername,
        isFrozen: profile?.isFrozen ?? false,
        freezeReason: profile?.freezeReason ?? null,
        entries: visibleEntries.map((entry) => ({
          id: entry.id,
          reviewerUsername: entry.reviewerUsername,
          result: entry.result as EntryResult,
          tags: parseSelectedTags(entry.selectedTags),
          createdAt: entry.createdAt,
          source: entry.source as EntrySource,
          privateNote: input.viewerScope === "admin" ? entry.privateNote ?? null : null,
        })),
      }),
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

    // Mark removed in DB FIRST so the source of truth flips before we touch
    // Telegram. If the Telegram delete fails (or is interrupted), the entry
    // is still treated as removed by /lookup.
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
        input.logger?.warn?.({ error, entryId }, "Failed to delete published entry");
      }
    }

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

  if (input.command === "/forgeries") {
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      denied: false,
    });
    const page = Math.max(0, Number.parseInt(input.args[0] ?? "0", 10) || 0);
    const { rows, total, page: clampedPage } = await fetchForgeriesPage(page);
    const out = renderForgeriesPage({ rows, page: clampedPage, total });
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: out.text,
        parseMode: "HTML",
        replyMarkup: out.replyMarkup,
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }

  if (input.command === "/purge_forgeries") {
    const confirm = input.args[0] === "confirm";
    await recordAdminAction({
      adminTelegramId: input.from.id,
      adminUsername: input.from.username ?? null,
      command: input.command,
      targetChatId: input.chatId,
      reason: confirm ? "confirm" : "dry-run",
      denied: false,
    });
    const ourBotId = (await getTelegramBotId(input.logger)) ?? undefined;
    const result = await purgeForgeries({
      ourBotId,
      confirm,
      fetchBatch: async (offset, limit) =>
        fetchMirrorBatchForSweep(offset, limit),
      deleteMessage: async (chatId, messageId) => {
        try {
          await deleteTelegramMessage({ chatId, messageId }, input.logger);
        } catch (error) {
          input.logger?.warn?.({ chatId, messageId, error }, "[purge_forgeries] delete failed");
          throw error;
        }
      },
    });
    const summary = confirm
      ? `<b>Purge complete</b>\nscanned: ${result.scanned}\ndeleted: ${result.deleted}\nerrors: ${result.errors}`
      : `<b>Purge dry-run</b>\nscanned: ${result.scanned}\nwould delete: ${result.candidates}\nrun <code>/purge_forgeries confirm</code> to act.`;
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: summary,
        parseMode: "HTML",
        ...buildReplyOptions(input.replyToMessageId, input.disableNotification, input.messageThreadId),
      },
      input.logger,
    );
    return;
  }
}

async function fetchMirrorBatchForSweep(
  _offset: number,
  _limit: number,
): Promise<
  Array<{
    groupChatId: number;
    groupMessageId: number;
    viaBotId: number | null;
    text: string | null;
  }>
> {
  // mirror_log doesn't store the source text; the runtime detector already
  // catches new forgeries. v1 sweep returns empty so /purge_forgeries is a
  // safety mechanism for the day someone backfills text via a future
  // migration. When that lands, replace this with a real query.
  return [];
}

async function handlePrivateMessage(message: any, logger?: LoggerLike) {
  const chatId = message.chat.id;
  const text = typeof message.text === "string" ? message.text.trim() : "";

  if (!text || !text.startsWith("/")) {
    // v9: bot has no DM wizard. Any non-command DM gets the welcome
    // explainer so a member who messages the bot directly knows what
    // to do.
    if (text) {
      await sendTelegramMessage({ chatId, text: buildWelcomeText() }, logger);
    }
    return;
  }

  const { command, args } = getCommandParts(text);

  if (command === "/start" || command === "/help") {
    await sendTelegramMessage({ chatId, text: buildWelcomeText() }, logger);
    return;
  }

  if (command === "/lookup") {
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
    command === "/forgeries" ||
    command === "/purge_forgeries"
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
      viaBotId: typeof message?.via_bot?.id === "number" ? message.via_bot.id : null,
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

  // Inline-cards phase 1: forgery detector. Run BEFORE the mirror so a
  // forged card never lands in the backup channel. Detector short-
  // circuits when from.is_bot or no card-shape body, so this is cheap.
  if (!moderationDeleted) {
    try {
      const { enforced } = await runForgeryCheckOnMessage(message, botId ?? undefined, logger);
      if (enforced) return; // delete + audit handled inside; no further processing
    } catch (error) {
      logger?.warn?.({ error }, "[forgery] runner threw (non-fatal)");
    }
  }

  // Inline-cards phase 0: first-post auto-add to sc45_members registry.
  // LRU cache short-circuits the DB on hot users; cold users get one
  // upsert. Skip bot-authored messages and messages routed via_bot.
  const fromId = message?.from?.id;
  const isBotSender = message?.from?.is_bot === true;
  const hasViaBot = message?.via_bot != null;
  if (
    !moderationDeleted &&
    typeof fromId === "number" &&
    !isBotSender &&
    !hasViaBot &&
    !sharedSeenCache.recentlySeen(fromId)
  ) {
    try {
      await upsertSc45Member({ userId: fromId, status: "member" });
      sharedSeenCache.markSeen(fromId);
    } catch (error) {
      logger?.warn?.({ fromId, error }, "[Group] sc45_members first-post upsert failed");
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

  if (command === "/lookup") {
    // Inline-cards phase 2: members can run /lookup in-group (member
    // flavour — no admin-only NEGs / private_note). Admins still get
    // the full audit. Per-user inline-namespace rate limit applies to
    // member calls only.
    const callerId = message.from?.id;
    const isAdminCaller = isAdmin(callerId);
    if (!isAdminCaller) {
      if (typeof callerId === "number") {
        const rl = memberLookupLimiter.tryConsume(callerId, undefined, "inline");
        if (!rl.allowed) {
          const retrySec = Math.max(1, Math.round(rl.retryAfterMs / 1000));
          await sendTelegramMessage(
            {
              chatId,
              text: `Slow down a sec — try again in ${retrySec}s.`,
              ...buildReplyOptions(message.message_id, true, messageThreadId),
            },
            logger,
          );
          return;
        }
      }
    }
    await handleLookupCommand({
      chatId,
      rawUsername: args[0],
      viewerScope: isAdminCaller ? "admin" : "member",
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
    command === "/forgeries" ||
    command === "/purge_forgeries"
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

  // Inline-cards phase 0: SC45 member registry. Best-effort upsert/remove
  // based on the new status. Failures log but don't throw.
  const targetUserId = update?.new_chat_member?.user?.id;
  if (typeof targetUserId === "number" && typeof newStatus === "string") {
    try {
      if (statusIsActive(newStatus)) {
        await upsertSc45Member({ userId: targetUserId, status: newStatus });
        sharedSeenCache.markSeen(targetUserId);
      } else {
        await removeSc45Member(targetUserId);
      }
    } catch (error) {
      logger?.warn?.(
        { chatId, userId: targetUserId, newStatus, error },
        "[Group] sc45_members upsert/remove failed",
      );
    }
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
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = typeof callbackQuery.data === "string" ? callbackQuery.data : "";
  const fromId = callbackQuery.from?.id;

  // Inline-cards phase 3: /forgeries pagination.
  if (data.startsWith("vc:p:") && isAdmin(fromId) && typeof chatId === "number" && typeof messageId === "number") {
    const page = Math.max(0, Number.parseInt(data.slice("vc:p:".length), 10) || 0);
    try {
      const { rows, total, page: clampedPage } = await fetchForgeriesPage(page);
      const out = renderForgeriesPage({ rows, page: clampedPage, total });
      await editTelegramMessage(
        {
          chatId,
          messageId,
          text: out.text,
          parseMode: "HTML",
          replyMarkup: out.replyMarkup,
        },
        logger,
      );
    } catch (error) {
      logger?.warn?.({ error }, "[forgeries] callback re-render failed");
    }
    if (callbackQuery.id) {
      await answerTelegramCallbackQuery({ callbackQueryId: callbackQuery.id, chatId }, logger);
    }
    return;
  }

  // v9: no other callback surfaces from this bot. Ack to clear spinner.
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
            logger.info(
              { chatId: joinChatId, fromId, link: linkStr },
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
    } else if (payload.inline_query) {
      try {
        await runInlineQuery(payload.inline_query, logger);
      } catch (error) {
        logger.warn({ error }, "[inline] runInlineQuery threw (non-fatal)");
      }
    } else if (payload.chosen_inline_result) {
      try {
        await runChosenInlineResult(payload.chosen_inline_result, logger);
      } catch (error) {
        logger.warn({ error }, "[inline] runChosenInlineResult threw (non-fatal)");
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
        // Inline-cards phase 1: forgery edit-watcher.
        try {
          await runForgeryCheckOnEdit(edited, botId ?? undefined, logger);
        } catch (error) {
          logger?.warn?.({ error }, "[forgery] edit runner threw (non-fatal)");
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
          payload.chat_member ||
          payload.inline_query ||
          payload.chosen_inline_result,
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
