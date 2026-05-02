// DB ops for the admin review queue. /teach inserts a row; /reviewq
// + its callback buttons drive the keep/delete decisions.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { modReviewQueue } from "./storage/schema.ts";

export type ReviewItem = {
  id: number;
  groupChatId: number;
  groupMessageId: number;
  senderTelegramId: number | null;
  senderUsername: string | null;
  messageText: string | null;
  flaggedByTelegramId: number;
  flaggedAt: Date;
};

// Insert (or no-op if already queued for the same group message).
// Returns the row's id either way so the caller can confirm to the admin.
export async function enqueueReviewItem(input: {
  groupChatId: number;
  groupMessageId: number;
  senderTelegramId: number | null;
  senderUsername: string | null;
  messageText: string | null;
  flaggedByTelegramId: number;
}): Promise<{ id: number; alreadyQueued: boolean }> {
  // Check if already queued (any state). Idempotent.
  const existing = await db
    .select({ id: modReviewQueue.id, decision: modReviewQueue.decision })
    .from(modReviewQueue)
    .where(
      and(
        eq(modReviewQueue.groupChatId, input.groupChatId),
        eq(modReviewQueue.groupMessageId, input.groupMessageId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { id: existing[0].id, alreadyQueued: true };
  }

  const inserted = await db
    .insert(modReviewQueue)
    .values({
      groupChatId: input.groupChatId,
      groupMessageId: input.groupMessageId,
      senderTelegramId: input.senderTelegramId,
      senderUsername: input.senderUsername,
      messageText: input.messageText,
      flaggedByTelegramId: input.flaggedByTelegramId,
    })
    .returning({ id: modReviewQueue.id });
  return { id: inserted[0]!.id, alreadyQueued: false };
}

// List pending items, oldest first. Default cap 10.
export async function listPendingReviewItems(limit = 10): Promise<ReviewItem[]> {
  const rows = await db
    .select()
    .from(modReviewQueue)
    .where(isNull(modReviewQueue.decision))
    .orderBy(asc(modReviewQueue.flaggedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    groupChatId: row.groupChatId,
    groupMessageId: row.groupMessageId,
    senderTelegramId: row.senderTelegramId,
    senderUsername: row.senderUsername,
    messageText: row.messageText,
    flaggedByTelegramId: row.flaggedByTelegramId,
    flaggedAt: row.flaggedAt,
  }));
}

// List recent /teach actions, newest first. Used by the read-only
// /reviewq history view. Pulls from the same table, regardless of
// decision state.
export async function listRecentTeachItems(limit = 10): Promise<ReviewItem[]> {
  const rows = await db
    .select()
    .from(modReviewQueue)
    .orderBy(sql`${modReviewQueue.flaggedAt} DESC`)
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    groupChatId: row.groupChatId,
    groupMessageId: row.groupMessageId,
    senderTelegramId: row.senderTelegramId,
    senderUsername: row.senderUsername,
    messageText: row.messageText,
    flaggedByTelegramId: row.flaggedByTelegramId,
    flaggedAt: row.flaggedAt,
  }));
}

// Returns the item without changing its state. Used by the callback
// handler to verify the item still exists before acting.
export async function getReviewItem(id: number): Promise<ReviewItem | null> {
  const rows = await db
    .select()
    .from(modReviewQueue)
    .where(eq(modReviewQueue.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    groupChatId: row.groupChatId,
    groupMessageId: row.groupMessageId,
    senderTelegramId: row.senderTelegramId,
    senderUsername: row.senderUsername,
    messageText: row.messageText,
    flaggedByTelegramId: row.flaggedByTelegramId,
    flaggedAt: row.flaggedAt,
  };
}

export async function markReviewItemDecided(input: {
  id: number;
  decidedByTelegramId: number;
  decision: "delete" | "keep";
}): Promise<boolean> {
  // Only flip rows that are still pending — guards against a double-tap
  // race firing the deleteTelegramMessage call twice.
  const rows = await db
    .update(modReviewQueue)
    .set({
      decidedByTelegramId: input.decidedByTelegramId,
      decidedAt: new Date(),
      decision: input.decision,
    })
    .where(
      and(
        eq(modReviewQueue.id, input.id),
        isNull(modReviewQueue.decision),
      ),
    )
    .returning({ id: modReviewQueue.id });
  return rows.length > 0;
}

export async function getPendingReviewCount(): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::text AS n FROM mod_review_queue WHERE decision IS NULL`,
  );
  const rows: ReadonlyArray<{ n: string }> = Array.isArray(result)
    ? result
    : (result as { rows: Array<{ n: string }> }).rows ?? [];
  return Number(rows[0]?.n ?? 0);
}
