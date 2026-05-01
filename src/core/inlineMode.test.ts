import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlineLookupResult,
  buildInlineSummaryText,
  buildInlineSummaryTitle,
} from "./archive.ts";

test("inline summary: empty target gets clear no-vouches copy", () => {
  const text = buildInlineSummaryText({
    targetUsername: "newbie",
    positive: 0,
    mixed: 0,
    total: 0,
    lastAt: null,
    isFrozen: false,
  });
  assert.match(text, /@newbie/);
  assert.match(text, /no vouches yet/);
});

test("inline summary: reserved target short-circuits", () => {
  const text = buildInlineSummaryText({
    targetUsername: "notoscam",
    positive: 0,
    mixed: 0,
    total: 0,
    lastAt: null,
    isFrozen: false,
  });
  assert.match(text, /not a person/);
});

test("inline summary: includes total + breakdown + last-active", () => {
  const text = buildInlineSummaryText({
    targetUsername: "alice",
    positive: 4,
    mixed: 1,
    total: 5,
    lastAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    isFrozen: false,
  });
  assert.match(text, /@alice/);
  assert.match(text, /5 vouches/);
  assert.match(text, /4 POS/);
  assert.match(text, /1 MIX/);
  assert.match(text, /3d ago/);
});

test("inline summary: surfaces frozen as caution-when-transacting", () => {
  const text = buildInlineSummaryText({
    targetUsername: "alice",
    positive: 1,
    mixed: 0,
    total: 1,
    lastAt: new Date(),
    isFrozen: true,
  });
  assert.match(text, /frozen/);
  assert.match(text, /caution/);
});

test("inline summary: never surfaces NEG", () => {
  // The builder's API doesn't even accept negative counts; defense in
  // depth — what gets rendered must not contain NEG-related text even
  // for high vouch counts.
  const text = buildInlineSummaryText({
    targetUsername: "alice",
    positive: 10,
    mixed: 2,
    total: 12,
    lastAt: new Date(),
    isFrozen: false,
  });
  assert.equal(text.includes("NEG"), false);
});

test("buildInlineSummaryTitle for reserved/empty/populated", () => {
  assert.match(
    buildInlineSummaryTitle({
      targetUsername: "telegram",
      positive: 0,
      mixed: 0,
      total: 0,
      isFrozen: false,
    }),
    /not a person/,
  );
  assert.match(
    buildInlineSummaryTitle({
      targetUsername: "newbie",
      positive: 0,
      mixed: 0,
      total: 0,
      isFrozen: false,
    }),
    /no vouches/,
  );
  assert.match(
    buildInlineSummaryTitle({
      targetUsername: "alice",
      positive: 3,
      mixed: 0,
      total: 3,
      isFrozen: true,
    }),
    /3 vouches.*frozen/,
  );
});

test("buildInlineLookupResult shape: article, id ≤ 64 bytes, HTML disabled link previews", () => {
  const result = buildInlineLookupResult({
    targetUsername: "alice",
    positive: 1,
    mixed: 0,
    total: 1,
    lastAt: null,
    isFrozen: false,
  }) as Record<string, unknown>;
  assert.equal(result.type, "article");
  assert.ok(typeof result.id === "string");
  // Telegram inline result id cap is 64 bytes.
  assert.ok(Buffer.byteLength(result.id as string, "utf8") <= 64);
  const content = result.input_message_content as Record<string, unknown>;
  assert.equal(content.parse_mode, "HTML");
  assert.deepEqual(content.link_preview_options, { is_disabled: true });
  assert.match(content.message_text as string, /@alice/);
});
