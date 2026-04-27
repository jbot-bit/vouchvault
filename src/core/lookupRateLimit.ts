// v9 phase 2: per-user rate-limit for member DM /lookup.
//
// Members get one lookup per LOOKUP_INTERVAL_MS. Burst beyond that is
// denied with a `retryAfterMs` so the bot can reply with a polite
// hold-on message instead of silently dropping. Admins are not rate-
// limited (the gate is on the member-flavoured DM path only).
//
// In-memory only — process-local. Sufficient for single-replica deploys
// (Railway is one container per service). If we ever move to multi-
// replica, swap this for a Redis or DB-backed bucket.
//
// Pure-ish: takes a `now` injection for deterministic testing.

export const LOOKUP_INTERVAL_MS = 5_000;

export type LookupRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export type LookupRateLimiter = {
  tryConsume(userId: number, now?: number): LookupRateLimitResult;
  reset(userId?: number): void;
};

export function createLookupRateLimiter(
  intervalMs: number = LOOKUP_INTERVAL_MS,
): LookupRateLimiter {
  // userId → next-allowed-at timestamp
  const nextAllowedAt = new Map<number, number>();

  return {
    tryConsume(userId, now = Date.now()) {
      const next = nextAllowedAt.get(userId) ?? 0;
      if (now < next) {
        return { allowed: false, retryAfterMs: next - now };
      }
      nextAllowedAt.set(userId, now + intervalMs);
      return { allowed: true };
    },
    reset(userId) {
      if (userId == null) {
        nextAllowedAt.clear();
      } else {
        nextAllowedAt.delete(userId);
      }
    },
  };
}

// Module-level shared limiter for the bot's runtime. Tests should
// instantiate their own via createLookupRateLimiter.
export const memberLookupLimiter: LookupRateLimiter = createLookupRateLimiter();
