import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountTooNewText,
  buildAdminBotDescription,
  buildAdminBotShortDescription,
  buildAdminHelpText,
  buildBotDescriptionText,
  buildBotShortDescription,
  buildDbStatsText,
  buildFrozenListText,
  buildLookupBotDescription,
  buildLookupBotShortDescription,
  buildLookupReplyMarkup,
  buildLookupText,
  buildModerationWarnText,
  buildPinnedGuideText,
  buildPolicyText,
  buildWelcomeText,
  fmtDate,
  fmtDateTime,
} from "./archive.ts";
import {
  buildReplyKeyboardRemove,
  buildTargetRequestReplyMarkup,
  buildThreadedGroupReplyOptions,
  shouldSendThreadedLauncherReply,
  TARGET_USER_REQUEST_ID,
} from "./telegramUx.ts";

// ---- v9 locked-text assertions ----
//
// v9 strips the DM wizard. Welcome / pinned-guide / bot-profile copy
// describes the new flow: members post vouches as normal group messages;
// DM /lookup @user searches the legacy archive. Drift in any of these
// requires a v9 spec amendment first.

test("welcome text is terse, SC45-branded, points at /search /me /forgetme /policy", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>SC45<\/b>/);
  assert.match(text, /<code>\/search @username<\/code>/);
  assert.match(text, /<code>\/me<\/code>/);
  assert.match(text, /<code>\/forgetme<\/code>/);
  assert.match(text, /<code>\/policy<\/code>/);
  assert.match(text, /Tag the @, say what happened/);
  assert.match(text, /Telegram ToS/);
  assert.match(text, /Automated read-only lookup/);
  // No reporting-channel pointer; no AI-flavoured headers.
  assert.equal(text.includes("@notoscam"), false);
  assert.equal(text.includes("Vouch Hub"), false);
  assert.equal(text.includes("Submit Vouch"), false);
  // Length sanity — full output incl. rules line should stay compact.
  assert.ok(text.length <= 700, `welcome is ${text.length} chars`);
});

test("pinned guide is terse and points at the DM commands", () => {
  const text = buildPinnedGuideText();
  assert.match(text, /<b>SC45<\/b>/);
  assert.match(text, /<code>\/search @username<\/code>/);
  assert.match(text, /<code>\/forgetme<\/code>/);
  assert.match(text, /Tag the @, say what happened/);
  assert.match(text, /Automated read-only lookup/);
  assert.equal(text.includes("Vouch Hub"), false);
  assert.equal(text.includes("Submit Vouch"), false);
  assert.ok(text.length <= 700, `pinned guide is ${text.length} chars`);
});

test("bot description is short and human, ≤512 chars", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /^Look up vouches in SC45\./);
  assert.match(desc, /\/search @user/);
  assert.match(desc, /\/me/);
  assert.match(desc, /\/forgetme/);
  assert.match(desc, /Automated read-only/);
  assert.match(desc, /\/policy/);
  assert.match(desc, /Telegram ToS applies/);
  assert.equal(desc.includes("Vouch Hub"), false);
  assert.equal(desc.includes("Submit Vouch"), false);
  assert.ok(desc.length <= 512, `bot description is ${desc.length} chars`);

  const short = buildBotShortDescription();
  assert.equal(short, "Look up SC45 vouches. DM /search @user.");
  assert.ok(short.length <= 120);
});

test("rules line is one short sentence, no header, no bullets", () => {
  const surfaces = [buildWelcomeText(), buildPinnedGuideText()];
  for (const text of surfaces) {
    assert.match(text, /Rules:/);
    assert.match(text, /Telegram ToS/);
    assert.match(text, /vouch people you actually know/);
    assert.match(text, /no minors/);
    assert.match(text, /no illegal activity/);
    // No header / no bullet markers — the goal is human prose.
    assert.equal(text.includes("<b>Rules</b>"), false);
    assert.equal(text.includes("• "), false);
    assert.equal(text.includes("@notoscam"), false);
  }
});

