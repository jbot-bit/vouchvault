import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLearnedRemoveCallback,
  buildLookupExpandCallback,
  buildLookupNegCallback,
  buildRemoveEntryCancelCallback,
  buildRemoveEntryConfirmCallback,
  buildReviewDeleteCallback,
  buildReviewKeepCallback,
  parseLearnedRemoveCallback,
  parseLookupExpandCallback,
  parseLookupNegCallback,
} from "./archive.ts";

// Telegram caps callback_data at 64 bytes UTF-8. Any new callback prefix
// must be added here to keep the ceiling check honest.
const KNOWN_CALLBACKS: string[] = [
  // Worst-case: 32-char username (Telegram max) — the longest payload.
  buildLookupExpandCallback("a".repeat(32)),
  buildLookupExpandCallback("bobbiz"),
  buildLookupNegCallback("a".repeat(32)),
  buildLookupNegCallback("bobbiz"),
  // Worst-case entry id: 32-bit signed int max ≈ 10 chars.
  buildRemoveEntryConfirmCallback(2147483647),
  buildRemoveEntryCancelCallback(2147483647),
  // Review-queue ids: bigserial; bound the same way.
  buildReviewDeleteCallback(2147483647),
  buildReviewKeepCallback(2147483647),
  // Learned-phrase ids: bigserial; same bound.
  buildLearnedRemoveCallback(2147483647),
];

test("every callback data string is <= 64 bytes", () => {
  for (const cb of KNOWN_CALLBACKS) {
    const bytes = Buffer.byteLength(cb, "utf8");
    assert.ok(bytes <= 64, `${cb} is ${bytes} bytes`);
  }
});

test("lookup-expand callback round-trips username (lowercase, @-stripped)", () => {
  const cb = buildLookupExpandCallback("@BobBiz");
  assert.equal(cb, "lk:a:bobbiz");
  assert.equal(parseLookupExpandCallback(cb), "bobbiz");
});

test("lookup-neg callback round-trips username", () => {
  const cb = buildLookupNegCallback("@CoastContra");
  assert.equal(cb, "lk:n:coastcontra");
  assert.equal(parseLookupNegCallback(cb), "coastcontra");
});

test("parseLookupExpandCallback rejects invalid payloads", () => {
  assert.equal(parseLookupExpandCallback("lk:a:"), null);
  assert.equal(parseLookupExpandCallback("lk:a:bad-username"), null);
  assert.equal(parseLookupExpandCallback("lk:a:abc"), null); // too short
  assert.equal(parseLookupExpandCallback("not-our-prefix"), null);
  // NEG-callback shouldn't parse as expand (and vice versa).
  assert.equal(parseLookupExpandCallback("lk:n:bobbiz"), null);
});

test("parseLookupNegCallback rejects invalid payloads", () => {
  assert.equal(parseLookupNegCallback("lk:n:"), null);
  assert.equal(parseLookupNegCallback("lk:n:bad-username"), null);
  assert.equal(parseLookupNegCallback("lk:a:bobbiz"), null);
});

test("learned-remove callback round-trips id and rejects junk", () => {
  const cb = buildLearnedRemoveCallback(42);
  assert.equal(cb, "lp:rm:42");
  assert.equal(parseLearnedRemoveCallback(cb), 42);
  assert.equal(parseLearnedRemoveCallback("lp:rm:"), null);
  assert.equal(parseLearnedRemoveCallback("lp:rm:abc"), null);
  assert.equal(parseLearnedRemoveCallback("lp:rm:-1"), null);
  assert.equal(parseLearnedRemoveCallback("rq:d:42"), null);
});
