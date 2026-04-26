import test from "node:test";
import assert from "node:assert/strict";

import {
  FREEZE_REASONS,
  FREEZE_REASON_LABELS,
  isFreezeReason,
} from "./archive.ts";

test("FREEZE_REASONS contains exactly the five enum keys", () => {
  assert.deepEqual([...FREEZE_REASONS].sort(), [
    "at_member_request",
    "community_concerns",
    "policy_violation",
    "under_review",
    "unmet_commitments",
  ]);
});

test("isFreezeReason accepts each key", () => {
  for (const k of FREEZE_REASONS) {
    assert.equal(isFreezeReason(k), true, k);
  }
});

test("isFreezeReason rejects free-text and case variants", () => {
  for (const bad of [
    "scammer",
    "took my money",
    "",
    "POLICY_VIOLATION",
    null,
    undefined,
  ]) {
    assert.equal(isFreezeReason(bad as string | null | undefined), false, String(bad));
  }
});

test("FREEZE_REASON_LABELS provides a human label for every key", () => {
  for (const k of FREEZE_REASONS) {
    const label = FREEZE_REASON_LABELS[k];
    assert.ok(label && label.length > 0, `missing label for ${k}`);
    // Labels should be human-readable (no underscores).
    assert.equal(label.includes("_"), false, `label for ${k} should not contain underscores: ${label}`);
  }
});
