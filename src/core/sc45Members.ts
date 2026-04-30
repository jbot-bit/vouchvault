// Inline-cards phase 0: SC45 member registry — pure helpers.
//
// Pure logic (status mapping, LRU cache for the auto-add path) lives
// here so it can be unit-tested without DATABASE_URL. DB-side helpers
// live in `sc45MembersStore.ts` (mirrors mirrorPublish.ts ↔ mirrorStore.ts).
//
// LRU cache: every group message hits a cache check first; only cache
// misses hit the DB. Cap is FIFO at 1024 entries — covers any realistic
// active-member set with negligible memory cost.
//
// See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md §6.5.

export const ACTIVE_MEMBER_STATUSES = new Set([
  "member",
  "administrator",
  "creator",
  "restricted",
]);

export const INACTIVE_MEMBER_STATUSES = new Set(["left", "kicked"]);

export function statusIsActive(status: string): boolean {
  return ACTIVE_MEMBER_STATUSES.has(status);
}

const DEFAULT_LRU_CAP = 1024;

export type SeenCache = {
  recentlySeen(userId: number): boolean;
  markSeen(userId: number): void;
  size(): number;
  clear(): void;
};

export function createSeenCache(cap: number = DEFAULT_LRU_CAP): SeenCache {
  // Map preserves insertion order — re-insert on hit to refresh recency.
  const seen = new Map<number, true>();

  return {
    recentlySeen(userId) {
      if (!seen.has(userId)) return false;
      seen.delete(userId);
      seen.set(userId, true);
      return true;
    },
    markSeen(userId) {
      if (seen.has(userId)) {
        seen.delete(userId);
      } else if (seen.size >= cap) {
        const firstKey = seen.keys().next().value;
        if (firstKey !== undefined) seen.delete(firstKey);
      }
      seen.set(userId, true);
    },
    size() {
      return seen.size;
    },
    clear() {
      seen.clear();
    },
  };
}

// Module-level shared cache. Tests instantiate their own.
export const sharedSeenCache: SeenCache = createSeenCache();
