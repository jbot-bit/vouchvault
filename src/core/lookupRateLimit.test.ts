import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLookupRateLimiter,
  LOOKUP_INTERVAL_MS,
} from "./lookupRateLimit.ts";

test("LOOKUP_INTERVAL_MS is 5 seconds", () => {
  assert.equal(LOOKUP_INTERVAL_MS, 5_000);
});

test("first call from a user is allowed", () => {
  const limiter = createLookupRateLimiter(1000);
  assert.deepEqual(limiter.tryConsume(1, 0), { allowed: true });
});

test("second call within the interval is denied with retryAfterMs", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  assert.deepEqual(limiter.tryConsume(1, 250), {
    allowed: false,
    retryAfterMs: 750,
  });
});

test("call exactly at interval boundary is allowed", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  assert.deepEqual(limiter.tryConsume(1, 1000), { allowed: true });
});

test("call after interval is allowed", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  assert.deepEqual(limiter.tryConsume(1, 1500), { allowed: true });
});

test("different users have independent buckets", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  assert.deepEqual(limiter.tryConsume(2, 0), { allowed: true });
});

test("reset(userId) clears just that user's bucket", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  limiter.tryConsume(2, 0);
  limiter.reset(1);
  assert.deepEqual(limiter.tryConsume(1, 100), { allowed: true });
  assert.deepEqual(limiter.tryConsume(2, 100), {
    allowed: false,
    retryAfterMs: 900,
  });
});

test("reset() with no arg clears all buckets", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  limiter.tryConsume(2, 0);
  limiter.reset();
  assert.deepEqual(limiter.tryConsume(1, 100), { allowed: true });
  assert.deepEqual(limiter.tryConsume(2, 100), { allowed: true });
});

test("burst-then-wait: 10 rapid calls denied, 11th after interval allowed", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  for (let t = 1; t < 1000; t += 100) {
    const result = limiter.tryConsume(1, t);
    assert.equal(result.allowed, false);
  }
  assert.deepEqual(limiter.tryConsume(1, 1100), { allowed: true });
});

test("namespaces are independent: dm + inline + group_lookup buckets do not share quota", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0, "dm");
  assert.deepEqual(limiter.tryConsume(1, 0, "inline"), { allowed: true });
  assert.deepEqual(limiter.tryConsume(1, 0, "group_lookup"), { allowed: true });
  assert.equal(limiter.tryConsume(1, 100, "dm").allowed, false);
});

test("default namespace is dm — backward compatible", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0);
  assert.equal(limiter.tryConsume(1, 100, "dm").allowed, false);
});

test("reset(userId, namespace) clears just that namespace bucket", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0, "dm");
  limiter.tryConsume(1, 0, "inline");
  limiter.reset(1, "dm");
  assert.equal(limiter.tryConsume(1, 100, "dm").allowed, true);
  assert.equal(limiter.tryConsume(1, 100, "inline").allowed, false);
});

test("reset(userId) without namespace clears all namespaces for that user", () => {
  const limiter = createLookupRateLimiter(1000);
  limiter.tryConsume(1, 0, "dm");
  limiter.tryConsume(1, 0, "inline");
  limiter.reset(1);
  assert.equal(limiter.tryConsume(1, 100, "dm").allowed, true);
  assert.equal(limiter.tryConsume(1, 100, "inline").allowed, true);
});