test("policy text includes guardian points and official Telegram links", () => {
  const text = buildPolicyText();
  assert.match(text, /Automated read-only lookup\/moderation tool/);
  assert.match(text, /does not write vouches or DM first/);
  assert.match(text, /Stored:/);
  assert.match(text, /\/forgetme/);
  assert.match(text, /Vouches others wrote about you stay/);
  assert.match(text, /no spam\/scams/);
  assert.match(text, /illegal goods or services/);
  // Telegram ToS URL must be visible as plain text on its own line, not
  // hidden behind an <a> tag — owner directive after the original copy
  // buried it inside a · separated link chain.
  assert.match(text, /^Telegram Terms of Service: https:\/\/telegram\.org\/tos$/m);
  assert.match(text, /https:\/\/telegram\.org\/privacy/);
  assert.match(text, /https:\/\/telegram\.org\/tos\/bots/);
  assert.match(text, /https:\/\/telegram\.org\/tos\/bot-developers/);
  assert.match(text, /https:\/\/telegram\.org\/moderation/);
  assert.equal(text.includes("@notoscam"), false);
  assert.ok(text.length <= 1200, `policy is ${text.length} chars`);
});

test("locked copy uses 'review' not 'verify' to avoid the marketplace ML keyword cluster", () => {
  for (const text of [
    buildWelcomeText(),
    buildPinnedGuideText(),
    buildBotDescriptionText(),
    buildBotShortDescription(),
  ]) {
    assert.doesNotMatch(text, /\bverify\b/i, text);
    assert.doesNotMatch(text, /\bverified\b/i, text);
  }
});

test("telegram UX helpers favor threaded quiet replies", () => {
  // v9: only /lookup remains as a group command surface; /vouch is gone.
  assert.equal(shouldSendThreadedLauncherReply("/lookup"), false);
  assert.deepEqual(buildThreadedGroupReplyOptions(99), {
    replyToMessageId: 99,
    allowSendingWithoutReply: true,
    disableNotification: true,
  });
  assert.deepEqual(buildTargetRequestReplyMarkup(), {
    keyboard: [
      [
        {
          text: "Choose Target",
          request_users: {
            request_id: TARGET_USER_REQUEST_ID,
            user_is_bot: false,
            max_quantity: 1,
            request_name: true,
            request_username: true,
          },
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Choose a target",
  });
  assert.deepEqual(buildReplyKeyboardRemove(), { remove_keyboard: true });
});

test("buildFrozenListText shows 'No frozen profiles.' when empty", () => {
  assert.equal(buildFrozenListText([]), "No frozen profiles.");
});

test("buildFrozenListText renders rows with reason and dd/mm/yyyy date", () => {
  const text = buildFrozenListText([
    {
      username: "scammer",
      freezeReason: "ghosted multiple buyers",
      frozenAt: new Date(Date.UTC(2026, 3, 5, 12)),
    },
    { username: "lurker", freezeReason: null, frozenAt: null },
  ]);

  assert.match(text, /<b><u>Frozen profiles<\/u><\/b>/);
  assert.match(text, /<b>@scammer<\/b> — frozen 05\/04\/2026 — <i>ghosted multiple buyers<\/i>/);
  assert.match(text, /<b>@lurker<\/b> — frozen unknown — <i>no reason given<\/i>/);
});

test("buildFrozenListText caps at 10 rows and notes the remainder", () => {
  // Use distinguishable handles (not "user<n>" — that pattern now triggers
  // the synthetic-id renderer for tg://user?id deep-links).
  const rows = Array.from({ length: 13 }, (_, i) => ({
    username: `acct${i + 1}`,
    freezeReason: null,
    frozenAt: new Date(Date.UTC(2026, 0, 1, 12)),
  }));
  const text = buildFrozenListText(rows);

  assert.match(text, /<b>@acct1<\/b>/);
  assert.match(text, /<b>@acct10<\/b>/);
  assert.doesNotMatch(text, /<b>@acct11<\/b>/);
  assert.match(text, /…and 3 more — refine with \/search @x/);
});

test("buildLookupText renders synthetic user<id> as tg://user?id deep-link, not fake @-handle", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    mode: "all",
    entries: [
      {
        id: 1,
        reviewerUsername: "user8386618557",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 10)),
      },
    ],
  });
  // Should NOT contain a fake @user8386618557 link
  assert.equal(text.includes("@user8386618557"), false);
  // Should contain the tg:// deep-link with monospace id label
  assert.match(text, /<a href="tg:\/\/user\?id=8386618557"><code>id 8386618557<\/code><\/a>/);
});

