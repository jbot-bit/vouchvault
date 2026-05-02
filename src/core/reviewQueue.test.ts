import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewDeleteCallback,
  buildReviewItemMarkup,
  buildReviewKeepCallback,
  buildReviewQueueHeader,
  buildReviewQueueItemText,
  parseReviewDeleteCallback,
  parseReviewKeepCallback,
} from "./archive.ts";

test("review callback round-trip + 64-byte ceiling", () => {
  const id = 9999999;
  const del = buildReviewDeleteCallback(id);
  const keep = buildReviewKeepCallback(id);
  assert.equal(parseReviewDeleteCallback(del), id);
  assert.equal(parseReviewKeepCallback(keep), id);
  // Wrong prefix must not parse as the other type.
  assert.equal(parseReviewDeleteCallback(keep), null);
  assert.equal(parseReviewKeepCallback(del), null);
  // Reject zero / negative / non-integer.
  assert.equal(parseReviewDeleteCallback("rq:d:0"), null);
  assert.equal(parseReviewDeleteCallback("rq:d:-1"), null);
  assert.equal(parseReviewDeleteCallback("rq:d:abc"), null);
  // 64-byte ceiling.
  for (const cb of [del, keep]) {
    assert.ok(Buffer.byteLength(cb, "utf8") <= 64, `${cb} too long`);
  }
});

test("buildReviewQueueHeader: empty + populated + truncated cases", () => {
  assert.match(
    buildReviewQueueHeader({ pendingCount: 0, shownCount: 0 }),
    /Review queue is empty/,
  );
  assert.match(
    buildReviewQueueHeader({ pendingCount: 5, shownCount: 5 }),
    /Review queue: 5/,
  );
  const truncated = buildReviewQueueHeader({ pendingCount: 27, shownCount: 10 });
  assert.match(truncated, /Review queue: 27/);
  assert.match(truncated, /showing 10, 17 more/);
});

test("buildReviewQueueItemText shows sender + body + dd/mm/yyyy timestamp", () => {
  const text = buildReviewQueueItemText({
    itemId: 42,
    senderUsername: "spammer1",
    senderTelegramId: null,
    messageText: "menu in dm tonight, btc only",
    flaggedAt: new Date(Date.UTC(2026, 4, 5, 14, 30)),
  });
  assert.match(text, /<b>#42<\/b>/);
  assert.match(text, /@spammer1/);
  assert.match(text, /05\/05\/2026 14:30/);
  assert.match(text, /<i>menu in dm tonight, btc only<\/i>/);
});

test("buildReviewQueueItemText falls back when no @ + no body", () => {
  const text = buildReviewQueueItemText({
    itemId: 3,
    senderUsername: null,
    senderTelegramId: 8675309,
    messageText: null,
    flaggedAt: new Date(Date.UTC(2026, 4, 5)),
  });
  assert.match(text, /<code>id 8675309<\/code>/);
  assert.match(text, /\(no text\)/);
});

test("buildReviewQueueItemText truncates long bodies", () => {
  const longBody = "x".repeat(500);
  const text = buildReviewQueueItemText({
    itemId: 1,
    senderUsername: "alice",
    senderTelegramId: null,
    messageText: longBody,
    flaggedAt: new Date(Date.UTC(2026, 4, 5)),
  });
  assert.match(text, /…/);
  // Must not contain the full 500-char body verbatim.
  assert.equal(text.includes(longBody), false);
});

test("buildReviewItemMarkup: row of [Delete, Keep] callbacks", () => {
  const markup = buildReviewItemMarkup(7);
  assert.equal(markup.inline_keyboard.length, 1);
  assert.equal(markup.inline_keyboard[0]!.length, 2);
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "rq:d:7");
  assert.equal(markup.inline_keyboard[0]![1]!.callback_data, "rq:k:7");
});
