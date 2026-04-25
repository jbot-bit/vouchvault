import {
  buildArchiveEntryText,
  isEntryResult,
  isEntrySource,
  isEntryType,
  parseSelectedTags,
  type EntryResult,
  type EntrySource,
  type EntryType,
} from "./archive.ts";
import {
  getArchiveEntryById,
  markArchiveEntryPublishing,
  setArchiveEntryPublishedMessageId,
  setArchiveEntryStatus,
} from "./archiveStore.ts";
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
};

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

export async function publishArchiveEntryRecord(entry: PublishableArchiveEntry, logger?: any) {
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

  let published;
  try {
    published = await sendTelegramMessage(
      {
        chatId: entry.chatId,
        text: buildArchiveEntryPostText(entry),
      },
      logger,
    );
  } catch (error) {
    if (isDeterministicTelegramApiFailure(error)) {
      await setArchiveEntryStatus(entry.id, "pending");
    }

    throw error;
  }

  try {
    await setArchiveEntryPublishedMessageId(entry.id, published.message_id);
  } catch (error) {
    throw new Error(
      `Telegram message ${published.message_id} was sent for archive entry #${entry.id}, but the database did not record it. Entry left in publishing state for manual recovery: ${error instanceof Error ? error.message : String(error)}`,
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