test("buildLookupText renders fwd_<hash> synthetic as plain '(unknown reviewer)'", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    mode: "all",
    entries: [
      {
        id: 2,
        reviewerUsername: "fwd_a7b9c2d4e1",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 10)),
      },
    ],
  });
  assert.equal(text.includes("@fwd_"), false);
  assert.match(text, /<i>\(unknown reviewer\)<\/i>/);
});

test("buildLookupText still renders real @-handles as bold @-mentions", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    mode: "all",
    entries: [
      {
        id: 3,
        reviewerUsername: "sunnycoastsmoke",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 10)),
      },
    ],
  });
  assert.match(text, /<b>@sunnycoastsmoke<\/b>/);
});

test("buildLookupText renders admin-only note when present, HTML-escaped", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 0, mixed: 0, negative: 1 },
    mode: "all",
    entries: [
      {
        id: 7,
        reviewerUsername: "alice",
        result: "negative",
        tags: ["poor_comms"],
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
        source: "live",
        privateNote: "owes 3.1k <script>",
      },
    ],
  });
  assert.match(text, /<i>Note:<\/i> owes 3\.1k &lt;script&gt;/);
  assert.equal(text.includes("<script>"), false);
});

test("buildLookupText omits the note line when private_note is null", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    mode: "all",
    entries: [
      {
        id: 7,
        reviewerUsername: "alice",
        result: "positive",
        tags: ["good_comms"],
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
        source: "live",
        privateNote: null,
      },
    ],
  });
  assert.equal(text.includes("<i>Note:</i>"), false);
});

test("buildLookupText shows Active status + summary line under heading", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    mode: "all",
    entries: [
      {
        id: 42,
        reviewerUsername: "alice",
        result: "positive",
        tags: ["good_comms"],
        createdAt: new Date(Date.UTC(2026, 3, 5, 12)),
      },
    ],
  });

  assert.match(text, /<b><u>@bobbiz<\/u><\/b>/);
  assert.match(text, /Status: Active/);
  assert.match(text, /<b>1 vouch<\/b>/);
  assert.match(text, /✅ 1 POS/);
  assert.match(text, /<b>#42<\/b>/);
});

test("buildLookupText shows Frozen status with reason and 'No vouches' when zero", () => {
  const text = buildLookupText({
    targetUsername: "icebox",
    isFrozen: true,
    freezeReason: "scam attempt",
    counts: { total: 0, positive: 0, mixed: 0, negative: 0 },
    entries: [],
  });

  assert.match(text, /<b><u>@icebox<\/u><\/b>/);
  assert.match(text, /Status: Frozen — <i>scam attempt<\/i>/);
  assert.match(text, /Nothing on <b>@icebox<\/b>/);
});

test("buildLookupText falls back to 'no reason given' when frozen with null reason", () => {
  const text = buildLookupText({
    targetUsername: "icebox",
    isFrozen: true,
    freezeReason: null,
    counts: { total: 0, positive: 0, mixed: 0, negative: 0 },
    entries: [],
  });

  assert.match(text, /Status: Frozen — <i>no reason given<\/i>/);
});

test("buildLookupText summary line shows total + breakdown across results", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 7, positive: 4, mixed: 2, negative: 1 },
    entries: [],
  });
  assert.match(text, /<b>7 vouches<\/b>/);
  assert.match(text, /✅ 4 POS/);
  assert.match(text, /⚖️ 2 MIX/);
  assert.match(text, /⚠️ 1 NEG/);
});

test("buildLookupText preview mode is summary-only — no entry rows ever", () => {
  // Preview is the default DM /search response. Owner directive: members
  // should see a tight summary card and use "View full" to expand into
  // a private detail render — never a wall of vouches inline.
  const entries = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    reviewerUsername: `r${i}`,
    result: "positive" as const,
    tags: [],
    createdAt: new Date(Date.UTC(2026, 3, 5)),
  }));
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 8, positive: 8, mixed: 0, negative: 0 },
    entries,
    mode: "preview",
  });
  assert.match(text, /<b>8 vouches<\/b>/);
  for (let i = 1; i <= 8; i += 1) {
    assert.equal(text.includes(`<b>#${i}</b>`), false, `#${i} should not appear in preview`);
  }
  assert.equal(text.includes("By @r0"), false);
});

