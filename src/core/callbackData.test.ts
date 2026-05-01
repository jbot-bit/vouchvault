import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLookupExpandCallback, parseLookupExpandCallback } from "./archive.ts";

// Telegram caps callback_data at 64 bytes UTF-8. Any new callback prefix
// must be added here to keep the ceiling check honest.
const KNOWN_CALLBACKS: string[] = [
  // Worst-case: 32-char username (Telegram max) — the longest payload.
  buildLookupExpandCallback("a".repeat(32)),
  buildLookupExpandCallback("bobbiz"),
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

test("parseLookupExpandCallback rejects invalid payloads", () => {
  assert.equal(parseLookupExpandCallback("lk:a:"), null);
  assert.equal(parseLookupExpandCallback("lk:a:bad-username"), null);
  assert.equal(parseLookupExpandCallback("lk:a:abc"), null); // too short
  assert.equal(parseLookupExpandCallback("not-our-prefix"), null);
});
