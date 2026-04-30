import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_GLYPHS,
  detectForgery,
  hashCardBody,
  looksLikeCard,
  stripZeroWidth,
} from "./forgeryDetector.ts";

const OUR_BOT_ID = 12345;
const OTHER_BOT_ID = 99999;

function makeCard(target = "daveyboi", pos = 14, warn = 2): string {
  return [
    `${CARD_GLYPHS.board} @${target} ${CARD_GLYPHS.emDash} ${pos} ${CARD_GLYPHS.pos} ${CARD_GLYPHS.middot} ${warn} ${CARD_GLYPHS.warn} (16 over 8 months)`,
    "",
    `${CARD_GLYPHS.middot} 03/02/2026 @sarah_xx ${CARD_GLYPHS.emDash} "fast meet, top shelf" ${CARD_GLYPHS.pos}`,
    `${CARD_GLYPHS.middot} 19/01/2026 @mike_qld ${CARD_GLYPHS.emDash} "shorted me 0.3g" ${CARD_GLYPHS.warn}`,
  ].join("\n");
}

// ---- pure helpers ----

test("CARD_GLYPHS use the expected unicode codepoints", () => {
  assert.equal(CARD_GLYPHS.board, "\u{1F4CB}");
  assert.equal(CARD_GLYPHS.emDash, "—");
  assert.equal(CARD_GLYPHS.middot, "·");
  assert.equal(CARD_GLYPHS.pos, "✅");
  assert.equal(CARD_GLYPHS.warn, "⚠️");
});

test("stripZeroWidth removes ZWSP / ZWNJ / ZWJ / WJ / BOM", () => {
  const dirty = "a​b‌c‍d⁠e﻿f";
  assert.equal(stripZeroWidth(dirty), "abcdef");
});

test("hashCardBody is stable for identical bodies", () => {
  const a = hashCardBody("hello world");
  const b = hashCardBody("hello world");
  assert.equal(a, b);
  assert.equal(a.length, 16);
});

test("hashCardBody normalises zero-width injections", () => {
  const plain = hashCardBody("hello");
  const padded = hashCardBody("h​el‌lo");
  assert.equal(plain, padded);
});

test("looksLikeCard: real card matches", () => {
  assert.equal(looksLikeCard(makeCard()), true);
});

test("looksLikeCard: prose mention does not match", () => {
  assert.equal(
    looksLikeCard("via @VouchVaultBot is sick, lookups are quick"),
    false,
  );
});

test("looksLikeCard: header without bullets does not match", () => {
  const header = `${CARD_GLYPHS.board} @x ${CARD_GLYPHS.emDash} 1 ${CARD_GLYPHS.pos} ${CARD_GLYPHS.middot} 0 ${CARD_GLYPHS.warn}`;
  assert.equal(looksLikeCard(header), false);
});

test("looksLikeCard: missing board glyph short-circuits", () => {
  assert.equal(looksLikeCard("@daveyboi — 14 ✅ · 2 ⚠️"), false);
});

test("looksLikeCard: hyphen instead of em-dash does not match", () => {
  const sloppy = makeCard().replace(/—/g, "-");
  assert.equal(looksLikeCard(sloppy), false);
});

test("looksLikeCard: zero-width injection in header still detected", () => {
  const padded =
    `${CARD_GLYPHS.board}​ @daveyboi ${CARD_GLYPHS.emDash} 14 ${CARD_GLYPHS.pos} ${CARD_GLYPHS.middot} 2 ${CARD_GLYPHS.warn} (n)\n${CARD_GLYPHS.middot} 03/02/2026 @sarah ${CARD_GLYPHS.emDash} "x" ${CARD_GLYPHS.pos}`;
  assert.equal(looksLikeCard(padded), true);
});

test("looksLikeCard: null/undefined/empty input returns false", () => {
  assert.equal(looksLikeCard(null), false);
  assert.equal(looksLikeCard(undefined), false);
  assert.equal(looksLikeCard(""), false);
});

