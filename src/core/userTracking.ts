// User-tracking DB helpers for the v6 account-age guard (V3.5.3,
// KB:F5.6). Pure helpers (ACCOUNT_AGE_FLOOR_HOURS, checkAccountAge)
// live in `src/core/accountAge.ts` so they can be unit-tested without
// DATABASE_URL.

import { eq } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { usersFirstSeen } from "./storage/schema.ts";

export {
  ACCOUNT_AGE_FLOOR_HOURS,
  checkAccountAge,
  type AccountAgeCheck,
} from "./accountAge.ts";

export async function recordUserFirstSeen(telegramId: number): Promise<void> {
  await db
    .insert(usersFirstSeen)
    .values({ telegramId })
    .onConflictDoNothing({ target: usersFirstSeen.telegramId });
}

export async function getUserFirstSeen(
  telegramId: number,
): Promise<Date | null> {
  const rows = await db
    .select({ firstSeen: usersFirstSeen.firstSeen })
    .from(usersFirstSeen)
    .where(eq(usersFirstSeen.telegramId, telegramId))
    .limit(1);
  const row = rows[0];
  return row?.firstSeen ?? null;
}
