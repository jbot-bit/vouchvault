import { test } from "node:test";
import assert from "node:assert/strict";
import { withTelegramRetry } from "./withTelegramRetry.ts";
import { TelegramRateLimitError } from "./typedTelegramErrors.ts";

test("retries once on TelegramRateLimitError honouring retry_after", async () => {
  let calls = 0;
  const start = Date.now();
  await withTelegramRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TelegramRateLimitError(429, "Too Many Requests", 1);
    return "ok";
  });
  const elapsed = Date.now() - start;
  assert.equal(calls, 2);
  assert.ok(elapsed >= 900);
});

test("does not retry on second 429", async () => {
  let calls = 0;
  await assert.rejects(
    withTelegramRetry(async () => {
      calls += 1;
      throw new TelegramRateLimitError(429, "Too Many Requests", 0);
    }),
    TelegramRateLimitError,
  );
  assert.equal(calls, 2);
});
