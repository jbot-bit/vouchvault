import test from "node:test";
import assert from "node:assert/strict";

import { buildProfileText } from "./archive.ts";

test("profile shows Caution when hasCaution is true and not frozen", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 3, mixed: 0, negative: 1 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Status: Caution/);
});

test("profile member view hides the Negative count", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 3, mixed: 0, negative: 1 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Positive: 3/);
  assert.match(text, /Mixed: 0/);
  // Negative count must not appear anywhere in the member-visible profile.
  assert.equal(text.includes("Negative"), false);
});

test("Frozen wins over Caution and renders enum label", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 0, mixed: 0, negative: 1 },
    isFrozen: true,
    freezeReason: "community_concerns",
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Status: Frozen — <i>community concerns<\/i>/);
  assert.equal(text.includes("Status: Caution"), false);
});

test("status falls back to Active when no NEG and not frozen", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 2, mixed: 1, negative: 0 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: false,
  });
  assert.match(text, /Status: Active/);
});

test("recent entries with negative result are filtered out of the member view", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 1, mixed: 0, negative: 2 },
    isFrozen: false,
    freezeReason: null,
    recent: [
      { id: 10, result: "positive", createdAt: new Date("2026-04-01T00:00:00Z") },
      { id: 11, result: "negative", createdAt: new Date("2026-04-02T00:00:00Z") },
      { id: 12, result: "negative", createdAt: new Date("2026-04-03T00:00:00Z") },
    ],
    hasCaution: true,
  });
  assert.match(text, /<b>#10<\/b>/);
  assert.equal(text.includes("#11"), false, "NEG #11 leaked into member view");
  assert.equal(text.includes("#12"), false, "NEG #12 leaked into member view");
});
