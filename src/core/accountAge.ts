// Pure helpers for the v6 account-age guard (V3.5.3, KB:F5.6). No DB
// imports — safe to load in test contexts without DATABASE_URL.
//
// The DB-touching companion (recordUserFirstSeen, getUserFirstSeen)
// lives in `src/core/userTracking.ts`.

export const ACCOUNT_AGE_FLOOR_HOURS = 24;

export type AccountAgeCheck =
  | { allowed: true; firstSeen: Date | null }
  | { allowed: false; firstSeen: Date; hoursRemaining: number };

// Returns whether the account is old enough to vouch and, if not, how
// many hours remain on the floor. A null firstSeen means we haven't
// observed the user before — caller should record-first-seen and treat
// the next return as too-new.
export function checkAccountAge(
  firstSeen: Date | null,
  now: Date = new Date(),
): AccountAgeCheck {
  if (firstSeen == null) {
    return { allowed: true, firstSeen: null };
  }
  const ageMs = now.getTime() - firstSeen.getTime();
  const floorMs = ACCOUNT_AGE_FLOOR_HOURS * 3600 * 1000;
  if (ageMs >= floorMs) {
    return { allowed: true, firstSeen };
  }
  const hoursRemaining = Math.ceil((floorMs - ageMs) / (3600 * 1000));
  return { allowed: false, firstSeen, hoursRemaining };
}