test("buildLookupText preview includes a compact Last-Xd-ago freshness line when lastAt is given", () => {
  // Recent date so the relative-ago renderer hits the days/months branch.
  const lastAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: {
      total: 3,
      positive: 3,
      mixed: 0,
      negative: 0,
      lastAt,
      distinctReviewers: 2,
    },
    entries: [],
    mode: "preview",
  });
  assert.match(text, /<b><u>@bobbiz<\/u><\/b>/);
  assert.match(text, /<b>3 vouches<\/b> — ✅ 3 POS · last 5d ago/);
  // No "Status: Active" filler in the common case.
  assert.equal(text.includes("Status: Active"), false);
});

test("buildLookupReplyMarkup: shows See-all callback in DM preview mode when total > shown", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 0,
    totalAvailable: 23,
    mode: "preview",
  });
  assert.ok(m, "should return markup");
  assert.equal(m!.inline_keyboard.length, 1);
  assert.match(m!.inline_keyboard[0]![0]!.text, /📋 See all 23 vouches/);
  const b0 = m!.inline_keyboard[0]![0]! as { callback_data: string };
  assert.equal(b0.callback_data, "lk:a:bobbiz");
});

test("buildLookupReplyMarkup: group surface shows DM deep-link button for any non-empty result", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 0,
    totalAvailable: 1,
    mode: "preview",
    inGroup: true,
    inGroupBotUsername: "sc45_bot",
  });
  assert.ok(m, "should return markup");
  const btn = m!.inline_keyboard[0]![0]! as { url: string; text: string };
  assert.match(btn.text, /See all 1 vouches/);
  assert.equal(btn.url, "https://t.me/sc45_bot?start=search_bobbiz");
});

test("buildLookupReplyMarkup: in-group with no botUsername returns null — never falls back to a callback", () => {
  // Regression: missing bot username used to fall through to a callback,
  // which renders the full result inside the group. Owner-reported bug:
  // expand button should *only* be a URL deep-link in group; otherwise
  // omit it (the user can DM the bot directly).
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 0,
    totalAvailable: 5,
    mode: "preview",
    inGroup: true,
    inGroupBotUsername: undefined,
  });
  assert.equal(m, null);

  const m2 = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 0,
    totalAvailable: 5,
    mode: "preview",
    negCount: 2,
    inGroup: true,
  });
  assert.equal(m2, null);
});

test("buildLookupReplyMarkup: no buttons when preview shows all entries", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 3,
    totalAvailable: 3,
    mode: "preview",
  });
  assert.equal(m, null);
});

test("buildLookupReplyMarkup: every viewer gets See-NEG button when negCount > 0", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 0,
    totalAvailable: 23,
    mode: "preview",
    negCount: 1,
  });
  assert.ok(m);
  assert.equal(m!.inline_keyboard.length, 2);
  assert.match(m!.inline_keyboard[0]![0]!.text, /See all 23/);
  assert.match(m!.inline_keyboard[1]![0]!.text, /⚠️ See 1 NEG/);
  const negBtn = m!.inline_keyboard[1]![0]! as { callback_data: string };
  assert.equal(negBtn.callback_data, "lk:n:bobbiz");
});

test("buildLookupReplyMarkup: NEG plural label", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 5,
    totalAvailable: 5,
    mode: "preview",
    negCount: 3,
  });
  assert.match(m!.inline_keyboard[0]![0]!.text, /⚠️ See 3 NEGs/);
});

test("buildLookupReplyMarkup: NEG button hidden when negCount is 0", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 5,
    totalAvailable: 5,
    mode: "preview",
    negCount: 0,
  });
  assert.equal(m, null);
});

test("buildLookupReplyMarkup: in-group context replaces See-all callback with DM deep-link URL", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "coastcontra",
    totalShown: 0,
    totalAvailable: 73,
    mode: "preview",
    inGroup: true,
    inGroupBotUsername: "sc45_bot",
  });
  assert.ok(m);
  assert.equal(m!.inline_keyboard.length, 1);
  const btn = m!.inline_keyboard[0]![0]! as { url: string; text: string };
  assert.match(btn.text, /📋 See all 73 vouches/);
  assert.equal(btn.url, "https://t.me/sc45_bot?start=search_coastcontra");
});

