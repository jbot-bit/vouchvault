import { and, desc, eq, lt } from "drizzle-orm";

import { db, pool } from "./storage/db.ts";
import {
  businessProfiles,
  processedTelegramUpdates,
  vouchDrafts,
  vouchEntries,
} from "./storage/schema.ts";
import {
  FREEZE_REASONS,
  isFreezeReason,
  PROCESSED_UPDATE_RETENTION_DAYS,
  STALE_UPDATE_PROCESSING_MINUTES,
  type EntryResult,
  type EntrySource,
  type EntryStatus,
  type EntryTag,
  type EntryType,
  serializeSelectedTags,
} from "./archive.ts";

// v9: vouchDrafts table is retained on the schema side for migration
// safety, but the wizard that wrote to it is gone. Maintenance still
// purges old rows in case any pre-v9 drafts linger; new rows are never
// inserted from the codebase.
const LEGACY_DRAFT_RETENTION_HOURS = 24;

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
  // v9: vouchDrafts table is unused at runtime but we still purge
  // anything older than LEGACY_DRAFT_RETENTION_HOURS in case pre-v9
  // rows linger.
  const draftCutoff = new Date(Date.now() - LEGACY_DRAFT_RETENTION_HOURS * 60 * 60 * 1000);
  await db.delete(vouchDrafts).where(lt(vouchDrafts.updatedAt, draftCutoff));

  const processedUpdateCutoff = new Date(
    Date.now() - PROCESSED_UPDATE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db
    .delete(processedTelegramUpdates)
    .where(lt(processedTelegramUpdates.updatedAt, processedUpdateCutoff));
}
