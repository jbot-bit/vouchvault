import {
  buildArchiveEntryText,
  escapeHtml,
  isEntryResult,
  isEntrySource,
  isEntryType,
  parseSelectedTags,
  shouldPublishToGroup,
  type EntryResult,
  type EntrySource,
  type EntryType,
} from "./archive.ts";
import {
  getArchiveEntryById,
  markArchiveEntryPublishing,
  setArchiveEntryChannelPublished,
  setArchiveEntryPublishedMessageId,
  setArchiveEntryStatus,
} from "./archiveStore.ts";
import { buildChannelPostBody } from "./relayPublish.ts";
import { sendTelegramMessage } from "./tools/telegramTools.ts";
import { TelegramApiError } from "./typedTelegramErrors.ts";

type PublishableArchiveEntry = {
  id: number;
  reviewerUsername: string;
  targetUsername: string;
  chatId: number;
  entryType: string;
  result: string;
  selectedTags: string;
  createdAt: Date;
  source?: string | null;
  legacySourceTimestamp?: Date | null;
  status?: string | null;
  publishedMessageId?: number | null;
  channelMessageId?: number | null;
  bodyText?: string | null;
};

// v6 §4 channel-relay configuration. When both env vars are set the
// publish path goes channel → auto-forward instead of direct supergroup
// send. Misconfiguration (relay enabled without a valid channel id)
// falls back to direct publish so the bot stays functional.
function resolveChannelRelay(): { enabled: boolean; channelId: number | null } {
  if (process.env.VV_RELAY_ENABLED !== "true") return { enabled: false, channelId: null };
  const raw = process.env.TELEGRAM_CHANNEL_ID?.trim();
  if (!raw) return { enabled: false, channelId: null };
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return { enabled: false, channelId: null };
  return { enabled: true, channelId: id };
}

function normalizePublishableEntry(entry: PublishableArchiveEntry): {
  entryType: EntryType;
  result: EntryResult;
  source: EntrySource;
} {
  if (!isEntryType(entry.entryType)) {
    throw new Error(`Archive entry #${entry.id} has unsupported entry type: ${entry.entryType}`);
  }

  if (!isEntryResult(entry.result)) {
    throw new Error(`Archive entry #${entry.id} has unsupported result: ${entry.result}`);
  }

  return {
    entryType: entry.entryType,
    result: entry.result,
    source: isEntrySource(entry.source) ? entry.source : "live",
  };
}

export function buildArchiveEntryPostText(entry: PublishableArchiveEntry): string {
  const normalized = normalizePublishableEntry(entry);

  return buildArchiveEntryText({
    entryId: entry.id,
    reviewerUsername: entry.reviewerUsername,
    targetUsername: entry.targetUsername,
    entryType: normalized.entryType,
    result: normalized.result,
    tags: parseSelectedTags(entry.selectedTags),
    createdAt: entry.createdAt,
    source: normalized.source,
    legacySourceTimestamp: entry.legacySourceTimestamp ?? null,
  });
}

function isDeterministicTelegramApiFailure(error: unknown): boolean {
  return error instanceof TelegramApiError;
}

export { shouldPublishToGroup } from "./archive.ts";

export type PublishResult =
  | { message_id: number; reused: boolean }
  | { message_id: null; reused: false; private: true };

