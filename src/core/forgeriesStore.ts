// Inline-cards phase 3: DB-bound fetchers for the /forgeries admin
// surface. Mirrors mirrorStore.ts vs mirrorPublish.ts pattern.

import { sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { FORGERIES_PAGE_SIZE, type StrikeRow } from "./forgeriesAdmin.ts";

export async function fetchForgeriesPage(
  page: number,
): Promise<{ rows: StrikeRow[]; total: number; page: number }> {
  const safePage = Math.max(0, page);
  const totalRow = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM forgery_strikes`,
  );
  const total = totalRow.rows[0] ? Number(totalRow.rows[0].count) : 0;
  const offset = safePage * FORGERIES_PAGE_SIZE;
  const rowsRaw = await db.execute<{
    id: number;
    user_id: number;
    chat_id: number;
    message_id: number;
    kind: string;
    detected_at: Date;
    content_hash: string;
    deleted: boolean;
  }>(
    sql`SELECT id, user_id, chat_id, message_id, kind, detected_at, content_hash, deleted
        FROM forgery_strikes
        ORDER BY detected_at DESC
        LIMIT ${FORGERIES_PAGE_SIZE} OFFSET ${offset}`,
  );
  const rows: StrikeRow[] = rowsRaw.rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    chatId: Number(r.chat_id),
    messageId: Number(r.message_id),
    kind: r.kind,
    detectedAt: r.detected_at instanceof Date ? r.detected_at : new Date(r.detected_at),
    contentHash: r.content_hash,
    deleted: Boolean(r.deleted),
  }));
  return { rows, total, page: safePage };
}
