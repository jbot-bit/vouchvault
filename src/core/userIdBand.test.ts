import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyUserIdBand,
  LIKELY_OLD_MAX_ID,
  LIKELY_NEW_MIN_ID,
} from "./userIdBand.ts";

test("classifyUserIdBand returns 'unknown' for any positive integer when thresholds unset", () => {
  // Both threshold constants are null until empirical data lands.
  assert.equal(LIKELY_OLD_MAX_ID, null);
  assert.equal(LIKELY_NEW_MIN_ID, null);

  for (const id of [1, 1_000, 100_000_000, 7_853_873_030, 9_999_999_999]) {
    assert.equal(classifyUserIdBand(id), "unknown", `id=${id}`);
  }
});

test("classifyUserIdBand returns 'unknown' for non-positive or non-safe-integer input", () => {
  assert.equal(classifyUserIdBand(0), "unknown");
  assert.equal(classifyUserIdBand(-1), "unknown");
  assert.equal(classifyUserIdBand(Number.NaN), "unknown");
  assert.equal(classifyUserIdBand(Number.POSITIVE_INFINITY), "unknown");
  assert.equal(classifyUserIdBand(1.5), "unknown");
});
