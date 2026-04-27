import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db, pool } from "./storage/db.ts";
import {
  businessProfiles,
  chatLaunchers,
  processedTelegramUpdates,
  vouchDrafts,
  vouchEntries,
} from "./storage/schema.ts";
import {
  DEFAULT_DRAFT_TIMEOUT_HOURS,
  FREEZE_REASONS,
  isFreezeReason,
  PROCESSED_UPDATE_RETENTION_DAYS,
  STALE_UPDATE_PROCESSING_MINUTES,
  type DraftStep,
  type EntryResult,
  type EntrySource,
  type EntryStatus,
  type EntryTag,
  type EntryType,
  serializeSelectedTags,
} from "./archive.ts";

// Postgres advisory-lock keys are 64-bit; this offset shifts reviewer
// Telegram user IDs into a region that can't collide with raw chat IDs
// used by other locks. -9e15 sits safely below any Telegram ID and within
// JavaScript's Number.MIN_SAFE_INTEGER so arithmetic stays exact.
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
    const rows = await db
      .insert(businessProfiles)
      .values({
        username,
        isFrozen: false,
        updatedAt: new Date(),
      })
      .returning();

    // insert().returning() always returns the inserted row
    return rows[0]!;
  } catch {
    const retried = await getBusinessProfileByUsername(username);
    if (retried) {
      return retried;
    }

    throw new Error(`Failed to create business profile for ${username}`);
  }
}

export async function listFrozenProfiles() {
  // 10× the visible cap of buildFrozenListText leaves margin for the
  // "…and N more" footer math without scanning every frozen row.
  return db
    .select({
      username: businessProfiles.username,
      freezeReason: businessProfiles.freezeReason,
      frozenAt: businessProfiles.frozenAt,
    })
    .from(businessProfiles)
    .where(eq(businessProfiles.isFrozen, true))
    .orderBy(desc(businessProfiles.frozenAt))
    .limit(100);
}

export async function setBusinessProfileFrozen(input: {
  username: string;
  isFrozen: boolean;
  reason?: string | null;
  byTelegramId?: number | null;
}) {
  const profile = await getOrCreateBusinessProfile(input.username);

  // Defence-in-depth: the /freeze handler validates the enum, but reject
  // any non-enum value at the store boundary too so legacy import / replay
  // / future callers can't write a free-text reason.
  let reasonToStore: string | null = null;
  if (input.isFrozen) {
    if (!isFreezeReason(input.reason)) {
      throw new Error(
        `freeze_reason must be one of: ${FREEZE_REASONS.join(", ")}`,
      );
    }
    reasonToStore = input.reason;
  }

  const rows = await db
    .update(businessProfiles)
    .set({
      isFrozen: input.isFrozen,
      freezeReason: input.isFrozen ? reasonToStore : null,
      frozenAt: input.isFrozen ? new Date() : null,
      frozenByTelegramId: input.isFrozen ? (input.byTelegramId ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(businessProfiles.id, profile.id))
    .returning();

  // update().returning() always returns the updated row when the where clause matches
  return rows[0]!;
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
    const rows = await db
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

    return rows[0]!;
  }

  try {
    const rows = await db
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

    return rows[0]!;
  } catch {
    const retried = await getDraftByReviewerTelegramId(input.reviewerTelegramId);
    if (!retried) {
      throw new Error(`Failed to create draft for reviewer ${input.reviewerTelegramId}`);
    }

    const rows = await db
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

    return rows[0]!;
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
    privateNote: string | null;
    bodyText: string | null;
  }>,
) {
  const draft = await getDraftByReviewerTelegramId(reviewerTelegramId);
  if (!draft) {
    return null;
  }

  const rows = await db
    .update(vouchDrafts)
    .set({
      reviewerUsername: updates.reviewerUsername ?? draft.reviewerUsername,
      reviewerFirstName: updates.reviewerFirstName ?? draft.reviewerFirstName,
      privateChatId: updates.privateChatId ?? draft.privateChatId,
      targetGroupChatId:
        updates.targetGroupChatId === undefined
          ? draft.targetGroupChatId
          : updates.targetGroupChatId,
      targetUsername:
        updates.targetUsername === undefined ? draft.targetUsername : updates.targetUsername,
      entryType: updates.entryType === undefined ? draft.entryType : updates.entryType,
      result: updates.result === undefined ? draft.result : updates.result,
      selectedTags:
        updates.selectedTags === undefined
          ? draft.selectedTags
          : serializeSelectedTags(updates.selectedTags),
      step: updates.step ?? (draft.step as DraftStep),
      privateNote:
        updates.privateNote === undefined ? draft.privateNote : updates.privateNote,
      bodyText:
        updates.bodyText === undefined ? draft.bodyText : updates.bodyText,
      updatedAt: new Date(),
    })
    .where(eq(vouchDrafts.id, draft.id))
    .returning();

  return rows[0]!;
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
}): Promise<Date | null> {
  const cutoff = new Date(Date.now() - input.withinHours * 60 * 60 * 1000);

  const result = await db
    .select({ createdAt: vouchEntries.createdAt })
    .from(vouchEntries)
    .where(
      and(
        eq(vouchEntries.reviewerTelegramId, input.reviewerTelegramId),
        eq(vouchEntries.targetUsername, input.targetUsername),
        gte(vouchEntries.createdAt, cutoff),
        eq(vouchEntries.status, "published"),
      ),
    )
    .orderBy(desc(vouchEntries.createdAt))
    .limit(1);

  return result[0]?.createdAt ?? null;
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
  privateNote?: string | null;
  bodyText?: string | null;
}) {
  // Defence-in-depth: a private_note is only valid on a NEG entry. The DM
  // flow already gates the awaiting_admin_note step on result==='negative',
  // but reject any caller (including legacy import / replay) that passes
  // a note alongside a non-NEG result.
  if (
    input.result !== "negative" &&
    input.privateNote != null &&
    input.privateNote.length > 0
  ) {
    throw new Error("private_note is only valid on negative entries");
  }

  const rows = await db
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
      privateNote: input.privateNote ?? null,
      bodyText: input.bodyText ?? null,
      createdAt: input.createdAt ?? new Date(),
      updatedAt: new Date(),
    })
    .returning();

  // insert().returning() always returns the inserted row
  return rows[0]!;
}

