import test from "node:test";
import assert from "node:assert/strict";

import {
  findHitInPhrases,
  findHits,
  normalize,
  validateLearnedPhrase,
} from "./chatModerationLexicon.ts";

// ---- validateLearnedPhrase ----

test("validate: accepts a normal phrase and normalises it", () => {
  const r = validateLearnedPhrase("Snap Me ");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.normalized, "snap me");
    assert.equal(r.raw, "Snap Me");
  }
});

test("validate: rejects under-4-char normalised forms (over-match guard)", () => {
  const r = validateLearnedPhrase("abc");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_short");
});

test("validate: rejects digit-only inputs that don't leet-decode to letters", () => {
  // The LEET_MAP turns 0/1/3/4/5/7/8 into letters, so a digit-only
  // string can survive validation if it contains those. Use 2/6/9
  // exclusively to land in the no_letters branch.
  const r = validateLearnedPhrase("2629");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "no_letters");
});

test("validate: rejects too-broad phrases — no token has 3+ letters", () => {
  // "ab cd" is 5 chars, has letters, but every token is 2 letters.
  // Would over-match in normal chat. The static lexicon contains
  // similar short phrases ("pm me", "wtb") but those went through an
  // empirical FP gate; user-added ones haven't.
  const r = validateLearnedPhrase("ab cd");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_broad");
  // "pm me" likewise: both tokens are 2 letters.
  const r2 = validateLearnedPhrase("pm me");
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, "too_broad");
});

test("validate: accepts phrases where at least one token has 3+ letters", () => {
  // "snap me" — "snap" is 4 letters → passes.
  const r = validateLearnedPhrase("snap me");
  assert.equal(r.ok, true);
  // Single 4-letter token also passes.
  const r2 = validateLearnedPhrase("abcd");
  assert.equal(r2.ok, true);
});

// ---- Edge cases on normalisation that the validator inherits ----

test("validate: case-insensitive — uppercase/lowercase produce the same normalised form", () => {
  const a = validateLearnedPhrase("SNAP ME");
  const b = validateLearnedPhrase("snap me");
  const c = validateLearnedPhrase("Snap Me");
  assert.equal(a.ok && b.ok && c.ok, true);
  if (a.ok && b.ok && c.ok) {
    assert.equal(a.normalized, b.normalized);
    assert.equal(b.normalized, c.normalized);
  }
});

test("validate: strips emojis, smart quotes, and unicode noise via normalize", () => {
  // Emojis, curly quotes, and other non-ASCII non-alphanumerics get
  // collapsed to spaces by normalize's `[^a-z0-9]+` pass.
  const r = validateLearnedPhrase("🔥 snap me 🔥");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalized, "snap me");
  const q = validateLearnedPhrase("“snap me”");
  assert.equal(q.ok, true);
  if (q.ok) assert.equal(q.normalized, "snap me");
});

test("validate: trims surrounding whitespace + collapses internal runs", () => {
  const r = validateLearnedPhrase("   snap     me   ");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalized, "snap me");
});

test("validate: leading/trailing punctuation is normalised away, not counted", () => {
  // "!!!snap me!!!" → after normalise → "snap me" → still valid.
  const r = validateLearnedPhrase("!!!snap me!!!");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalized, "snap me");
});

// ---- findHitInPhrases inherits case + leet handling ----

test("findHitInPhrases: case-insensitive (normalize lowercases on both sides)", () => {
  const phrases = [normalize("Snap Me")];
  assert.equal(findHitInPhrases("HEY SNAP ME ABOUT IT", phrases).matched, true);
});

test("validate: rejects raw input over 120 chars", () => {
  const r = validateLearnedPhrase("a".repeat(121));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_long");
});

test("validate: leet-decodes during normalisation", () => {
  const r = validateLearnedPhrase("h1t m3 up");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalized, "hit me up");
});

// ---- findHitInPhrases ----

test("findHitInPhrases: matches a normalised phrase with word boundaries", () => {
  const phrases = ["snap me"];
  const hit = findHitInPhrases("hey snap me about it", phrases);
  assert.equal(hit.matched, true);
  if (hit.matched) assert.equal(hit.phrase, "snap me");
});

test("findHitInPhrases: respects word boundaries (no substring matches)", () => {
  const phrases = ["snap me"];
  const hit = findHitInPhrases("snapmessages are weird", phrases);
  assert.equal(hit.matched, false);
});

test("findHitInPhrases: matches after leet normalisation", () => {
  const phrases = ["snap me"];
  const hit = findHitInPhrases("$nap m3 plz", phrases);
  assert.equal(hit.matched, true);
});

test("findHitInPhrases: empty phrase list = no match", () => {
  assert.equal(findHitInPhrases("anything goes", []).matched, false);
});

test("findHitInPhrases: skips empty phrase entries safely", () => {
  const hit = findHitInPhrases("hello", ["", "hello"]);
  assert.equal(hit.matched, true);
});

// ---- Integration: a learned phrase complements the static lexicon ----

test("a phrase missed by static findHits can be caught by learned phrases", () => {
  // Pick a benign-shape phrase that the static lexicon does not match
  // (sanity: this test would fail if PHRASES gained "purple drink" in
  // the future — flip the example then).
  const text = "purple drink available now";
  assert.equal(findHits(text).matched, false);
  const learned = [normalize("purple drink")];
  const hit = findHitInPhrases(text, learned);
  assert.equal(hit.matched, true);
});