test("buildLookupReplyMarkup: in-group with NEG → both buttons are URL deep-links to DM", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "coastcontra",
    totalShown: 0,
    totalAvailable: 73,
    mode: "preview",
    negCount: 1,
    inGroup: true,
    inGroupBotUsername: "sc45_bot",
  });
  assert.ok(m);
  assert.equal(m!.inline_keyboard.length, 2);
  // Row 0: See-all → DM via search deep-link.
  assert.equal((m!.inline_keyboard[0]![0]! as any).url, "https://t.me/sc45_bot?start=search_coastcontra");
  // Row 1: NEG → DM via neg deep-link (was callback, would have spammed group).
  assert.equal((m!.inline_keyboard[1]![0]! as any).url, "https://t.me/sc45_bot?start=neg_coastcontra");
  // Neither button uses callback_data in group context.
  assert.equal((m!.inline_keyboard[0]![0]! as any).callback_data, undefined);
  assert.equal((m!.inline_keyboard[1]![0]! as any).callback_data, undefined);
});

test("buildLookupReplyMarkup: no NEG button when already in neg mode", () => {
  const m = buildLookupReplyMarkup({
    targetUsername: "bobbiz",
    totalShown: 1,
    totalAvailable: 1,
    mode: "neg",
    negCount: 1,
  });
  assert.equal(m, null);
});

test("buildLookupText all mode renders every entry passed in", () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    reviewerUsername: `r${i}`,
    result: "positive" as const,
    tags: [],
    createdAt: new Date(Date.UTC(2026, 3, 5)),
  }));
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 8, positive: 8, mixed: 0, negative: 0 },
    entries,
    mode: "all",
  });
  assert.match(text, /<b>#1<\/b>/);
  assert.match(text, /<b>#8<\/b>/);
});

test("buildLookupText (mode=all) surfaces rich freshness: tenure + recent windows + reviewer diversity", () => {
  // Detail surfaces (mode="all" / "neg") keep the rich freshness block.
  // Preview is intentionally summarised down — see the compact-preview
  // test above.
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: {
      total: 50,
      positive: 45,
      mixed: 4,
      negative: 1,
      firstAt: new Date(Date.UTC(2022, 0, 15)),
      lastAt: new Date(Date.UTC(2026, 3, 1)),
      recentCount: 3,
      recentCount30d: 1,
      distinctReviewers: 28,
      distinctReviewers12mo: 3,
    },
    entries: [],
    mode: "all",
  });
  assert.match(text, /<b>50 vouches<\/b>/);
  assert.match(text, /Active 15\/01\/2022 → 01\/04\/2026/);
  assert.match(text, /Recent — 12mo: 3, 30d: 1/);
  assert.match(text, /28 distinct reviewers \(3 in last 12mo\)/);
});

test("buildLookupText: authored count omitted from preview, verbose in detail", () => {
  const preview = buildLookupText({
    targetUsername: "coastcontra",
    isFrozen: false,
    freezeReason: null,
    counts: {
      total: 23,
      positive: 23,
      mixed: 0,
      negative: 0,
      authoredCount: 35,
    },
    entries: [],
  });
  // Preview is the tight one-liner — authored count is detail-only now.
  assert.equal(preview.includes("Wrote"), false);
  assert.equal(preview.includes("Authored"), false);

  const detail = buildLookupText({
    targetUsername: "coastcontra",
    isFrozen: false,
    freezeReason: null,
    counts: {
      total: 23,
      positive: 23,
      mixed: 0,
      negative: 0,
      authoredCount: 35,
    },
    entries: [],
    mode: "all",
  });
  assert.match(detail, /<i>Authored: 35 vouches by <b>@coastcontra<\/b> about other members<\/i>/);
});

test("buildLookupText omits authored line when authoredCount is 0 or unset", () => {
  const t1 = buildLookupText({
    targetUsername: "alice",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 5, positive: 5, mixed: 0, negative: 0, authoredCount: 0 },
    entries: [],
  });
  assert.equal(t1.includes("Authored:"), false);
  const t2 = buildLookupText({
    targetUsername: "alice",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 5, positive: 5, mixed: 0, negative: 0 },
    entries: [],
  });
  assert.equal(t2.includes("Authored:"), false);
});

test("buildLookupText authored line pluralisation: 1 vouch (singular)", () => {
  const text = buildLookupText({
    targetUsername: "alice",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 0, positive: 0, mixed: 0, negative: 0, authoredCount: 1 },
    entries: [],
  });
  assert.match(text, /Authored: 1 vouch by /);
});

