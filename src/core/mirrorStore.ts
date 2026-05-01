// v9 phase 1: DB-side helpers for mirror_log.
//
// Pure helpers (decision logic, env parsing) live in `mirrorPublish.ts`
// so they can be unit-tested without DATABASE_URL. This file owns the
// drizzle calls.

import { sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { mirrorLog } from "./storage/schema.ts";

export async function wasAlreadyMirrored(input: {
  groupChatId: number;
  groupMessageId: number;
}): Promise<boolean> {
  const result = await db
    .select({ id: mirrorLog.id })
    .from(mirrorLog)
    .where(
      sql`${mirrorLog.groupChatId} = ${input.groupChatId} AND ${mirrorLog.groupMessageId} = ${input.groupMessageId}`,
    )
    .limit(1);
  return result.length > 0;
}

export async function recordMirror(input: {
  groupChatId: number;
  groupMessageId: number;
  channelChatId: number;
  channelMessageId: number;
}): Promise<void> {
  await db
    .insert(mirrorLog)
    .values({
      groupChatId: input.groupChatId,
      groupMessageId: input.groupMessageId,
      channelChatId: input.channelChatId,
      channelMessageId: input.channelMessageId,
    })
    .onConflictDoNothing({
      target: [mirrorLog.groupChatId, mirrorLog.groupMessageId],
    });
}

export async function getLastMirrorAt(): Promise<Date | null> {
  const result = await db
    .select({ forwardedAt: mirrorLog.forwardedAt })
    .from(mirrorLog)
    .orderBy(sql`${mirrorLog.forwardedAt} DESC`)
    .limit(1);
  if (result.length === 0) return null;
  const row = result[0]!;
  return row.forwardedAt;
}

export async function getMirrorDiagnostics(): Promise<{
  total: number;
  last24h: number;
  last1h: number;
  lastForwardedAt: Date | null;
}> {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoff1h = new Date(Date.now() - 60 * 60 * 1000);
  const result = await db.execute<{
    total: string;
    last24h: string;
    last1h: string;
    last_at: string | null;
  }>(
    sql`SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE forwarded_at >= ${cutoff24h})::text AS last24h,
          COUNT(*) FILTER (WHERE forwarded_at >= ${cutoff1h})::text AS last1h,
          MAX(forwarded_at) AS last_at
        FROM mirror_log`,
  );
  const rows: ReadonlyArray<{
    total: string;
    last24h: string;
    last1h: string;
    last_at: string | null;
  }> = Array.isArray(result)
    ? result
    : (result as { rows: any[] }).rows ?? [];
  const r = rows[0];
  return {
    total: Number(r?.total ?? "0"),
    last24h: Number(r?.last24h ?? "0"),
    last1h: Number(r?.last1h ?? "0"),
    lastForwardedAt: r?.last_at ? new Date(r.last_at) : null,
  };
}
