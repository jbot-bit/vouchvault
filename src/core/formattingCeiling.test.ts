import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFrozenListText,
  buildLookupText,
} from "./archive.ts";

test("lookup truncates to <= 4096 chars with …and N more.", () => {
  const entries = Array.from({ length: 100 }).map((_, i) => ({
    id: i,
    reviewerUsername: "alice_" + i,
    result: "positive" as const,
    tags: ["good_comms" as const, "efficient" as const],
    createdAt: new Date(),
  }));
  const text = buildLookupText({
    targetUsername: "bob_target",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 100, positive: 100, mixed: 0, negative: 0 },
    entries,
    mode: "all",
  });
  assert.ok(text.length <= 4096);
  assert.match(text, /…and \d+ more\./);
});

test("frozen_list stays under <= 4096 chars even with 50 long-reason rows", () => {
  // 10-row visible cap × 200-char max reason ≈ 2500 chars; well under.
  // The ceiling wrapper still runs to defend against future label growth.
  const rows = Array.from({ length: 50 }).map((_, i) => ({
    username: `frozen_user_${i}`,
    freezeReason: "x".repeat(200),
    frozenAt: new Date(Date.UTC(2026, 3, 5, 12)),
  }));
  const text = buildFrozenListText(rows);
  assert.ok(text.length <= 4096);
  // Visible cap of 10 rows still applies, so the rest goes into the
  // "…and N more — refine with /lookup @x" footer (or, if the cap pass
  // truncates further, the generic …and N more. footer from withCeiling).
  assert.match(text, /…and \d+ more/);
});

test("lookup leaves short lists untouched (no ellipsis line)", () => {
  const entries = [
    {
      id: 1,
      reviewerUsername: "alice",
      result: "positive" as const,
      tags: ["good_comms" as const],
      createdAt: new Date(),
    },
  ];
  const text = buildLookupText({
    targetUsername: "bob",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    entries,
  });
  assert.doesNotMatch(text, /…and \d+ more\./);
});
