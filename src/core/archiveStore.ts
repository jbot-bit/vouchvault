import { and, desc, eq, lt, sql } from "drizzle-orm";

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
  // Case-insensitive + @-prefix-tolerant lookup. normalizeUsername
  // lowercases + strips @ on the caller side, but historical /
  // hand-inserted rows may have either issue. Match on LOWER(LTRIM(col,'@'))
  // = lowered so /search never silently misses a row.
  const lowered = username.replace(/^@+/, "").toLowerCase();
  const result = await db
    .select()
    .from(businessProfiles)
    .where(sql`LOWER(LTRIM(${businessProfiles.username}, '@')) = ${lowered}`)
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
  // Case-insensitive + @-prefix-tolerant. See getBusinessProfileByUsername
  // for rationale.
  const lowered = targetUsername.replace(/^@+/, "").toLowerCase();
  return db
    .select()
    .from(vouchEntries)
    .where(
      and(
        sql`LOWER(LTRIM(${vouchEntries.targetUsername}, '@')) = ${lowered}`,
        eq(vouchEntries.status, "published"),
      ),
    )
    .orderBy(desc(vouchEntries.createdAt), desc(vouchEntries.id))
    .limit(limit);
}

// Per-target summary counts. Powers the summary line at the top of
// /search response: total + breakdown by result + freshness window.
// Case-insensitive + @-prefix-tolerant. The "recent" bucket uses a
// 365-day window measured from the most recent vouch's createdAt
// (legacy entries use legacy_source_timestamp where available — the
// import populates createdAt from that, so createdAt is the canonical
// "when this vouch happened" field).
export const RECENT_VOUCH_WINDOW_DAYS = 365;

export async function getArchiveCountsForTarget(targetUsername: string): Promise<{
  total: number;
  positive: number;
  mixed: number;
  negative: number;
  firstAt: Date | null;
  lastAt: Date | null;
  recentCount: number;
  distinctReviewers: number;
}> {
  const lowered = targetUsername.replace(/^@+/, "").toLowerCase();
  const cutoff = new Date(Date.now() - RECENT_VOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [byResult, aggs] = await Promise.all([
    db.execute<{ result: string; n: string }>(
      sql`SELECT result, COUNT(*)::text AS n
          FROM vouch_entries
          WHERE LOWER(LTRIM(target_username, '@')) = ${lowered}
            AND status = 'published'
          GROUP BY result`,
    ),
    db.execute<{
      first_at: string | null;
      last_at: string | null;
      recent_n: string;
      distinct_reviewers: string;
    }>(
      sql`SELECT
            MIN(created_at) AS first_at,
            MAX(created_at) AS last_at,
            COUNT(*) FILTER (WHERE created_at >= ${cutoff})::text AS recent_n,
            COUNT(DISTINCT reviewer_telegram_id)::text AS distinct_reviewers
          FROM vouch_entries
          WHERE LOWER(LTRIM(target_username, '@')) = ${lowered}
            AND status = 'published'`,
    ),
  ]);
  const rowsOf = <T>(r: { rows: T[] } | T[]): T[] =>
    Array.isArray(r) ? r : (r as { rows: T[] }).rows ?? [];

  let positive = 0;
  let mixed = 0;
  let negative = 0;
  for (const row of rowsOf(byResult)) {
    const c = Number(row.n);
    if (row.result === "positive") positive = c;
    else if (row.result === "mixed") mixed = c;
    else if (row.result === "negative") negative = c;
  }
  const a = rowsOf(aggs)[0];
  return {
    total: positive + mixed + negative,
    positive,
    mixed,
    negative,
    firstAt: a?.first_at ? new Date(a.first_at) : null,
    lastAt: a?.last_at ? new Date(a.last_at) : null,
    recentCount: Number(a?.recent_n ?? "0"),
    distinctReviewers: Number(a?.distinct_reviewers ?? "0"),
  };
}

// Diagnostic: returns counts so admin can see what's actually in the DB
// without psql access. Used by the /dbstats admin command. Read-only.
export async function getArchiveDiagnostics() {
  const [
    statusCounts,
    profileCount,
    sampleTargets,
    sampleProfiles,
    nonLowercaseTargets,
    atPrefixedTargets,
  ] = await Promise.all([
    db.execute<{ status: string; n: string }>(
      sql`SELECT status, COUNT(*)::text AS n FROM vouch_entries GROUP BY status ORDER BY status`,
    ),
    db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM business_profiles`),
    db.execute<{ target_username: string }>(
      sql`SELECT DISTINCT target_username FROM vouch_entries ORDER BY target_username LIMIT 5`,
    ),
    db.execute<{ username: string }>(
      sql`SELECT username FROM business_profiles ORDER BY username LIMIT 5`,
    ),
    db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM vouch_entries WHERE target_username <> LOWER(target_username)`,
    ),
    db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM vouch_entries WHERE target_username LIKE '@%'`,
    ),
  ]);

  const rowsOf = <T>(r: { rows: T[] } | T[]): T[] =>
    Array.isArray(r) ? r : (r as { rows: T[] }).rows ?? [];

  return {
    statusCounts: rowsOf(statusCounts).map((row) => ({
      status: row.status,
      count: Number(row.n),
    })),
    profileCount: Number(rowsOf(profileCount)[0]?.n ?? "0"),
    sampleTargets: rowsOf(sampleTargets).map((row) => row.target_username),
    sampleProfiles: rowsOf(sampleProfiles).map((row) => row.username),
    nonLowercaseTargets: Number(rowsOf(nonLowercaseTargets)[0]?.n ?? "0"),
    atPrefixedTargets: Number(rowsOf(atPrefixedTargets)[0]?.n ?? "0"),
  };
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
