import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenBucket } from "./tokenBucket.ts";

test("token bucket waits the configured interval between takes", async () => {
  const intervalMs = 100;
  const bucket = createTokenBucket(intervalMs);
  const start = Date.now();
  await bucket.take();
  await bucket.take();
  await bucket.take();
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed >= 2 * intervalMs - 10,
    `expected >= ${2 * intervalMs - 10}, got ${elapsed}`,
  );
});

test("first take is immediate", async () => {
  const bucket = createTokenBucket(500);
  const start = Date.now();
  await bucket.take();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `first take should be near-instant, got ${elapsed}`);
});
