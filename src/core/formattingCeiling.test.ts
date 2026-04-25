import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLookupText, buildRecentEntriesText } from "./archive.ts";

test("lookup truncates to <= 4096 chars with …and N more.", () => {
  const entries = Array.from({ length: 100 }).map((_, i) => ({
    id: i,
    reviewerUsername: "alice_" + i,
    result: "positive" as const,
    tags: ["good_comms" as const, "efficient" as const],
    createdAt: new Date(),
  }));
  const text = buildLookupText({ targetUsername: "bob_target", entries });
  assert.ok(text.length <= 4096);
  assert.match(text, /…and \d+ more\./);
});

test("recent entries truncates to <= 4096 chars with …and N more.", () => {
  const entries = Array.from({ length: 100 }).map((_, i) => ({
    id: i,
    reviewerUsername: "alice_" + i,
    targetUsername: "bob_" + i,
    entryType: "service" as const,
    result: "positive" as const,
    createdAt: new Date(),
  }));
  const text = buildRecentEntriesText(entries);
  assert.ok(text.length <= 4096);
  assert.match(text, /…and \d+ more\./);
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
  const text = buildLookupText({ targetUsername: "bob", entries });
  assert.doesNotMatch(text, /…and \d+ more\./);
});
