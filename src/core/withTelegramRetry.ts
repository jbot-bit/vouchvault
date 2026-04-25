import { TelegramRateLimitError } from "./typedTelegramErrors.ts";

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
        await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000 + 100));
        continue;
      }
      throw err;
    }
  }
}
