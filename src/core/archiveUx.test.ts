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

test("welcome text is SC45-branded and points at /search, /policy, /forgetme", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>SC45<\/b>/);
  assert.match(text, /<code>\/search @username<\/code>/);
  assert.match(text, /<code>\/policy<\/code>/);
  assert.match(text, /<code>\/forgetme<\/code>/);
  assert.match(text, /<b>How to vouch<\/b>/);
  assert.match(text, /Tag the @, say what happened/);
  assert.match(text, /<b>Moderation<\/b>/);
  assert.match(text, /auto-delete/);
  assert.match(text, /Hit <code>\/start<\/code> once/);
  assert.match(text, /Telegram ToS/);
  assert.match(text, /@notoscam/);
  assert.equal(text.includes("Vouch Hub"), false);
  assert.equal(text.includes("Submit Vouch"), false);
});

test("pinned guide text is SC45-branded with the same surface", () => {
  const text = buildPinnedGuideText();
  assert.match(text, /<b>SC45<\/b>/);
  assert.match(text, /DM me <code>\/search @username<\/code>/);
  assert.match(text, /DM <code>\/forgetme<\/code>/);
  assert.match(text, /<b>How to vouch<\/b>/);
  assert.match(text, /Post in this group/);
  assert.match(text, /<b>Moderation<\/b>/);
  assert.match(text, /auto-delete/);
  assert.equal(text.includes("Vouch Hub"), false);
  assert.equal(text.includes("Submit Vouch"), false);
});

test("bot description is concise, SC45-branded, ≤512 chars", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /^SC45 vouch lookup\./);
  assert.match(desc, /DM \/search @username/);
  assert.match(desc, /DM \/policy/);
  assert.match(desc, /DM \/forgetme/);
  assert.match(desc, /Read-only/);
  assert.match(desc, /Members post vouches in the group/);
  assert.equal(desc.includes("Vouch Hub"), false);
  assert.equal(desc.includes("Submit Vouch"), false);
  assert.ok(desc.length <= 512, `bot description is ${desc.length} chars`);

  const short = buildBotShortDescription();
  assert.equal(short, "SC45 — DM /search @username to search community vouches.");
  assert.ok(short.length <= 120);
});

test("rules block contains the four bullets in welcome and pinned guide", () => {
  const surfaces = [buildWelcomeText(), buildPinnedGuideText()];
  for (const text of surfaces) {
    assert.match(text, /<b>Rules<\/b>/);
    assert.match(text, /Telegram ToS — no illegal, no scams/);
    assert.match(text, /Vouch only people you know personally/);
    assert.match(text, /No personal opinions, no rating, no minors/);
    assert.match(text, /Report ToS violations to @notoscam/);
  }
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
  const rows = Array.from({ length: 13 }, (_, i) => ({
    username: `user${i + 1}`,
    freezeReason: null,
    frozenAt: new Date(Date.UTC(2026, 0, 1, 12)),
  }));
  const text = buildFrozenListText(rows);

  assert.match(text, /<b>@user1<\/b>/);
  assert.match(text, /<b>@user10<\/b>/);
  assert.doesNotMatch(text, /<b>@user11<\/b>/);
  assert.match(text, /…and 3 more — refine with \/search @x/);
});

test("buildLookupText renders admin-only note when present, HTML-escaped", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 0, mixed: 0, negative: 1 },
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
  assert.match(text, /No vouches for <b>@icebox<\/b>\./);
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

