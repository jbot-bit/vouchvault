import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { businessProfiles, chatLaunchers, processedTelegramUpdates, vouchDrafts, vouchEntries } from "./storage/schema.ts";
import {
  DEFAULT_DRAFT_TIMEOUT_HOURS,
  PROCESSED_UPDATE_RETENTION_DAYS,
  STALE_UPDATE_PROCESSING_MINUTES,
  type DraftStep,
  type EntryResult,
  type EntrySource,
  type EntryTag,
  type EntryType,
  serializeSelectedTags,
} from "./archive.ts";

const REVIEWER_DRAFT_LOCK_OFFSET = -9_000_000_000_000_000;

export async function getBusinessProfileByUsername(username: string) {
  const result = await db
    .select()
    .from(businessProfiles)
    .where(eq(businessProfiles.username, username))
    .limit(1);

  return result[0] ?? null;
}

export async function getOrCreateBusinessProfile(username: string) {
  const existing = await getBusinessProfileByUsername(username);
  if (existing) {
    return existing;
  }

  try {
    const [created] = await db
      .insert(businessProfiles)
      .values({
        username,
        isFrozen: false,
        updatedAt: new Date(),
      })
      .returning();

    return created;
  } catch {
    const retried = await getBusinessProfileByUsername(username);
    if (retried) {
      return retried;
    }

    throw new Error(`Failed to create business profile for ${username}`);
  }
}

export async function setBusinessProfileFrozen(username: string, isFrozen: boolean) {
  const profile = await getOrCreateBusinessProfile(username);

  const [updated] = await db
    .update(businessProfiles)
    .set({
      isFrozen,
      updatedAt: new Date(),
    })
    .where(eq(businessProfiles.id, profile.id))
    .returning();

  return updated;
}

export async function getDraftByReviewerTelegramId(reviewerTelegramId: number) {
  const result = await db
    .select()
    .from(vouchDrafts)
    .where(eq(vouchDrafts.reviewerTelegramId, reviewerTelegramId))
    .limit(1);

  return result[0] ?? null;
}

export async function createOrResetDraft(input: {
  reviewerTelegramId: number;
  reviewerUsername: string | null;
  reviewerFirstName: string | null;
  privateChatId: number;
  targetGroupChatId: number | null;
}) {
  const existing = await getDraftByReviewerTelegramId(input.reviewerTelegramId);

  if (existing) {
    const [updated] = await db
      .update(vouchDrafts)
      .set({
        reviewerUsername: input.reviewerUsername,
        reviewerFirstName: input.reviewerFirstName,
        privateChatId: input.privateChatId,
        targetGroupChatId: input.targetGroupChatId,
        targetUsername: null,
        entryType: null,
        result: null,
        selectedTags: "[]",
        step: "awaiting_target",
        updatedAt: new Date(),
      })
      .where(eq(vouchDrafts.id, existing.id))
      .returning();

    return updated;
  }

  try {
    const [created] = await db
      .insert(vouchDrafts)
      .values({
        reviewerTelegramId: input.reviewerTelegramId,
        reviewerUsername: input.reviewerUsername,
        reviewerFirstName: input.reviewerFirstName,
        privateChatId: input.privateChatId,
        targetGroupChatId: input.targetGroupChatId,
        targetUsername: null,
        entryType: null,
        result: null,
        selectedTags: "[]",
        step: "awaiting_target",
        updatedAt: new Date(),
      })
      .returning();

    return created;
  } catch {
    const retried = await getDraftByReviewerTelegramId(input.reviewerTelegramId);
    if (!retried) {
      throw new Error(`Failed to create draft for reviewer ${input.reviewerTelegramId}`);
    }

    const [updated] = await db
      .update(vouchDrafts)
      .set({
        reviewerUsername: input.reviewerUsername,
        reviewerFirstName: input.reviewerFirstName,
        privateChatId: input.privateChatId,
        targetGroupChatId: input.targetGroupChatId,
        targetUsername: null,
        entryType: null,
        result: null,
        selectedTags: "[]",
        step: "awaiting_target",
        updatedAt: new Date(),
      })
      .where(eq(vouchDrafts.id, retried.id))
      .returning();

    return updated;
  }
}