export async function publishArchiveEntryRecord(
  entry: PublishableArchiveEntry,
  logger?: any,
): Promise<PublishResult> {
  const latestEntry = await getArchiveEntryById(entry.id);
  const currentEntry = latestEntry ?? entry;

  if (currentEntry.publishedMessageId != null) {
    return { message_id: currentEntry.publishedMessageId, reused: true };
  }

  if (currentEntry.status === "publishing") {
    throw new Error(
      `Archive entry #${entry.id} is already in publishing state. Check Telegram before retrying this replay step.`,
    );
  }

  if (currentEntry.status != null && currentEntry.status !== "pending") {
    throw new Error(
      `Archive entry #${entry.id} is not publishable from status "${currentEntry.status}".`,
    );
  }

  const reserved = await markArchiveEntryPublishing(entry.id);
  if (!reserved) {
    const refreshed = await getArchiveEntryById(entry.id);
    if (refreshed?.publishedMessageId != null) {
      return { message_id: refreshed.publishedMessageId, reused: true };
    }

    if (refreshed?.status === "publishing") {
      throw new Error(
        `Archive entry #${entry.id} is already in publishing state. Check Telegram before retrying this replay step.`,
      );
    }

    throw new Error(`Failed to reserve archive entry #${entry.id} for publishing.`);
  }

  const normalized = normalizePublishableEntry(entry);

  // Private NEG path: the row is reserved; transition to 'published' with no
  // Telegram message_id and skip the send. /search @x picks it up via the
  // Caution predicate without exposing a reportable feed artefact.
  if (!shouldPublishToGroup(normalized.result)) {
    const recorded = await setArchiveEntryStatus(entry.id, "published");
    if (recorded == null) {
      // Race with /remove_entry — the row's status was no longer 'publishing'
      // when we tried to flip to 'published'. Nothing to do; the remove won.
      return { message_id: null, reused: false, private: true };
    }
    return { message_id: null, reused: false, private: true };
  }

  // V3.5.4 channel-relay path — when enabled, publish to the channel
  // and let Telegram-native channel-discussion auto-forward into the
  // supergroup's General topic. The auto-forward observer in the
  // webhook (relayCapture) flips status='channel_published' →
  // 'published' and populates publishedMessageId with the supergroup
  // side id.
  const relay = resolveChannelRelay();
  if (relay.enabled && relay.channelId != null) {
    const body =
      typeof entry.bodyText === "string" && entry.bodyText.length > 0
        ? buildChannelPostBody({
            proseEscaped: escapeHtml(entry.bodyText),
            entryId: entry.id,
          })
        : buildArchiveEntryPostText(entry);

    let channelPublished;
    try {
      channelPublished = await sendTelegramMessage(
        {
          chatId: relay.channelId,
          text: body,
          protectContent: true,
        },
        logger,
      );
    } catch (error) {
      if (isDeterministicTelegramApiFailure(error)) {
        await setArchiveEntryStatus(entry.id, "pending");
      }
      throw error;
    }

    const channelMessageId = channelPublished.message_id;
    let recordedChannel;
    try {
      recordedChannel = await setArchiveEntryChannelPublished(entry.id, channelMessageId);
    } catch (error) {
      throw new Error(
        `Channel message ${channelMessageId} was sent for archive entry #${entry.id}, but the database did not record it. Entry left in publishing state for manual recovery: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (recordedChannel == null) {
      logger?.error?.(
        {
          entryId: entry.id,
          channelId: relay.channelId,
          orphanMessageId: channelMessageId,
        },
        "Channel publish raced with removal; channel message is orphaned. Delete manually.",
      );
    }
    // We return the channel-side message_id here. The supergroup-side
    // id is filled in asynchronously when relayCapture observes the
    // auto-forward.
    return { message_id: channelMessageId, reused: false };
  }

  let published;
  try {
    published = await sendTelegramMessage(
      {
        chatId: entry.chatId,
        text: buildArchiveEntryPostText(entry),
        protectContent: true,
      },
      logger,
    );
  } catch (error) {
    if (isDeterministicTelegramApiFailure(error)) {
      await setArchiveEntryStatus(entry.id, "pending");
    }

    throw error;
  }

  let recorded;
  try {
    recorded = await setArchiveEntryPublishedMessageId(entry.id, published.message_id);
  } catch (error) {
    throw new Error(
      `Telegram message ${published.message_id} was sent for archive entry #${entry.id}, but the database did not record it. Entry left in publishing state for manual recovery: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (recorded == null) {
    // The entry's status was no longer 'publishing' when we tried to mark
    // it 'published'. Typical cause: /remove_entry won a race against this
    // publish flow. The Telegram message we just sent is now an orphan —
    // log loudly so an operator can delete it manually (we don't auto-
    // delete here because the entry row is already 'removed' and we'd be
    // mutating state outside the publish flow's contract).
    logger?.error?.(
      {
        entryId: entry.id,
        chatId: entry.chatId,
        orphanMessageId: published.message_id,
      },
      "Publish raced with removal; Telegram message is orphaned in the chat. Delete manually.",
    );
  }

  return published;
}

export async function publishArchiveEntryById(entryId: number, logger?: any) {
  const entry = await getArchiveEntryById(entryId);
  if (!entry) {
    throw new Error(`Archive entry #${entryId} not found`);
  }

  return publishArchiveEntryRecord(entry, logger);
}