// ---- detectForgery ----

test("forge_from_blank: card body with no via_bot", () => {
  const v = detectForgery({
    message: { text: makeCard(), from: { id: 11, is_bot: false } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v?.kind, "forge_from_blank");
  assert.equal(typeof v?.contentHash, "string");
  assert.equal(v?.contentHash.length, 16);
});

test("real card: card body with via_bot.id === OUR_BOT_ID, not edited", () => {
  const v = detectForgery({
    message: {
      text: makeCard(),
      from: { id: 11, is_bot: false },
      via_bot: { id: OUR_BOT_ID },
    },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("edit_of_real_card: edited_message with via_bot.id === OUR_BOT_ID", () => {
  const v = detectForgery({
    message: {
      text: makeCard("daveyboi", 999, 0), // tampered counts
      from: { id: 11, is_bot: false },
      via_bot: { id: OUR_BOT_ID },
    },
    ourBotId: OUR_BOT_ID,
    kind: "edited_message",
  });
  assert.equal(v?.kind, "edit_of_real_card");
});

test("lookalike_bot: via_bot.id different from OUR_BOT_ID", () => {
  const v = detectForgery({
    message: {
      text: makeCard(),
      from: { id: 11, is_bot: false },
      via_bot: { id: OTHER_BOT_ID },
    },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v?.kind, "lookalike_bot");
  assert.match(v!.reason, /99999/);
});

test("bot-authored message (from.is_bot=true) is never flagged", () => {
  const v = detectForgery({
    message: { text: makeCard(), from: { id: 22, is_bot: true } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("self-bot (from.id === OUR_BOT_ID) is never flagged", () => {
  const v = detectForgery({
    message: { text: makeCard(), from: { id: OUR_BOT_ID, is_bot: false } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("non-card message is not flagged", () => {
  const v = detectForgery({
    message: { text: "just a normal vouch from a member", from: { id: 11 } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("prose mention of via @bot is not flagged", () => {
  const v = detectForgery({
    message: {
      text: "vouching @daveyboi, fast meet, ⚠️ careful with shorter packs",
      from: { id: 11 },
    },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("OUR_BOT_ID undefined → fail open (return null)", () => {
  const v = detectForgery({
    message: { text: makeCard(), from: { id: 11 } },
    ourBotId: undefined,
    kind: "message",
  });
  assert.equal(v, null);
});

test("zero-width-padded forgery is still detected", () => {
  const padded =
    "📋​ @daveyboi — 14 ✅ · 2 ⚠️ (16 over 8 months)\n· 03/02/2026 @sarah — \"fast\" ✅";
  const v = detectForgery({
    message: { text: padded, from: { id: 11 } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v?.kind, "forge_from_blank");
});

test("forwarded real card is not flagged (via_bot preserved)", () => {
  const v = detectForgery({
    message: {
      text: makeCard(),
      from: { id: 11 },
      via_bot: { id: OUR_BOT_ID },
      forward_origin: { type: "user", sender_user: { id: 22 } },
    },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});

test("forwarded forgery (no via_bot) is flagged forge_from_blank", () => {
  const v = detectForgery({
    message: {
      text: makeCard(),
      from: { id: 11 },
      forward_origin: { type: "user", sender_user: { id: 22 } },
    },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v?.kind, "forge_from_blank");
});

test("captioned media with card-shape caption is detected", () => {
  const v = detectForgery({
    message: { caption: makeCard(), from: { id: 11 } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v?.kind, "forge_from_blank");
});

test("identical card body produces identical contentHash across calls", () => {
  const a = detectForgery({
    message: { text: makeCard(), from: { id: 11 } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  const b = detectForgery({
    message: { text: makeCard(), from: { id: 22 } },
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(a?.contentHash, b?.contentHash);
});

test("null message returns null", () => {
  const v = detectForgery({
    message: null,
    ourBotId: OUR_BOT_ID,
    kind: "message",
  });
  assert.equal(v, null);
});
