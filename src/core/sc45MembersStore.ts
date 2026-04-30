// Inline-cards phase 0: SC45 member registry — DB-side helpers.
//
// Pure helpers (status mapping, seen-cache LRU) live in `sc45Members.ts`.
// This module owns drizzle calls and is not test-imported (mirror_log
// pattern: `mirrorPublish.ts` pure, `mirrorStore.ts` DB).

import { sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { sc45Members } from "./storage/schema.ts";

export async function upsertMember(args: {
  userId: number;
  status: string;
}): Promise<void> {
  await db.execute(
    sql`INSERT INTO sc45_members (user_id, last_seen_status)
        VALUES (${args.userId}, ${args.status})
        ON CONFLICT (user_id) DO UPDATE
          SET last_seen_status = EXCLUDED.last_seen_status,
              updated_at = NOW()`,
  );
}

export async function removeMember(userId: number): Promise<void> {
  await db.execute(sql`DELETE FROM sc45_members WHERE user_id = ${userId}`);
}

export async function isMember(userId: number): Promise<boolean> {
  const result = await db
    .select({ userId: sc45Members.userId })
    .from(sc45Members)
    .where(sql`${sc45Members.userId} = ${userId}`)
    .limit(1);
  return result.length > 0;
}