export async function updateDraftByReviewerTelegramId(
  reviewerTelegramId: number,
  updates: Partial<{
    reviewerUsername: string | null;
    reviewerFirstName: string | null;
    privateChatId: number;
    targetGroupChatId: number | null;
    targetUsername: string | null;
    entryType: EntryType | null;
    result: EntryResult | null;
    selectedTags: EntryTag[];
    step: DraftStep;
  }>,
) {
  const draft = await getDraftByReviewerTelegramId(reviewerTelegramId);
  if (!draft) {
    return null;
  }

  const [updated] = await db
    .update(vouchDrafts)
    .set({
      reviewerUsername: updates.reviewerUsername ?? draft.reviewerUsername,
      reviewerFirstName: updates.reviewerFirstName ?? draft.reviewerFirstName,
      privateChatId: updates.privateChatId ?? draft.privateChatId,
      targetGroupChatId: updates.targetGroupChatId === undefined ? draft.targetGroupChatId : updates.targetGroupChatId,
      targetUsername: updates.targetUsername === undefined ? draft.targetUsername : updates.targetUsername,
      entryType: updates.entryType === undefined ? draft.entryType : updates.entryType,
      result: updates.result === undefined ? draft.result : updates.result,
      selectedTags: updates.selectedTags === undefined ? draft.selectedTags : serializeSelectedTags(updates.selectedTags),
      step: updates.step ?? (draft.step as DraftStep),
      updatedAt: new Date(),
    })
    .where(eq(vouchDrafts.id, draft.id))
    .returning();

  return updated;
}

export async function clearDraftByReviewerTelegramId(reviewerTelegramId: number) {
  const draft = await getDraftByReviewerTelegramId(reviewerTelegramId);
  if (!draft) {
    return;
  }

  await db.delete(vouchDrafts).where(eq(vouchDrafts.id, draft.id));
}

export async function hasRecentEntryForReviewerAndTarget(input: {
  reviewerTelegramId: number;
  targetUsername: string;
  withinHours: number;
}) {
  const cutoff = new Date(Date.now() - input.withinHours * 60 * 60 * 1000);

  const result = await db
    .select()
    .from(vouchEntries)
    .where(
      and(
        eq(vouchEntries.reviewerTelegramId, input.reviewerTelegramId),
        eq(vouchEntries.targetUsername, input.targetUsername),
        gte(vouchEntries.createdAt, cutoff),
        eq(vouchEntries.status, "published"),
      ),
    )
    .limit(1);

  return result.length > 0;
}