test("buildLookupText omits freshness line when no aggregate stats given", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    entries: [],
  });
  // Backwards-compat: caller without aggregates still works.
  assert.equal(text.includes("Last:"), false);
  assert.equal(text.includes("Recent ("), false);
  assert.equal(text.includes("distinct reviewer"), false);
});

test("fmtDate renders dd/mm/yyyy in UTC", () => {
  assert.equal(fmtDate(new Date(Date.UTC(2026, 3, 5, 12))), "05/04/2026");
  assert.equal(fmtDate(new Date(Date.UTC(2025, 10, 2, 0))), "02/11/2025");
});

test("fmtDateTime renders dd/mm/yyyy HH:MM in UTC", () => {
  assert.equal(fmtDateTime(new Date(Date.UTC(2026, 3, 5, 9, 7))), "05/04/2026 09:07");
  assert.equal(fmtDateTime(new Date(Date.UTC(2025, 10, 2, 23, 45))), "02/11/2025 23:45");
});

test("buildAdminHelpText lists every admin command (v9 — /search primary, /lookup alias)", () => {
  const text = buildAdminHelpText();
  assert.match(text, /<b><u>Admin commands<\/u><\/b>/);
  for (const cmd of [
    "/freeze @x",
    "/unfreeze @x",
    "/frozen_list",
    "/remove_entry",
    "/recover_entry",
    "/search @x",
    "/pause",
    "/unpause",
    "/dbstats",
    "/mirrorstats",
    "/modstats",
    "/teach",
    "/reviewq",
  ]) {
    assert.match(text, new RegExp(cmd.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")));
  }
  assert.match(text, /alias: \/lookup/);
});

test("buildLookupBotShortDescription is short + read-only-flavoured", () => {
  const s = buildLookupBotShortDescription();
  assert.match(s, /SC45/);
  assert.match(s, /read-only/i);
  assert.match(s, /\/search/);
  assert.ok(s.length <= 120);
});

test("buildLookupBotDescription is one short line", () => {
  const text = buildLookupBotDescription();
  assert.match(text, /SC45/);
  assert.match(text, /\/search @user/);
  assert.match(text, /Read-only/);
  assert.ok(text.length <= 200);
});

test("buildAdminBotShortDescription is short", () => {
  const s = buildAdminBotShortDescription();
  assert.match(s, /SC45/);
  assert.match(s, /admin/i);
  assert.ok(s.length <= 120);
});

test("buildAdminBotDescription is one short line", () => {
  const text = buildAdminBotDescription();
  assert.match(text, /SC45/);
  assert.match(text, /admin/i);
  assert.ok(text.length <= 200);
});

test("BOT_WELCOME_TEXT env overrides welcome body, rules line still appended", () => {
  process.env.BOT_WELCOME_TEXT = "Hello world\\nLine 2";
  try {
    const text = buildWelcomeText();
    assert.match(text, /^Hello world\nLine 2/);
    assert.match(text, /Rules:/);
    assert.equal(text.includes("/search @username"), false);
  } finally {
    delete process.env.BOT_WELCOME_TEXT;
  }
});

test("BOT_PINNED_GUIDE_TEXT env overrides pinned body, rules line still appended", () => {
  process.env.BOT_PINNED_GUIDE_TEXT = "Pinned-override-body";
  try {
    const text = buildPinnedGuideText();
    assert.match(text, /^Pinned-override-body/);
    assert.match(text, /Rules:/);
  } finally {
    delete process.env.BOT_PINNED_GUIDE_TEXT;
  }
});

test("BOT_RULES_TEXT env replaces the default rules line", () => {
  process.env.BOT_RULES_TEXT = "House rules: be cool.";
  try {
    const text = buildWelcomeText();
    assert.match(text, /House rules: be cool\./);
    assert.equal(text.includes("Telegram ToS, vouch people"), false);
  } finally {
    delete process.env.BOT_RULES_TEXT;
  }
});

test("env override falls back to default when env is empty / whitespace", () => {
  process.env.BOT_WELCOME_TEXT = "   ";
  try {
    const text = buildWelcomeText();
    assert.match(text, /<b>SC45<\/b>/);
    assert.match(text, /\/search @username/);
  } finally {
    delete process.env.BOT_WELCOME_TEXT;
  }
});

test("buildPolicyText is short, names what's stored + the deletion path, no @notoscam", () => {
  const text = buildPolicyText();
  assert.match(text, /Stored:/);
  assert.match(text, /<code>\/forgetme<\/code>/);
  assert.match(text, /Telegram Terms of Service/i);
  assert.match(text, /Bot Terms/i);
  assert.equal(text.includes("@notoscam"), false);
  assert.equal(text.includes("Full policy:"), false);
  assert.ok(text.length <= 1200, `policy is ${text.length} chars`);
});

test("buildDbStatsText shows status breakdown + sample rows when data is present", () => {
  const text = buildDbStatsText({
    statusCounts: [
      { status: "published", count: 1383 },
      { status: "pending", count: 2 },
    ],
    profileCount: 942,
    sampleTargets: ["bobbiz", "alice", "carol"],
    sampleProfiles: ["bobbiz", "alice"],
    nonLowercaseTargets: 0,
    atPrefixedTargets: 0,
  });
  assert.match(text, /<b>DB stats<\/b>/);
  assert.match(text, /<b>vouch_entries:<\/b> 1385 total/);
  assert.match(text, /published: 1383/);
  assert.match(text, /pending: 2/);
  assert.match(text, /<b>business_profiles:<\/b> 942/);
  assert.match(text, /<code>bobbiz<\/code>/);
  assert.equal(text.includes("No vouch_entries rows"), false);
});

test("buildDbStatsText flags empty DB with a clear pointer", () => {
  const text = buildDbStatsText({
    statusCounts: [],
    profileCount: 0,
    sampleTargets: [],
    sampleProfiles: [],
    nonLowercaseTargets: 0,
    atPrefixedTargets: 0,
  });
  assert.match(text, /<b>vouch_entries:<\/b> 0 total/);
  assert.match(text, /No vouch_entries rows/);
  assert.match(text, /replay:legacy/);
});

test("buildDbStatsText warns about non-lowercase + @-prefixed rows", () => {
  const text = buildDbStatsText({
    statusCounts: [{ status: "published", count: 100 }],
    profileCount: 50,
    sampleTargets: ["bobbiz"],
    sampleProfiles: ["bobbiz"],
    nonLowercaseTargets: 7,
    atPrefixedTargets: 3,
  });
  assert.match(text, /⚠ 7 entries have non-lowercase target_username/);
  assert.match(text, /⚠ 3 entries have target_username starting with '@'/);
});

test("buildAccountTooNewText pluralises hours correctly", () => {
  const one = buildAccountTooNewText(1);
  assert.match(one, /<b>1 hour<\/b>/);
  assert.doesNotMatch(one, /1 hours/);
  const many = buildAccountTooNewText(23);
  assert.match(many, /<b>23 hours<\/b>/);
});

test("buildAccountTooNewText uses locked headline", () => {
  const text = buildAccountTooNewText(12);
  assert.match(text, /^<b>Please come back later<\/b>/);
  assert.match(text, /We wait for new accounts to establish/);
});

test("buildModerationWarnText: vouch-shape branch points back into the group (no wizard)", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "regex_vouch_for_username",
    adminBotUsername: null,
  });
  assert.match(text, /Removed in <b>VouchVault<\/b>/);
  assert.match(text, /Post the vouch as a normal message/);
  // v9: no Submit Vouch launcher anymore.
  assert.equal(text.includes("Submit Vouch"), false);
});

test("buildModerationWarnText: buy/sell branch with admin-bot username points at the admin bot", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "compound_buy_solicit",
    adminBotUsername: "VouchAdminBot",
  });
  assert.match(text, /Removed in <b>VouchVault<\/b>/);
  assert.match(text, /To appeal, DM <code>@VouchAdminBot<\/code>/);
});

test("buildModerationWarnText: buy/sell branch without admin-bot username falls back to pinging an admin", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "phrase",
    adminBotUsername: null,
  });
  assert.match(text, /Removed in <b>VouchVault<\/b>/);
  assert.match(text, /To appeal, ping an admin/);
  assert.doesNotMatch(text, /DM <code>@/);
});

test("buildModerationWarnText: HTML-escapes the group name", () => {
  const text = buildModerationWarnText({
    groupName: "Vouch & Verify <test>",
    hitSource: "phrase",
    adminBotUsername: null,
  });
  assert.match(text, /Vouch &amp; Verify &lt;test&gt;/);
});
