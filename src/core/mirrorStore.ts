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
  viaBotId?: number | null;
}): Promise<void> {
  await db
    .insert(mirrorLog)
    .values({
      groupChatId: input.groupChatId,
      groupMessageId: input.groupMessageId,
      channelChatId: input.channelChatId,
      channelMessageId: input.channelMessageId,
      viaBotId: input.viaBotId ?? null,
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
