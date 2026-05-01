import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMeReplyMarkup,
  buildSearchPromptReplyMarkup,
  buildSearchPromptText,
  buildWelcomeReplyMarkup,
  isWelcomeCallback,
} from "./archive.ts";

test("welcome reply markup: search button uses switch_inline_query_current_chat", () => {
  const markup = buildWelcomeReplyMarkup();
  assert.equal(markup.inline_keyboard.length, 2);
  const searchButton = markup.inline_keyboard[0]![0]! as Record<string, unknown>;
  assert.match(searchButton.text as string, /Search/);
  assert.equal(typeof searchButton.switch_inline_query_current_chat, "string");
});

test("welcome reply markup: row 2 has /me + /policy callbacks", () => {
  const markup = buildWelcomeReplyMarkup();
  const row2 = markup.inline_keyboard[1]!;
  assert.equal(row2.length, 2);
  const cbs = row2.map((b) => (b as { callback_data: string }).callback_data);
  assert.deepEqual(cbs, ["wc:me", "wc:policy"]);
});

test("/me reply markup: row 1 = inline-search switch, row 2 = forget callback", () => {
  const markup = buildMeReplyMarkup();
  assert.equal(markup.inline_keyboard.length, 2);
  const r1 = markup.inline_keyboard[0]![0]! as Record<string, unknown>;
  assert.equal(typeof r1.switch_inline_query_current_chat, "string");
  const r2 = markup.inline_keyboard[1]![0]! as Record<string, unknown>;
  assert.equal(r2.callback_data, "wc:forget");
});

test("buildSearchPromptText + markup: button is the inline-mode trigger", () => {
  const text = buildSearchPromptText();
  assert.match(text, /<code>\/search @username<\/code>/);
  const markup = buildSearchPromptReplyMarkup();
  const btn = markup.inline_keyboard[0]![0]!;
  assert.match(btn.text, /Search/);
  assert.equal(typeof btn.switch_inline_query_current_chat, "string");
});

test("isWelcomeCallback parses known prefixes + rejects unknown", () => {
  assert.equal(isWelcomeCallback("wc:me"), "me");
  assert.equal(isWelcomeCallback("wc:policy"), "policy");
  assert.equal(isWelcomeCallback("wc:forget"), "forget");
  assert.equal(isWelcomeCallback("wc:other"), null);
  assert.equal(isWelcomeCallback("lk:a:bobbiz"), null);
  assert.equal(isWelcomeCallback(""), null);
});

test("welcome callback prefixes are well under 64-byte ceiling", () => {
  for (const cb of ["wc:me", "wc:policy", "wc:forget"]) {
    assert.ok(Buffer.byteLength(cb, "utf8") <= 64);
  }
});
