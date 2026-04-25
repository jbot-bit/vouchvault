// Pure policy helpers for the group launcher. Kept separate from
// `archiveLauncher.ts` so they can be unit-tested without the DB pool.

// Debounce window: if the launcher was refreshed less than 30 seconds ago,
// skip the delete + re-send. This protects against burst refreshes from
// /vouch + entry publish + entry remove all firing within seconds in a busy
// chat — Telegram rate-limits delete/send and an unnecessary churn looks
// noisy in the chat history too.
export const LAUNCHER_REFRESH_DEBOUNCE_MS = 30_000;

export function isLauncherDebounceActive(
  updatedAt: Date,
  nowMs: number,
  debounceMs: number = LAUNCHER_REFRESH_DEBOUNCE_MS,
): boolean {
  return nowMs - updatedAt.getTime() < debounceMs;
}
