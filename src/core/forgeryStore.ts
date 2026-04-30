// Inline-cards phase 1: forgery_strikes DB helpers.
//
// Pure detector lives in `forgeryDetector.ts`. This module owns the
// drizzle calls. Mirrors mirrorPublish ↔ mirrorStore so the detector
// can be tested without DATABASE_URL.

import { sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { forgeryStrikes } from "./storage/schema.ts";
import type { ForgeryKind } from "./forgeryDetector.ts";

// /forgetme TODO: when the GDPR delete pathway lands, it must also
// purge forgery_strikes rows for the requesting user.

export async function recordStrike(input: {
  userId: number;
  chatId: number;
  messageId: number;
  kind: ForgeryKind;
  contentHash: string;
  deleted: boolean;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(forgeryStrikes)
    .values({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.messageId,
      kind: input.kind,
      contentHash: input.contentHash,
      deleted: input.deleted,
    })
    .returning({ id: forgeryStrikes.id });
  return { id: row!.id };
}

export async function countRecentStrikes(input: {
  userId: number;
  withinHours: number;
}): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count
        FROM forgery_strikes
        WHERE user_id = ${input.userId}
          AND detected_at >= NOW() - (${input.withinHours} || ' hours')::interval`,
  );
  const first = result.rows[0];
  return first ? Number(first.count) : 0;
}

export async function listRecentStrikes(input: {
  limit: number;
  offset: number;
}): Promise<
  Array<{
    id: number;
    userId: number;
    chatId: number;
    messageId: number;
    kind: string;
    detectedAt: Date;
    contentHash: string;
    deleted: boolean;
  }>
> {
  const rows = await db
    .select()
    .from(forgeryStrikes)
    .orderBy(sql`${forgeryStrikes.detectedAt} DESC`)
    .limit(input.limit)
    .offset(input.offset);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    chatId: r.chatId,
    messageId: r.messageId,
    kind: r.kind,
    detectedAt: r.detectedAt,
    contentHash: r.contentHash,
    deleted: r.deleted,
  }));
}
