import test from "node:test";
import assert from "node:assert/strict";

import {
  normalize,
  findHits,
  decideStrikeAction,
  MUTE_DURATION_HOURS,
  STRIKE_DECAY_DAYS,
  PHRASES,
} from "./chatModerationLexicon.ts";

// ---- Normaliser ----

test("normalize: lowercases", () => {
  assert.equal(normalize("PM Me"), "pm me");
});

test("normalize: decodes leet substitutions", () => {
  assert.equal(normalize("p1ck up"), "pick up");
  assert.equal(normalize("h1t m3 up"), "hit me up");
  assert.equal(normalize("$ell"), "sell");
});

test("normalize: single intra-word punctuation between letters strips (anti-evasion)", () => {
  // The first non-space punctuation run between two letters is stripped
  // so "p.m. me" → "pm me", catching the phrase 'pm me' even when the
  // evader put a dot inside 'pm'.
  assert.equal(normalize("p.m. me"), "pm me");
  assert.equal(normalize("p-m me"), "pm me");
  // For multi-separator inputs like "p_m_me", only the first underscore
  // strips (single iteration). The remaining underscore becomes a
  // space in Pass B → "pm me", which still matches the lexicon.
  assert.equal(normalize("p_m_me"), "pm me");
  assert.equal(normalize("p-m-me"), "pm me");
});

test("normalize: word-boundary spaces are preserved", () => {
  // Plain space-separated phrases pass through cleanly.
  assert.equal(normalize("PM Me"), "pm me");
  assert.equal(normalize("hit me up"), "hit me up");
});

test("normalize: collapses whitespace and trims", () => {
  assert.equal(normalize("   hit    me     up   "), "hit me up");
});

// ---- findHits ----

test("findHits: matches a literal phrase", () => {
  const r = findHits("hey pm me about that");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "phrase");
});

test("findHits: matches phrase after leet normalisation", () => {
  const r = findHits("p.m. m3 about that");
  assert.equal(r.matched, true);
});

test("findHits: rejects 'pm me' inside 'welcompm me' (word boundary)", () => {
  const r = findHits("welcompm me to the group");
  assert.equal(r.matched, false);
});

test("findHits: passes unrelated chat", () => {
  const r = findHits("the surf was good today");
  assert.equal(r.matched, false);
});

test("findHits: regex matches against original text", () => {
  const r = findHits("call me on +61 412 345 678");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_phone");
});

test("findHits: catches t.me/+ invite splatter", () => {
  const r = findHits("join at t.me/+abcDEF123");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_tme_invite");
});

test("findHits: catches a BTC address", () => {
  const r = findHits("send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_crypto_wallet");
});

test("findHits: catches an email", () => {
  const r = findHits("contact me at foo@bar.com");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_email");
});

test("findHits: empty input doesn't match", () => {
  assert.equal(findHits("").matched, false);
});

// ---- decideStrikeAction ----

test("decideStrikeAction: 1 → warn", () => {
  assert.deepEqual(decideStrikeAction(1), { kind: "warn" });
});

test("decideStrikeAction: 2 → 24h mute", () => {
  assert.deepEqual(decideStrikeAction(2), {
    kind: "mute",
    durationHours: MUTE_DURATION_HOURS,
  });
});

test("decideStrikeAction: 3+ → ban", () => {
  assert.deepEqual(decideStrikeAction(3), { kind: "ban" });
  assert.deepEqual(decideStrikeAction(99), { kind: "ban" });
});

test("decideStrikeAction: count < 1 throws", () => {
  assert.throws(() => decideStrikeAction(0));
});

// ---- PHRASES shape ----

test("PHRASES non-empty, lowercase, alphabetised", () => {
  assert.ok(PHRASES.length > 0);
  for (const p of PHRASES) {
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0);
    assert.equal(p, p.toLowerCase());
  }
  const sorted = [...PHRASES].sort();
  assert.deepEqual(
    [...PHRASES],
    sorted,
    "PHRASES must be alphabetised for diff readability",
  );
});

test("PHRASES contains no known false-positive vocabulary", () => {
  // Suncoast V3 uses these in normal social chat per the empirical scan.
  // If any leak into PHRASES, members will be falsely flagged.
  const FALSE_POSITIVE_GUARD = [
    "bud", "fire", "k", "mdma", "pingas", "caps",
    "weed", "kush", "molly", "xan", "tabs", "acid",
    "ket", "coke", "meth",
  ];
  for (const fp of FALSE_POSITIVE_GUARD) {
    assert.ok(
      !PHRASES.includes(fp),
      `PHRASES must not contain false-positive vocab '${fp}' — see spec §4.1`,
    );
  }
});

test("constants drift guard", () => {
  assert.equal(STRIKE_DECAY_DAYS, 30);
  assert.equal(MUTE_DURATION_HOURS, 24);
});
