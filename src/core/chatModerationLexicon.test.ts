import test from "node:test";
import assert from "node:assert/strict";

import { findHits } from "./chatModerationLexicon.ts";

// Compound rule (KB:F2.18 variant B): BUY_STEM + drug + SOLICIT_CONTACT_CTA
// must all be present in the same message. Existing PHRASES / REGEX tests
// live in chatModeration.test.ts; this file exercises the compound pass.

test("compound: ≥10 QLD Chasing solicitation samples match", () => {
  const samples = [
    "anyone chasing some bud, pm me",
    "who's got carts? hmu",
    "looking for press pills, dm me",
    "need some ket pm me asap",
    "wtb gas, hit me up",
    "after some shrooms, inbox me",
    "anyone selling weed pm me",
    "chasing pingers message me",
    "who can sort an oz, pm me",
    "looking for caps tonight, hmu",
    "need a gram of coke, dm me",
    "anyone got tabs, pm me",
  ];
  for (const text of samples) {
    const r = findHits(text);
    assert.equal(r.matched, true, `expected match for: ${text}`);
  }
});

test("compound: ≥10 TBC26-style vouch / chat samples do NOT match the compound rule", () => {
  // These are TBC26-shape utterances that should not trip variant B.
  // Some may match other lexicon rules (e.g. "pm me" by itself) — that
  // is the existing baseline. The point of this test is that the
  // *compound* rule alone (drug-stem proximity + CTA) does not fire on
  // legitimate TBC26-flavoured speech that lacks drug-stem proximity.
  const samples = [
    "good comms, would deal again",
    "smooth pickup, no issues",
    "anyone able to vouch for this guy",
    "the vouch system is great",
    "I gave a vouch yesterday",
    "fast turnaround, recommend",
    "thanks mate, top bloke",
    "all good my end",
    "anyone here from brisbane",
    "weather was wild last night",
    "got home safe, cheers",
    "discussion only, no shilling please",
  ];
  for (const text of samples) {
    const r = findHits(text);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "compound_buy_solicit",
        `compound rule should not fire for: ${text} (got ${r.source})`,
      );
    }
  }
});

test("compound: BUY_STEM alone (no contact CTA) does not match the compound rule", () => {
  // "anyone chasing bud" without a CTA should not fire the compound rule.
  // The combination is the discriminator.
  const r = findHits("anyone chasing some bud tonight");
  if (r.matched) {
    assert.notEqual(
      r.source,
      "compound_buy_solicit",
      "compound should require both BUY_STEM and contact CTA",
    );
  }
});

test("compound: contact CTA alone (no BUY_STEM/drug) does not match the compound rule", () => {
  // A "dm me" mention with no buy-stem + drug should match phrase 'dm me'
  // (existing rule) but NOT the compound rule.
  const r = findHits("dm me about the meetup time");
  // Existing phrase rule may still fire; we only assert that the source
  // is not the compound one.
  if (r.matched) {
    assert.notEqual(
      r.source,
      "compound_buy_solicit",
      "compound should require both BUY_STEM and contact CTA",
    );
  }
});

test("compound: source tag is 'compound_buy_solicit' (marginal)", () => {
  // Use a buy stem ("looking for") that's in BUY_STEM but NOT in the
  // newer anyone_buyverb regex prefix-set, plus a CTA ("dm") that's
  // not a literal phrase. This is the marginal attribution path —
  // compound is the unique contributor.
  const r = findHits("looking for some carts dm");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "compound_buy_solicit");
});
