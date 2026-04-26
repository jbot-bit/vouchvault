import { TelegramRateLimitError } from "./typedTelegramErrors.ts";

// Hard ceiling on the retry sleep. The webhook handler in server.ts has its
// own 25s race; sleeping longer than that just burns DB connection slots
// while Telegram redelivers the same update. Beyond a few seconds it's
// always cheaper to bail and let the next webhook delivery retry.
const MAX_RETRY_AFTER_SECONDS = 5;

export async function withTelegramRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 2;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (err instanceof TelegramRateLimitError && attempt < max) {
        const requested = err.retryAfter ?? 1;
        const sleepSeconds = Math.max(0, Math.min(requested, MAX_RETRY_AFTER_SECONDS));
        await new Promise((r) => setTimeout(r, sleepSeconds * 1000 + 100));
        continue;
      }
      throw err;
    }
  }
}
