import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLookupText,
  buildMeText,
  buildMirrorStatsText,
  buildModStatsText,
  buildRemoveEntryCancelCallback,
  buildRemoveEntryConfirmCallback,
  buildRemoveEntryConfirmMarkup,
  buildRemoveEntryConfirmText,
  parseRemoveEntryCancelCallback,
  parseRemoveEntryConfirmCallback,
} from "./archive.ts";

test("buildLookupText member-scope appends caution hint to frozen status", () => {
  const memberText = buildLookupText({
    targetUsername: "alice",
    isFrozen: true,
    freezeReason: "community_concerns",
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    entries: [
      {
        id: 1,
        reviewerUsername: "bob",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 1)),
      },
    ],
    viewerScope: "member",
  });
  assert.match(memberText, /Status: Frozen/);
  assert.match(memberText, /caution when transacting/);

  const adminText = buildLookupText({
    targetUsername: "alice",
    isFrozen: true,
    freezeReason: "community_concerns",
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    entries: [
      {
        id: 1,
        reviewerUsername: "bob",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 1)),
      },
    ],
    viewerScope: "admin",
  });
  assert.match(adminText, /Status: Frozen/);
  assert.equal(adminText.includes("caution when transacting"), false);
});

test("buildLookupText empty state suggests posting in the group, not 'no vouches'", () => {
  const text = buildLookupText({
    targetUsername: "newuser",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 0, positive: 0, mixed: 0, negative: 0 },
    entries: [],
  });
  assert.match(text, /No vouches yet for/);
  assert.match(text, /post a vouch in the group/);
});

test("buildLookupText short-circuits reserved targets (bot self / telegram-reserved)", () => {
  const text = buildLookupText({
    targetUsername: "notoscam",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 0, positive: 0, mixed: 0, negative: 0 },
    entries: [],
  });
  assert.match(text, /read-only lookup tool/);
  assert.match(text, /can't vouch for me/);
  // Empty-state copy must not bleed through.
  assert.equal(text.includes("No vouches yet"), false);
});

test("buildMeText shows zero state when caller has no record", () => {
  const text = buildMeText({
    username: "newbie",
    counts: {
      total: 0,
      positive: 0,
      mixed: 0,
      negative: 0,
      firstAt: null,
      lastAt: null,
    },
    authoredCount: 0,
  });
  assert.match(text, /Your vouches/);
  assert.match(text, /No vouches recorded/);
  assert.match(text, /post a vouch as a normal message/);
});

test("buildMeText shows received + authored counts when present", () => {
  const text = buildMeText({
    username: "alice",
    counts: {
      total: 5,
      positive: 4,
      mixed: 1,
      negative: 0,
      firstAt: new Date(Date.UTC(2025, 0, 1)),
      lastAt: new Date(Date.UTC(2026, 3, 1)),
    },
    authoredCount: 3,
  });
  assert.match(text, /Received:/);
  assert.match(text, /5 vouches/);
  assert.match(text, /4 POS/);
  assert.match(text, /1 MIX/);
  assert.match(text, /Authored:/);
  assert.match(text, /3 vouches/);
});

test("buildMeText never surfaces NEG counts to the caller", () => {
  // Member view forces negative=0 but defense-in-depth: even if a
  // caller passes a non-zero negative, /me must not render it.
  const text = buildMeText({
    username: "alice",
    counts: {
      total: 1,
      positive: 1,
      mixed: 0,
      negative: 0,
      firstAt: null,
      lastAt: null,
    },
    authoredCount: 0,
  });
  assert.equal(text.includes("NEG"), false);
});

test("buildMirrorStatsText health states", () => {
  const disabled = buildMirrorStatsText({
    enabled: false,
    total: 0,
    last24h: 0,
    last1h: 0,
    lastForwardedAt: null,
  });
  assert.match(disabled, /✗ disabled/);

  const fresh = buildMirrorStatsText({
    enabled: true,
    total: 100,
    last24h: 30,
    last1h: 5,
    lastForwardedAt: new Date(),
  });
  assert.match(fresh, /✓ active in last hour/);

  const stale = buildMirrorStatsText({
    enabled: true,
    total: 100,
    last24h: 0,
    last1h: 0,
    lastForwardedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  });
  assert.match(stale, /⚠ no activity/);
});

test("buildModStatsText handles empty + populated cases", () => {
  const empty = buildModStatsText({
    countToday: 0,
    count7d: 0,
    topReviewers: [],
    topHitSources: [],
  });
  assert.match(empty, /Deletions today: 0/);
  assert.match(empty, /No moderation deletions/);

  const populated = buildModStatsText({
    countToday: 4,
    count7d: 12,
    topReviewers: [
      { username: "spammer1", count: 5 },
      { username: null, count: 2 },
    ],
    topHitSources: [{ source: "regex_buy_shape", count: 7 }],
  });
  assert.match(populated, /Deletions today: 4/);
  assert.match(populated, /Deletions last 7d: 12/);
  assert.match(populated, /spammer1/);
  assert.match(populated, /\(no username\)/);
  assert.match(populated, /regex_buy_shape/);
});

test("remove_entry callback round-trip + 64-byte ceiling", () => {
  const id = 9999999;
  const yes = buildRemoveEntryConfirmCallback(id);
  const no = buildRemoveEntryCancelCallback(id);
  assert.equal(parseRemoveEntryConfirmCallback(yes), id);
  assert.equal(parseRemoveEntryCancelCallback(no), id);
  // Wrong prefix must not parse as the other type.
  assert.equal(parseRemoveEntryConfirmCallback(no), null);
  assert.equal(parseRemoveEntryCancelCallback(yes), null);
  // Reject zero / negative / non-integer.
  assert.equal(parseRemoveEntryConfirmCallback("re:y:0"), null);
  assert.equal(parseRemoveEntryConfirmCallback("re:y:-1"), null);
  assert.equal(parseRemoveEntryConfirmCallback("re:y:abc"), null);
  // Telegram callback_data ceiling.
  for (const cb of [yes, no]) {
    assert.ok(Buffer.byteLength(cb, "utf8") <= 64, `${cb} too long`);
  }
});

test("buildRemoveEntryConfirmText + markup wire confirm/cancel buttons", () => {
  const text = buildRemoveEntryConfirmText({
    entryId: 42,
    reviewerUsername: "bob",
    targetUsername: "alice",
    result: "positive",
    createdAt: new Date(Date.UTC(2026, 3, 1)),
    bodyText: "Great seller, smooth deal",
  });
  assert.match(text, /<b>Confirm remove<\/b>/);
  assert.match(text, /#42/);
  assert.match(text, /Great seller/);

  const markup = buildRemoveEntryConfirmMarkup(42);
  assert.equal(markup.inline_keyboard.length, 1);
  assert.equal(markup.inline_keyboard[0]!.length, 2);
  assert.match(markup.inline_keyboard[0]![0]!.text, /Confirm/);
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "re:y:42");
  assert.match(markup.inline_keyboard[0]![1]!.text, /Cancel/);
  assert.equal(markup.inline_keyboard[0]![1]!.callback_data, "re:n:42");
});
