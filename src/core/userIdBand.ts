// Audit-only user-id band classifier (KB:F2.33).
//
// TBC admins manually treat low Telegram user_ids as "older account"
// and high user_ids as "newer account" because numeric ids are roughly
// monotonic over time. KB:F2.33 confirms the practice but does NOT
// supply specific thresholds, and Telegram does not publish a
// user-id → registration-date mapping. So this module returns
// "unknown" by default. When future empirical research surfaces
// reliable cut-points, set the constants below — no change required
// at the call site.
//
// **This is NEVER a primary gate.** The primary account-age gate
// stays in `accountAge.ts` + `userTracking.ts` (when did *this bot*
// first observe the user). This signal is observation-only; the
// wizard logs it with `audit_only_signal: true` so an operator can
// later correlate suspected throwaways with their numeric-id band
// without the bot having silently blocked anyone based on a guess.

export type UserIdBand = "likely_old" | "likely_new" | "unknown";

// Set these only when empirical data supports it. Until then the
// classifier returns "unknown" for every input.
//   LIKELY_OLD_MAX_ID — ids strictly less than this are "likely_old"
//   LIKELY_NEW_MIN_ID — ids strictly greater than this are "likely_new"
//   The two MUST satisfy LIKELY_OLD_MAX_ID < LIKELY_NEW_MIN_ID;
//   between the two, the band is "unknown".
export const LIKELY_OLD_MAX_ID: number | null = null;
export const LIKELY_NEW_MIN_ID: number | null = null;

export function classifyUserIdBand(userId: number): UserIdBand {
  if (!Number.isSafeInteger(userId) || userId <= 0) return "unknown";
  if (LIKELY_OLD_MAX_ID != null && userId < LIKELY_OLD_MAX_ID) return "likely_old";
  if (LIKELY_NEW_MIN_ID != null && userId > LIKELY_NEW_MIN_ID) return "likely_new";
  return "unknown";
}