export async function createArchiveEntry(input: {
  reviewerUserId: number | null;
  reviewerTelegramId: number;
  reviewerUsername: string;
  targetProfileId: number;
  targetUsername: string;
  chatId: number;
  entryType: EntryType;
  result: EntryResult;
  selectedTags: EntryTag[];
  source?: EntrySource;
  legacySourceMessageId?: number | null;
  legacySourceChatId?: number | null;
  legacySourceTimestamp?: Date | null;
  createdAt?: Date;
}) {
  const [created] = await db
    .insert(vouchEntries)
    .values({
      reviewerUserId: input.reviewerUserId,
      reviewerTelegramId: input.reviewerTelegramId,
      reviewerUsername: input.reviewerUsername,
      targetProfileId: input.targetProfileId,
      targetUsername: input.targetUsername,
      chatId: input.chatId,
      entryType: input.entryType,
      result: input.result,
      selectedTags: serializeSelectedTags(input.selectedTags),
      source: input.source ?? "live",
      legacySourceMessageId: input.legacySourceMessageId ?? null,
      legacySourceChatId: input.legacySourceChatId ?? null,
      legacySourceTimestamp: input.legacySourceTimestamp ?? null,
      status: "pending",
      createdAt: input.createdAt ?? new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return created;
}

export async function setArchiveEntryPublishedMessageId(entryId: number, publishedMessageId: number) {
  const [updated] = await db
    .update(vouchEntries)
    .set({
      publishedMessageId,
      status: "published",
      updatedAt: new Date(),
    })
    .where(eq(vouchEntries.id, entryId))
    .returning();

  return updated;
}

export async function markArchiveEntryPublishing(entryId: number) {
  const updated = await db
    .update(vouchEntries)
    .set({
      status: "publishing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vouchEntries.id, entryId),
        eq(vouchEntries.status, "pending"),
        isNull(vouchEntries.publishedMessageId),
      ),
    )
    .returning();

  return updated[0] ?? null;
}

export async function setArchiveEntryStatus(entryId: number, status: string) {
  const [updated] = await db
    .update(vouchEntries)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(vouchEntries.id, entryId))
    .returning();

  return updated ?? null;
}

export async function getArchiveEntryById(entryId: number) {
  const result = await db
    .select()
    .from(vouchEntries)
    .where(eq(vouchEntries.id, entryId))
    .limit(1);

  return result[0] ?? null;
}

export async function getArchiveEntryByLegacySource(input: {
  legacySourceChatId: number;
  legacySourceMessageId: number;
}) {
  const result = await db
    .select()
    .from(vouchEntries)
    .where(
      and(
        eq(vouchEntries.legacySourceChatId, input.legacySourceChatId),
        eq(vouchEntries.legacySourceMessageId, input.legacySourceMessageId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function markArchiveEntryRemoved(entryId: number) {
  const [updated] = await db
    .update(vouchEntries)
    .set({
      status: "removed",
      updatedAt: new Date(),
    })
    .where(eq(vouchEntries.id, entryId))
    .returning();

  return updated;
}

export async function getRecentArchiveEntries(limit: number) {
  return db
    .select()
    .from(vouchEntries)
    .where(eq(vouchEntries.status, "published"))
    .orderBy(desc(vouchEntries.createdAt), desc(vouchEntries.id))
    .limit(limit);
}

export async function getArchiveEntriesForTarget(targetUsername: string, limit: number) {
  return db
    .select()
    .from(vouchEntries)
    .where(
      and(
        eq(vouchEntries.targetUsername, targetUsername),
        eq(vouchEntries.status, "published"),
      ),
    )
    .orderBy(desc(vouchEntries.createdAt), desc(vouchEntries.id))
    .limit(limit);
}

export async function getLauncherByChatId(chatId: number) {
  const result = await db
    .select()
    .from(chatLaunchers)
    .where(eq(chatLaunchers.chatId, chatId))
    .limit(1);

  return result[0] ?? null;
}

export async function saveLauncherMessage(chatId: number, messageId: number) {
  const existing = await getLauncherByChatId(chatId);

  if (existing) {
    const [updated] = await db
      .update(chatLaunchers)
      .set({
        messageId,
        updatedAt: new Date(),
      })
      .where(eq(chatLaunchers.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await db
    .insert(chatLaunchers)
    .values({
      chatId,
      messageId,
      updatedAt: new Date(),
    })
    .returning();

  return created;
}

export async function withChatLauncherLock<T>(chatId: number, fn: () => Promise<T>) {
  await db.execute(sql`SELECT pg_advisory_lock(${chatId})`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${chatId})`);
  }
}

export async function withReviewerDraftLock<T>(reviewerTelegramId: number, fn: () => Promise<T>) {
  const lockKey = REVIEWER_DRAFT_LOCK_OFFSET + reviewerTelegramId;
  await db.execute(sql`SELECT pg_advisory_lock(${lockKey})`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
  }
}

export async function reserveTelegramUpdate(updateId: number) {
  try {
    await db
      .insert(processedTelegramUpdates)
      .values({
        updateId,
        status: "processing",
        updatedAt: new Date(),
      });

    return { reserved: true, status: "processing" as const };
  } catch (error) {
    const existing = await db
      .select()
      .from(processedTelegramUpdates)
      .where(eq(processedTelegramUpdates.updateId, updateId))
      .limit(1);

    const current = existing[0];
    if (!current) {
      throw error;
    }

    if (current.status === "completed") {
      return { reserved: false, status: "completed" as const };
    }

    const staleCutoff = new Date(Date.now() - STALE_UPDATE_PROCESSING_MINUTES * 60 * 1000);
    if (current.updatedAt <= staleCutoff) {
      const reclaimed = await db
        .update(processedTelegramUpdates)
        .set({
          status: "processing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(processedTelegramUpdates.updateId, updateId),
            eq(processedTelegramUpdates.status, "processing"),
            lt(processedTelegramUpdates.updatedAt, staleCutoff),
          ),
        )
        .returning();

      if (reclaimed.length > 0) {
        return { reserved: true, status: "processing" as const };
      }
    }

    return { reserved: false, status: current.status as "processing" | "completed" };
  }
}

export async function completeTelegramUpdate(updateId: number) {
  const [updated] = await db
    .update(processedTelegramUpdates)
    .set({
      status: "completed",
      updatedAt: new Date(),
    })
    .where(eq(processedTelegramUpdates.updateId, updateId))
    .returning();

  return updated;
}

export async function releaseTelegramUpdate(updateId: number) {
  await db
    .delete(processedTelegramUpdates)
    .where(eq(processedTelegramUpdates.updateId, updateId));
}

export async function runArchiveMaintenance() {
  const draftCutoff = new Date(Date.now() - DEFAULT_DRAFT_TIMEOUT_HOURS * 60 * 60 * 1000);
  await db.delete(vouchDrafts).where(lt(vouchDrafts.updatedAt, draftCutoff));

  const processedUpdateCutoff = new Date(Date.now() - PROCESSED_UPDATE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .delete(processedTelegramUpdates)
    .where(lt(processedTelegramUpdates.updatedAt, processedUpdateCutoff));
}
