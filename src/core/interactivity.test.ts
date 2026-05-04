import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountSubpageMarkup,
  buildAccountSubpageText,
  buildBackToMenuMarkup,
  buildMeReplyMarkup,
  buildPolicyReplyMarkup,
  buildSearchPromptReplyMarkup,
  buildSearchPromptText,
  buildWelcomeReplyMarkup,
  isWelcomeCallback,
} from "./archive.ts";

test("welcome menu: 3×2 grid of direct topical buttons", () => {
  const markup = buildWelcomeReplyMarkup();
  assert.equal(markup.inline_keyboard.length, 3, "3 rows");
  for (const row of markup.inline_keyboard) {
    assert.equal(row.length, 2, "each row has 2 buttons");
  }

  // Row 1: Find a vouch (inline) + My stats (callback)
  const r1a = markup.inline_keyboard[0]![0]! as Record<string, unknown>;
  assert.match(r1a.text as string, /Find a vouch/);
  assert.equal(typeof r1a.switch_inline_query_current_chat, "string");
  const r1b = markup.inline_keyboard[0]![1]! as { text: string; callback_data: string };
  assert.match(r1b.text, /My stats/);
  assert.equal(r1b.callback_data, "wc:me");

  // Row 2: shortcuts to two most-asked /guide leaves
  const r2a = markup.inline_keyboard[1]![0]! as { text: string; callback_data: string };
  assert.match(r2a.text, /How to vouch/);
  assert.equal(r2a.callback_data, "gd:p:new_vouch");
  const r2b = markup.inline_keyboard[1]![1]! as { text: string; callback_data: string };
  assert.match(r2b.text, /Why posts get deleted/);
  assert.equal(r2b.callback_data, "gd:p:grp_posts");

  // Row 3: More help (full /guide) + My data (account sub-menu)
  const r3a = markup.inline_keyboard[2]![0]! as { text: string; callback_data: string };
  assert.match(r3a.text, /More help/);
  assert.equal(r3a.callback_data, "wc:guide");
  const r3b = markup.inline_keyboard[2]![1]! as { text: string; callback_data: string };
  assert.match(r3b.text, /My data/);
  assert.equal(r3b.callback_data, "wc:account");
});

test("account sub-page: text + 3-row keyboard (policy, forget, back)", () => {
  const text = buildAccountSubpageText();
  assert.match(text, /Account/);
  assert.match(text, /Policy/);
  assert.match(text, /Forget me/);

  const markup = buildAccountSubpageMarkup();
  assert.equal(markup.inline_keyboard.length, 3);
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "wc:policy");
  assert.equal(markup.inline_keyboard[1]![0]!.callback_data, "wc:forget");
  assert.match(markup.inline_keyboard[2]![0]!.text, /Back/);
  assert.equal(markup.inline_keyboard[2]![0]!.callback_data, "wc:back");
});

test("buildBackToMenuMarkup: single row with one Back-to-menu button", () => {
  const markup = buildBackToMenuMarkup();
  assert.equal(markup.inline_keyboard.length, 1);
  assert.equal(markup.inline_keyboard[0]!.length, 1);
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "wc:back");
  assert.match(markup.inline_keyboard[0]![0]!.text, /Back to menu/);
});

test("buildPolicyReplyMarkup: single Back-to-menu button", () => {
  const markup = buildPolicyReplyMarkup();
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "wc:back");
});

test("/me reply markup: inline-search + Back-to-menu", () => {
  const markup = buildMeReplyMarkup();
  assert.equal(markup.inline_keyboard.length, 2);
  const r1 = markup.inline_keyboard[0]![0]! as Record<string, unknown>;
  assert.equal(typeof r1.switch_inline_query_current_chat, "string");
  const r2 = markup.inline_keyboard[1]![0]! as Record<string, unknown>;
  assert.equal(r2.callback_data, "wc:back");
});

test("buildSearchPromptText + markup: button is the inline-mode trigger", () => {
  const text = buildSearchPromptText();
  assert.match(text, /<code>\/search @username<\/code>/);
  const markup = buildSearchPromptReplyMarkup();
  const btn = markup.inline_keyboard[0]![0]!;
  assert.match(btn.text, /Search/);
  assert.equal(typeof btn.switch_inline_query_current_chat, "string");
});

test("isWelcomeCallback parses every known prefix + rejects unknown", () => {
  assert.equal(isWelcomeCallback("wc:me"), "me");
  assert.equal(isWelcomeCallback("wc:policy"), "policy");
  assert.equal(isWelcomeCallback("wc:forget"), "forget");
  assert.equal(isWelcomeCallback("wc:guide"), "guide");
  assert.equal(isWelcomeCallback("wc:account"), "account");
  assert.equal(isWelcomeCallback("wc:back"), "back");
  assert.equal(isWelcomeCallback("wc:other"), null);
  assert.equal(isWelcomeCallback("lk:a:bobbiz"), null);
  assert.equal(isWelcomeCallback(""), null);
});

test("welcome callback prefixes are well under 64-byte ceiling", () => {
  for (const cb of [
    "wc:me",
    "wc:policy",
    "wc:forget",
    "wc:guide",
    "wc:account",
    "wc:back",
  ]) {
    assert.ok(Buffer.byteLength(cb, "utf8") <= 64);
  }
});