test("buildLookupText preview mode renders only first 5 of 8 entries", () => {
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
  assert.match(text, /<b>#1<\/b>/);
  assert.match(text, /<b>#5<\/b>/);
  assert.equal(text.includes("<b>#6</b>"), false);
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

test("buildLookupText surfaces freshness line: last date + recent count + distinct reviewers", () => {
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
      distinctReviewers: 28,
    },
    entries: [],
  });
  assert.match(text, /<b>50 vouches<\/b>/);
  assert.match(text, /Last: 01\/04\/2026/);
  assert.match(text, /Recent \(12mo\): 3/);
  assert.match(text, /28 distinct reviewers/);
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

test("buildLookupText renders truncated body text when present", () => {
  const longBody = "x".repeat(500);
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    counts: { total: 1, positive: 1, mixed: 0, negative: 0 },
    entries: [
      {
        id: 1,
        reviewerUsername: "alice",
        result: "positive",
        tags: [],
        createdAt: new Date(Date.UTC(2026, 3, 5)),
        bodyText: `Bobbiz did a great job. ${longBody}`,
      },
    ],
  });
  assert.match(text, /Bobbiz did a great job/);
  assert.match(text, /…/);
  // Body line is rendered as <i>...</i>
  assert.match(text, /<i>Bobbiz did a great job/);
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
  ]) {
    assert.match(text, new RegExp(cmd.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")));
  }
  assert.match(text, /alias: \/lookup/);
});

test("buildLookupBotShortDescription is the locked copy", () => {
  assert.equal(
    buildLookupBotShortDescription(),
    "SC45 — read-only search. DM /search @username.",
  );
});

test("buildLookupBotDescription is the locked copy", () => {
  const text = buildLookupBotDescription();
  assert.match(text, /^SC45 read-only search\./);
  assert.match(text, /DM \/search @username/);
  assert.match(text, /doesn't write or DM on its own/);
});

test("buildAdminBotShortDescription is the locked copy", () => {
  assert.equal(
    buildAdminBotShortDescription(),
    "SC45 admin tooling. Restricted — operator commands only.",
  );
});

test("buildAdminBotDescription is the locked copy", () => {
  const text = buildAdminBotDescription();
  assert.match(text, /SC45 operator-only admin bot/);
  assert.match(text, /Freeze\/unfreeze\/audit/);
  assert.match(text, /chat moderation/);
});

test("BOT_WELCOME_TEXT env overrides welcome body, rules block still appended", () => {
  process.env.BOT_WELCOME_TEXT = "Hello world\\nLine 2";
  try {
    const text = buildWelcomeText();
    assert.match(text, /^Hello world\nLine 2/);
    assert.match(text, /<b>Rules<\/b>/);
    assert.equal(text.includes("🔍 Search"), false);
  } finally {
    delete process.env.BOT_WELCOME_TEXT;
  }
});

test("BOT_PINNED_GUIDE_TEXT env overrides pinned body, rules block still appended", () => {
  process.env.BOT_PINNED_GUIDE_TEXT = "Pinned-override-body";
  try {
    const text = buildPinnedGuideText();
    assert.match(text, /^Pinned-override-body/);
    assert.match(text, /<b>Rules<\/b>/);
  } finally {
    delete process.env.BOT_PINNED_GUIDE_TEXT;
  }
});

test("BOT_RULES_TEXT env replaces the default rules block", () => {
  process.env.BOT_RULES_TEXT = "<b>House Rules</b>\\n• Be cool";
  try {
    const text = buildWelcomeText();
    assert.match(text, /<b>House Rules<\/b>/);
    assert.match(text, /Be cool/);
    assert.equal(text.includes("Telegram ToS — no illegal"), false);
  } finally {
    delete process.env.BOT_RULES_TEXT;
  }
});

test("env override falls back to default when env is empty / whitespace", () => {
  process.env.BOT_WELCOME_TEXT = "   ";
  try {
    const text = buildWelcomeText();
    assert.match(text, /<b>SC45<\/b>/);
    assert.match(text, /🔍 Search/);
  } finally {
    delete process.env.BOT_WELCOME_TEXT;
  }
});

test("buildPolicyText covers store/delete/Telegram-policies/abuse with no external URL", () => {
  const text = buildPolicyText();
  assert.match(text, /<b>Policy \+ data handling<\/b>/);
  assert.match(text, /automated read-only lookup tool/);
  assert.match(text, /<b>What I store:<\/b>/);
  assert.match(text, /<b>Deletion:<\/b> DM <code>\/forgetme<\/code>/);
  assert.match(text, /https:\/\/telegram\.org\/tos/);
  assert.match(text, /https:\/\/telegram\.org\/privacy/);
  assert.match(text, /https:\/\/telegram\.org\/tos\/bots/);
  assert.match(text, /@notoscam/);
  // No operator-hosted URL surface — group-pinnable, DM-deliverable only.
  assert.equal(text.includes("Full policy:"), false);
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
  assert.match(text, /<b>VouchVault<\/b> was removed/);
  assert.match(text, /Post your vouch as a normal message in the group/);
  // v9: no Submit Vouch launcher anymore.
  assert.equal(text.includes("Submit Vouch"), false);
});

test("buildModerationWarnText: buy/sell branch with admin-bot username points at the admin bot", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "compound_buy_solicit",
    adminBotUsername: "VouchAdminBot",
  });
  assert.match(text, /removed by automated moderation/);
  assert.match(text, /To appeal, DM <code>@VouchAdminBot<\/code>/);
});

test("buildModerationWarnText: buy/sell branch without admin-bot username falls back to 'contact an admin'", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "phrase",
    adminBotUsername: null,
  });
  assert.match(text, /removed by automated moderation/);
  assert.match(text, /To appeal, contact an admin/);
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