export async function setArchiveEntryPublishedMessageId(
  entryId: number,
  publishedMessageId: number,
) {
  // Guard on status='publishing' so we don't resurrect an entry that was
  // marked 'removed' (via /remove_entry) while the Telegram send was in
  // flight. Without this guard, the race window between
  // markArchiveEntryPublishing and the Telegram callback returning could
  // silently undo a concurrent /remove_entry.
  const rows = await db
    .update(vouchEntries)
    .set({
      publishedMessageId,
      status: "published",
      updatedAt: new Date(),
    })
    .where(and(eq(vouchEntries.id, entryId), eq(vouchEntries.status, "publishing")))
    .returning();

  // null means the row's status was no longer 'publishing' — typically
  // because /remove_entry won the race. The caller logs and handles the
  // orphan Telegram message (admin can re-delete; we don't track the new
  // messageId here because the row is already 'removed').
  return rows[0] ?? null;
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

// V3.5.4 channel-relay path: after a successful channel send the
// entry holds the channel-side message_id but the supergroup auto-
// forward hasn't been observed yet. Status 'channel_published' is the
// in-between state. Same race-guard as setArchiveEntryPublishedMessageId.
export async function setArchiveEntryChannelPublished(
  entryId: number,
  channelMessageId: number,
) {
  const rows = await db
    .update(vouchEntries)
    .set({
      channelMessageId,
      status: "channel_published",
      updatedAt: new Date(),
    })
    .where(and(eq(vouchEntries.id, entryId), eq(vouchEntries.status, "publishing")))
    .returning();
  return rows[0] ?? null;
}

// Auto-forward observed: link the supergroup-side message id and
// flip to 'published'. Lookup keys on (channel_message_id, source
// channel) — the relay capture handler matches before calling here.
export async function captureSupergroupForward(input: {
  channelMessageId: number;
  supergroupMessageId: number;
}) {
  const rows = await db
    .update(vouchEntries)
    .set({
      publishedMessageId: input.supergroupMessageId,
      status: "published",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vouchEntries.channelMessageId, input.channelMessageId),
        eq(vouchEntries.status, "channel_published"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function setArchiveEntryStatus(entryId: number, status: EntryStatus) {
  const rows = await db
    .update(vouchEntries)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(vouchEntries.id, entryId))
    .returning();

  return rows[0] ?? null;
}

export async function getArchiveEntryById(entryId: number) {
  const result = await db.select().from(vouchEntries).where(eq(vouchEntries.id, entryId)).limit(1);

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
  const rows = await db
    .update(vouchEntries)
    .set({
      status: "removed",
      updatedAt: new Date(),
    })
    .where(eq(vouchEntries.id, entryId))
    .returning();

  return rows[0]!;
}

export async function getArchiveEntriesForTarget(targetUsername: string, limit: number) {
  return db
    .select()
    .from(vouchEntries)
    .where(
      and(eq(vouchEntries.targetUsername, targetUsername), eq(vouchEntries.status, "published")),
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
    const rows = await db
      .update(chatLaunchers)
      .set({
        messageId,
        updatedAt: new Date(),
      })
      .where(eq(chatLaunchers.id, existing.id))
      .returning();

    return rows[0]!;
  }

  const rows = await db
    .insert(chatLaunchers)
    .values({
      chatId,
      messageId,
      updatedAt: new Date(),
    })
    .returning();

  return rows[0]!;
}

/**
 * `pg_advisory_lock` is a session-level lock — it must be acquired AND released
 * on the same Postgres connection. Going through `db.execute(...)` checks out a
 * fresh pooled connection per statement, so the previous implementation acquired
 * the lock on connection A and tried to release it on a different connection B,
 * leaving A's lock held forever and providing zero serialization for the body.
 *
 * Pinning a single client via `pool.connect()` for both the lock and the unlock
 * is the correct fix. The body still runs on whatever pool connection it uses,
 * but only one caller can hold the advisory lock at a time, so bodies serialize
 * naturally — concurrent callers block at `pg_advisory_lock` on their own pinned
 * client until the lock holder unlocks.
 */
async function withAdvisoryLock<T>(lockKey: number, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let unlockFailed = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    try {
      return await fn();
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      } catch {
        // statement_timeout / conn drop / etc. — the lock is still held on
        // this session. Mark the connection for destruction below so PG
        // releases all session-level locks on disconnect; otherwise the
        // pooled connection returns to the pool with the lock held and the
        // next caller blocks for 20s on pg_advisory_lock then dies.
        unlockFailed = true;
      }
    }
  } finally {
    // Pass true on unlock failure to destroy the connection (per node-postgres
    // PoolClient.release contract). Otherwise return the connection cleanly.
    client.release(unlockFailed);
  }
}

export async function withChatLauncherLock<T>(chatId: number, fn: () => Promise<T>) {
  return withAdvisoryLock(chatId, fn);
}

export async function withReviewerDraftLock<T>(reviewerTelegramId: number, fn: () => Promise<T>) {
  return withAdvisoryLock(REVIEWER_DRAFT_LOCK_OFFSET + reviewerTelegramId, fn);
}

// Bot-kind discriminator for multi-bot idempotency. Telegram update_ids
// are per-bot, so under multi-bot we key processed_telegram_updates on
// (bot_kind, update_id). Default 'ingest' preserves single-bot behaviour.
export type BotKind = "ingest" | "lookup" | "admin";

export async function reserveTelegramUpdate(
  updateId: number,
  botKind: BotKind = "ingest",
) {
  try {
    await db.insert(processedTelegramUpdates).values({
      updateId,
      botKind,
      status: "processing",
      updatedAt: new Date(),
    });

    return { reserved: true, status: "processing" as const };
  } catch (error) {
    const existing = await db
      .select()
      .from(processedTelegramUpdates)
      .where(
        and(
          eq(processedTelegramUpdates.updateId, updateId),
          eq(processedTelegramUpdates.botKind, botKind),
        ),
      )
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
            eq(processedTelegramUpdates.botKind, botKind),
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

export async function completeTelegramUpdate(
  updateId: number,
  botKind: BotKind = "ingest",
) {
  const rows = await db
    .update(processedTelegramUpdates)
    .set({
      status: "completed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(processedTelegramUpdates.updateId, updateId),
        eq(processedTelegramUpdates.botKind, botKind),
      ),
    )
    .returning();

  return rows[0]!;
}

export async function releaseTelegramUpdate(
  updateId: number,
  botKind: BotKind = "ingest",
) {
  await db
    .delete(processedTelegramUpdates)
    .where(
      and(
        eq(processedTelegramUpdates.updateId, updateId),
        eq(processedTelegramUpdates.botKind, botKind),
      ),
    );
}

export async function runArchiveMaintenance() {
  const draftCutoff = new Date(Date.now() - DEFAULT_DRAFT_TIMEOUT_HOURS * 60 * 60 * 1000);
  await db.delete(vouchDrafts).where(lt(vouchDrafts.updatedAt, draftCutoff));

  const processedUpdateCutoff = new Date(
    Date.now() - PROCESSED_UPDATE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db
    .delete(processedTelegramUpdates)
    .where(lt(processedTelegramUpdates.updatedAt, processedUpdateCutoff));
}

export async function countRecentEntriesByReviewer(input: {
  reviewerTelegramId: number;
  withinHours: number;
}): Promise<{ count: number; oldestInWindow: Date | null }> {
  const cutoff = new Date(Date.now() - input.withinHours * 3600 * 1000);
  const filter = and(
    eq(vouchEntries.reviewerTelegramId, input.reviewerTelegramId),
    gte(vouchEntries.createdAt, cutoff),
    ne(vouchEntries.status, "removed"),
  );

  const [countRow, oldestRow] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(vouchEntries).where(filter),
    db
      .select({ createdAt: vouchEntries.createdAt })
      .from(vouchEntries)
      .where(filter)
      .orderBy(asc(vouchEntries.createdAt))
      .limit(1),
  ]);

  return {
    count: Number(countRow[0]?.count ?? 0),
    oldestInWindow: oldestRow[0]?.createdAt ?? null,
  };
}
