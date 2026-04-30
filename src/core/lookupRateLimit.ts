// v9 phase 2: per-user rate-limit for member DM /lookup.
// Inline-cards phase 2: namespace-aware to share across read surfaces
// (DM lookup, in-group /lookup, inline mode) without burning the same
// quota twice.
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

export type LookupNamespace = "dm" | "inline" | "group_lookup";

export type LookupRateLimiter = {
  tryConsume(
    userId: number,
    now?: number,
    namespace?: LookupNamespace,
  ): LookupRateLimitResult;
  reset(userId?: number, namespace?: LookupNamespace): void;
};

function key(userId: number, namespace: LookupNamespace): string {
  return `${namespace}:${userId}`;
}

export function createLookupRateLimiter(
  intervalMs: number = LOOKUP_INTERVAL_MS,
): LookupRateLimiter {
  const nextAllowedAt = new Map<string, number>();

  return {
    tryConsume(userId, now = Date.now(), namespace = "dm") {
      const k = key(userId, namespace);
      const next = nextAllowedAt.get(k) ?? 0;
      if (now < next) {
        return { allowed: false, retryAfterMs: next - now };
      }
      nextAllowedAt.set(k, now + intervalMs);
      return { allowed: true };
    },
    reset(userId, namespace) {
      if (userId == null) {
        nextAllowedAt.clear();
        return;
      }
      if (namespace) {
        nextAllowedAt.delete(key(userId, namespace));
      } else {
        // Clear all namespaces for this user.
        for (const ns of ["dm", "inline", "group_lookup"] as const) {
          nextAllowedAt.delete(key(userId, ns));
        }
      }
    },
  };
}

// Module-level shared limiter for the bot's runtime. Tests should
// instantiate their own via createLookupRateLimiter.
export const memberLookupLimiter: LookupRateLimiter = createLookupRateLimiter();
