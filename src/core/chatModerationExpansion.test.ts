import test from "node:test";
import assert from "node:assert/strict";

import { findHits, PHRASES } from "./chatModerationLexicon.ts";

// 2026-05 lexicon expansion. Each test below pins a specific
// sales/solicitation shape the bot was previously missing. If a future
// edit removes coverage for any of these, the failing test is the
// signal — re-add the pattern or document the regression in the spec.

test("phrases: 'anyone got/selling/holding' fire on the phrase pass", () => {
  for (const sample of [
    "anyone got something tonight",
    "anyone selling at the moment",
    "anyone holding right now",
    "any1 got anything good",
    "any1 selling tonight",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases: plug references fire", () => {
  for (const sample of [
    "any plug for tonight",
    "anyone got the plug",
    "need any plugs",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases: comm-channel solicitation fires (snap/kik/tox)", () => {
  for (const sample of [
    "snap me later",
    "kik me about it",
    "tox me a code",
    "matrix me when ready",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases: location/delivery shapes fire", () => {
  for (const sample of [
    "drop the loc when you're close",
    "drop loc please",
    "gotta drop spot for the meet",
    "free delivery this weekend",
    "delivery service tonight",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases: price/deal language fires", () => {
  for (const sample of [
    "any deals on tonight",
    "best price for a half",
    "going rate on the gas",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex: price+quantity shape fires", () => {
  for (const sample of [
    "$50 for a gram",
    "$200 oz tonight",
    "350 a qp delivered",
    "AUD$80 per eighth",
    "$25 cap",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
    if (r.matched) assert.equal(r.source, "regex_price_quantity");
  }
});

test("regex: price+quantity does not fire on plain prices without units", () => {
  for (const sample of [
    "ticket was $50 last night",
    "uber cost me 35 bucks",
    "phone bill is $200 a month",
  ]) {
    const r = findHits(sample);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "regex_price_quantity",
        `price_quantity should not fire for: ${sample}`,
      );
    }
  }
});

test("regex: comm_handle_share fires on snap/kik/tox handle drops", () => {
  for (const sample of [
    "snap: johnsmith42",
    "snap me at johnsmith42",
    "kik: jane_doe_99",
    "session id 05abc123def456",
    "tox = abcdef1234",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex: comm_handle_share does NOT fire on legit Telegram references", () => {
  for (const sample of [
    "DM @bobsmith on telegram",
    "find them on telegram @bobsmith",
    "this is a telegram bot",
  ]) {
    const r = findHits(sample);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "regex_comm_handle_share",
        `comm_handle_share should not fire for: ${sample}`,
      );
    }
  }
});

test("regex: anyone_buyverb fires without requiring a drug name", () => {
  for (const sample of [
    "anyone got something",
    "any1 selling tonight",
    "who's holding right now",
    "whos copping later",
    "any one chasing tonight",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex: got_any_supply fires on availability questions for drug nouns", () => {
  for (const sample of [
    "got any bud tonight",
    "got any tabs",
    "got any caps left",
    "got any blues",
    "got any dabs",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex: got_any does NOT fire on benign 'got any X' phrasings", () => {
  for (const sample of [
    "got any vouches for him",
    "got any plans tonight",
    "got any thoughts",
    "got any food",
    "got any update",
  ]) {
    const r = findHits(sample);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "regex_got_any_supply",
        `got_any_supply should not fire for: ${sample}`,
      );
    }
  }
});

test("compound: extended BUY_STEM verbs catch more solicitation shapes", () => {
  for (const sample of [
    "copping carts tonight, hmu",
    "scoring a gram, dm me",
    "tryna cop bud, pm me",
    "where can I get tabs, hit me up",
    "tryna find some ket, inbox me",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("compound: extended drug list (dabs/blow/heroin/etc.) catches expanded vocabulary", () => {
  for (const sample of [
    "anyone chasing dabs, pm me",
    "looking for blow, dm me",
    "need some heroin, hmu",
    "wtb edibles, hit me up",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("baseline: legit vouch chat still passes (no false positives on phrases added)", () => {
  // None of these should fire any rule. If one starts firing after a
  // future lexicon edit, it's a regression.
  for (const sample of [
    "thanks mate, smooth deal",
    "cheers, top bloke",
    "anyone here from sydney",
    "good morning legends",
    "the weather is wild",
    "got home safe last night",
    "this skill issue is real",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, false, `unexpected match for: ${sample} (${(r as any).source})`);
  }
});

test("PHRASES list: no duplicates after expansion", () => {
  const set = new Set(PHRASES.map((p) => p.toLowerCase()));
  assert.equal(set.size, PHRASES.length, "PHRASES has duplicates");
});
