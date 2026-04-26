import test from "node:test";
import assert from "node:assert/strict";

import { validatePrivateNote, MAX_PRIVATE_NOTE_CHARS } from "./archive.ts";

test("rejects empty / whitespace-only", () => {
  assert.deepEqual(validatePrivateNote(""), { ok: false, reason: "empty" });
  assert.deepEqual(validatePrivateNote("   "), { ok: false, reason: "empty" });
  assert.deepEqual(validatePrivateNote("\n\t"), { ok: false, reason: "empty" });
});

test("rejects > MAX_PRIVATE_NOTE_CHARS", () => {
  const long = "x".repeat(MAX_PRIVATE_NOTE_CHARS + 1);
  assert.deepEqual(validatePrivateNote(long), { ok: false, reason: "too_long" });
});

test("accepts exactly MAX_PRIVATE_NOTE_CHARS", () => {
  const ok = "y".repeat(MAX_PRIVATE_NOTE_CHARS);
  assert.deepEqual(validatePrivateNote(ok), { ok: true, value: ok });
});

test("rejects ASCII control chars (other than newline / tab)", () => {
  assert.deepEqual(validatePrivateNote("a\x01b"), {
    ok: false,
    reason: "control_chars",
  });
  assert.deepEqual(validatePrivateNote("a\x7fb"), {
    ok: false,
    reason: "control_chars",
  });
});

test("preserves newlines and tabs", () => {
  const value = "line1\nline2\tend";
  assert.deepEqual(validatePrivateNote(value), { ok: true, value });
});

test("trims surrounding whitespace before validating length", () => {
  // Trim prevents trailing-whitespace games from inflating length, and
  // returns the trimmed value for storage.
  const padded = "  hello  ";
  assert.deepEqual(validatePrivateNote(padded), { ok: true, value: "hello" });
});
