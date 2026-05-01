import test from "node:test";
import assert from "node:assert/strict";

import {
  CALLBACK_INTERVAL_MS,
  createLookupRateLimiter,
  LOOKUP_INTERVAL_MS,
  memberCallbackLimiter,
  memberLookupLimiter,
} from "./lookupRateLimit.ts";

test("memberCallbackLimiter is a separate instance from memberLookupLimiter", () => {
  // Independence check: consuming the search bucket must not consume
  // the callback bucket. Otherwise a member rate-limited on /search
  // can't tap their own /forgetme cancel button.
  const userId = 4242;
  memberLookupLimiter.reset(userId);
  memberCallbackLimiter.reset(userId);

  assert.equal(memberLookupLimiter.tryConsume(userId).allowed, true);
  // memberLookupLimiter is now blocked for this user; memberCallbackLimiter
  // must still allow.
  assert.equal(memberLookupLimiter.tryConsume(userId).allowed, false);
  assert.equal(memberCallbackLimiter.tryConsume(userId).allowed, true);

  memberLookupLimiter.reset(userId);
  memberCallbackLimiter.reset(userId);
});

test("CALLBACK_INTERVAL_MS is tighter than LOOKUP_INTERVAL_MS (taps are cheaper than searches)", () => {
  assert.ok(
    CALLBACK_INTERVAL_MS < LOOKUP_INTERVAL_MS,
    `expected callback interval (${CALLBACK_INTERVAL_MS}) < lookup interval (${LOOKUP_INTERVAL_MS})`,
  );
});

test("rate limiter: a hammer-the-button burst is rejected after the first allowed", () => {
  const limiter = createLookupRateLimiter(2_000);
  const u = 1;
  const now = 1_000_000;

  // First tap allowed.
  assert.equal(limiter.tryConsume(u, now).allowed, true);
  // 9 rapid taps within the window all rejected.
  for (let i = 1; i <= 9; i++) {
    const r = limiter.tryConsume(u, now + i);
    assert.equal(r.allowed, false, `tap ${i} should have been rejected`);
  }
  // After the window, a tap is allowed again.
  assert.equal(limiter.tryConsume(u, now + 2_000 + 1).allowed, true);
});

test("rate limiter is per-user, not global", () => {
  const limiter = createLookupRateLimiter(5_000);
  const now = 1_000_000;
  // user A consumes their slot.
  assert.equal(limiter.tryConsume(1, now).allowed, true);
  assert.equal(limiter.tryConsume(1, now).allowed, false);
  // user B's slot is independent.
  assert.equal(limiter.tryConsume(2, now).allowed, true);
});
