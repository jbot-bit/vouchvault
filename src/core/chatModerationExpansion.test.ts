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

// ---- v2 lexicon expansion (2026-05) ----

test("phrases v2: stock/menu/price-list shapes fire", () => {
  for (const sample of [
    "menu attached for tonight",
    "menu in dm if anyone wants",
    "stock list dropping soon",
    "prices in pm",
    "got the price list ready",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases v2: open-for-business / DMs-open shapes fire", () => {
  for (const sample of [
    "dms open tonight",
    "inbox open for orders",
    "open for biz this weekend",
    "open for business now",
    "back of pm for menu",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases v2: off-platform comm-handle asks fire", () => {
  for (const sample of [
    "got insta",
    "got your snap",
    "got kik handle",
    "got wickr details",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("phrases v2: off-platform payment shapes fire", () => {
  for (const sample of [
    "cash app me later",
    "venmo me $50",
    "paypal me the rest",
    "btc only please",
    "crypto only no cash",
    "monero only",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex v2: numeric quantity request fires", () => {
  for (const sample of [
    "need 1g tonight",
    "after 3.5g",
    "chasing 7g",
    "wtb half oz",
    "cop a teener",
    "need an eighth",
    "grabbing 2 caps",
    "need 5 tabs",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex v2: numeric quantity does NOT fire on benign requests", () => {
  for (const sample of [
    "need 5 minutes to think",
    "after 2 hours of waiting",
    "chasing 100 followers",
    "grabbing some food later",
    "need the docs",
  ]) {
    const r = findHits(sample);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "regex_buy_numeric_quantity",
        `buy_numeric_quantity should not fire for: ${sample}`,
      );
    }
  }
});

test("regex v2: open_for_biz fires", () => {
  for (const sample of [
    "DMs open",
    "DM's open right now",
    "inbox is open",
    "pms open",
    "open for biz",
    "open for orders",
    "open for the night",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex v2: got_handle_request fires on non-Telegram handle asks", () => {
  for (const sample of [
    "got insta",
    "got an instagram",
    "got snap",
    "got ya snap",
    "got your kik",
    "got wickr",
    "got session",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex v2: got_handle_request does NOT fire on legit Telegram references", () => {
  for (const sample of [
    "got their telegram",
    "got @bobsmith on telegram",
  ]) {
    const r = findHits(sample);
    if (r.matched) {
      assert.notEqual(
        r.source,
        "regex_got_handle_request",
        `got_handle_request should not fire for: ${sample}`,
      );
    }
  }
});

test("regex v2: menu_shape fires on sales-catalogue language", () => {
  for (const sample of [
    "menu in dm",
    "menu drops at 7",
    "stock list available",
    "price list attached",
    "prices on request",
    "menu coming tonight",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("regex v2: offplatform_payment fires", () => {
  for (const sample of [
    "cash app me",
    "venmo only",
    "paypal preferred",
    "send via cashapp",
    "pay through venmo",
    "using zelle",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("compound v2: lmk + drug catches solicitation", () => {
  for (const sample of [
    "lmk if anyone has bud",
    "lmk who has tabs",
  ]) {
    const r = findHits(sample);
    assert.equal(r.matched, true, `expected match for: ${sample}`);
  }
});

test("baseline v2: extended legit chat still passes", () => {
  for (const sample of [
    "the menu was ten dollars",
    "got my insta password reset",
    "we cooked stock yesterday",
    "the price was fair",
    "after a long week, finally home",
    "anyone know what time the gym opens",
    "thanks for the recommendation",
  ]) {
    const r = findHits(sample);
    assert.equal(
      r.matched,
      false,
      `unexpected match for: ${sample} (${(r as any).source})`,
    );
  }
});
