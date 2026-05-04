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

test("welcome menu: 3 rows — search (wide), how-it-works + my-stats, account", () => {
  const markup = buildWelcomeReplyMarkup();
  assert.equal(markup.inline_keyboard.length, 3);

  // Row 1: search a user — switch_inline_query_current_chat
  const search = markup.inline_keyboard[0]![0]! as Record<string, unknown>;
  assert.match(search.text as string, /Search a user/);
  assert.equal(typeof search.switch_inline_query_current_chat, "string");

  // Row 2: 2 buttons — guide + me
  const row2 = markup.inline_keyboard[1]!;
  assert.equal(row2.length, 2);
  const cbs2 = row2.map((b) => (b as { callback_data: string }).callback_data);
  assert.deepEqual(cbs2, ["wc:guide", "wc:me"]);
  assert.match((row2[0]! as { text: string }).text, /How it works/);
  assert.match((row2[1]! as { text: string }).text, /My stats/);

  // Row 3: account & data (sub-menu)
  const row3 = markup.inline_keyboard[2]!;
  assert.equal(row3.length, 1);
  const accountBtn = row3[0]! as { text: string; callback_data: string };
  assert.match(accountBtn.text, /Account/);
  assert.equal(accountBtn.callback_data, "wc:account");
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
