import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_VOUCH_PROSE_CHARS,
  buildVouchProseRejectionText,
  classifyVouchProseMessage,
  validateVouchProse,
} from "./archive.ts";

// ---- validateVouchProse ----

test("validateVouchProse: trimmed value returned on ok", () => {
  const r = validateVouchProse("  Solid bloke, smooth pickup.  ");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, "Solid bloke, smooth pickup.");
});

test("validateVouchProse: empty / whitespace-only rejected", () => {
  for (const input of ["", "   ", "\n\n\t  "]) {
    const r = validateVouchProse(input);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "empty");
  }
});

test("validateVouchProse: 800 chars accepted; 801 rejected", () => {
  const eighthundred = "a".repeat(800);
  assert.equal(validateVouchProse(eighthundred).ok, true);
  const eight01 = "a".repeat(801);
  const r = validateVouchProse(eight01);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_long");
});

test("validateVouchProse: control chars rejected (but \\n and \\t allowed)", () => {
  // Newlines and tabs are normal vouch text shapes.
  assert.equal(validateVouchProse("Line 1\nLine 2\tindent").ok, true);
  // Other C0 controls are evasion / leakage.
  for (const ch of ["\x00", "\x01", "\x07", "\x1B", "\x7F"]) {
    const r = validateVouchProse(`bad${ch}text`);
    assert.equal(r.ok, false, `expected reject for ${ch.charCodeAt(0)}`);
    if (!r.ok) assert.equal(r.reason, "control_chars");
  }
});

test("MAX_VOUCH_PROSE_CHARS is 800", () => {
  assert.equal(MAX_VOUCH_PROSE_CHARS, 800);
});

// ---- classifyVouchProseMessage ----

test("classifyVouchProseMessage: plain text → text", () => {
  const r = classifyVouchProseMessage({ text: "hello" });
  assert.equal(r.kind, "text");
  if (r.kind === "text") assert.equal(r.text, "hello");
});

test("classifyVouchProseMessage: photo / sticker / voice / video / etc. → non_text", () => {
  const cases = [
    { photo: [{}] },
    { sticker: {} },
    { voice: {} },
    { video: {} },
    { video_note: {} },
    { animation: {} },
    { audio: {} },
    { document: {} },
    { contact: {} },
    { location: {} },
    { poll: {} },
    // A photo sent with caption: caption fires non_text too because it
    // means the user sent media.
    { caption: "look at this", photo: [{}] },
  ];
  for (const m of cases) {
    const r = classifyVouchProseMessage(m as any);
    assert.equal(r.kind, "non_text", `expected non_text for ${JSON.stringify(m)}`);
  }
});

test("classifyVouchProseMessage: text with formatting entities → has_entities", () => {
  const r = classifyVouchProseMessage({
    text: "**bold**",
    entities: [{ type: "bold", offset: 0, length: 8 }],
  });
  assert.equal(r.kind, "has_entities");
});

test("classifyVouchProseMessage: text with empty entities array → text", () => {
  const r = classifyVouchProseMessage({ text: "hello", entities: [] });
  assert.equal(r.kind, "text");
});

test("classifyVouchProseMessage: missing text field → non_text", () => {
  const r = classifyVouchProseMessage({});
  assert.equal(r.kind, "non_text");
});

// ---- buildVouchProseRejectionText ----

test("buildVouchProseRejectionText: each branch produces a non-empty locked string", () => {
  const reasons = ["empty", "too_long", "control_chars", "non_text", "has_entities"] as const;
  const messages = new Set<string>();
  for (const reason of reasons) {
    const text = buildVouchProseRejectionText(reason);
    assert.ok(text.length > 0);
    assert.ok(!messages.has(text), `duplicate message for reason=${reason}`);
    messages.add(text);
  }
});

test("buildVouchProseRejectionText: too_long mentions the 800-char cap", () => {
  const text = buildVouchProseRejectionText("too_long");
  assert.match(text, /800 characters/);
});
