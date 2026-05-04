// Pure helpers for the v6 account-age guard (V3.5.3, KB:F5.6). No DB
// imports — safe to load in test contexts without DATABASE_URL.
//
// The DB-touching companion (recordUserFirstSeen, getUserFirstSeen)
// lives in `src/core/userTracking.ts`.

export const ACCOUNT_AGE_FLOOR_HOURS = 24;

export type AccountAgeCheck =
  | { allowed: true; firstSeen: Date }
  | { allowed: false; firstSeen: Date | null; hoursRemaining: number };

// Returns whether the account is old enough to vouch and, if not, how
// many hours remain on the floor.
//
// A null firstSeen means we haven't recorded this user before — the
// guard treats this as "just appeared" (age 0) and blocks with the
// full 24h remaining. The webhook ingress (processTelegramUpdate →
// recordUserFirstSeen) is responsible for the parallel write so that
// a returning user has firstSeen set; this function does NOT mutate
// state. Returning allowed:true on null would fail-open and let
// throwaway accounts pass any future age gate on first contact — the
// exact threat KB:F5.6 captures. v9 has no live caller (the DM wizard
// that consumed this is gone); kept for the portal / future surfaces.
export function checkAccountAge(
  firstSeen: Date | null,
  now: Date = new Date(),
): AccountAgeCheck {
  if (firstSeen == null) {
    return {
      allowed: false,
      firstSeen: null,
      hoursRemaining: ACCOUNT_AGE_FLOOR_HOURS,
    };
  }
  const ageMs = now.getTime() - firstSeen.getTime();
  const floorMs = ACCOUNT_AGE_FLOOR_HOURS * 3600 * 1000;
  if (ageMs >= floorMs) {
    return { allowed: true, firstSeen };
  }
  const hoursRemaining = Math.ceil((floorMs - ageMs) / (3600 * 1000));
  return { allowed: false, firstSeen, hoursRemaining };
}
