import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountTooNewText,
  buildAdminBotDescription,
  buildAdminBotShortDescription,
  buildAdminHelpText,
  buildBotDescriptionText,
  buildBotShortDescription,
  buildFrozenListText,
  buildLookupBotDescription,
  buildLookupBotShortDescription,
  buildLookupText,
  buildModerationWarnText,
  buildPinnedGuideText,
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
// DM /search @user searches the legacy archive (S3 + S4). /lookup is
// kept as a routing alias only — copy uses /search. Drift in any of
// these requires a v9 spec amendment first.

test("welcome text describes the v9 member-post flow (no wizard)", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Vouch for members you personally know/);
  assert.match(text, /community helps each other find trustworthy people to deal with/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Post your vouch as a normal message in the group/);
  assert.match(text, /There is no form to fill in/);
  assert.match(text, /<b><u>Check before you deal<\/u><\/b>/);
  assert.match(text, /search bar at the top of the group/);
  assert.match(text, /DM me <code>\/search @username<\/code>/);
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /auto-removed/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
  assert.match(text, /Follow Telegram's Terms of Service/);
  // v9: no wizard. Text must not refer to the deleted "Submit Vouch" launcher.
  assert.equal(text.includes("Submit Vouch"), false);
  assert.equal(text.includes("/lookup"), false);
  assert.equal(text.includes("local-business"), false);
});

test("pinned guide text describes the v9 member-post flow (no wizard)", () => {
  const text = buildPinnedGuideText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Vouch for members you personally know/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Post your vouch as a normal message in this group/);
  assert.match(text, /<b><u>Check before you deal<\/u><\/b>/);
  assert.match(text, /search bar at the top of this group/);
  assert.match(text, /DM me <code>\/search @username<\/code>/);
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /auto-removed/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
  assert.match(text, /Follow Telegram's Terms of Service/);
  assert.equal(text.includes("Submit Vouch"), false);
  assert.equal(text.includes("/lookup"), false);
  assert.equal(text.includes("local-business"), false);
});

test("bot description describes the v9 search-only role (no wizard)", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /community vouch hub for members who personally know each other/);
  assert.match(desc, /members post vouches as normal messages in the group/);
  assert.match(desc, /\/search @username/);
  assert.match(desc, /I never post vouches on your behalf/);
  assert.match(desc, /Follow Telegram's Terms of Service/);
  assert.equal(desc.includes("Submit Vouch"), false);
  assert.equal(desc.includes("local-business"), false);
  assert.ok(desc.length <= 512);

  const short = buildBotShortDescription();
  assert.match(short, /Vouch Hub/);
  assert.match(short, /search community vouches/i);
  assert.match(short, /\/search @username/);
  assert.equal(short.includes("Submit Vouch"), false);
  assert.ok(short.length <= 120);
});

test("rules block contains the four bullets in welcome and pinned guide", () => {
  const surfaces = [buildWelcomeText(), buildPinnedGuideText()];
  for (const text of surfaces) {
    assert.match(text, /<b>Rules<\/b>/);
    assert.match(text, /Follow Telegram's Terms of Service/);
    assert.match(text, /Vouch only for members you actually know personally/);
    assert.match(text, /No personal opinions about people, no rating individuals, no vouching minors/);
    assert.match(text, /You are responsible for the accuracy of your own vouches/);
  }
});

test("bot description carries the compact rules line (≤512 chars limit)", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /Follow Telegram's Terms of Service/);
  assert.match(desc, /Vouch only members you know personally/);
  assert.match(desc, /You are responsible for your vouches/);
  assert.equal(desc.includes("<b>Rules</b>"), false);
  assert.ok(desc.length <= 512, `bot description is ${desc.length} chars`);
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
  // v9: only /search (alias /lookup) remains as a group command surface; /vouch is gone.
  assert.equal(shouldSendThreadedLauncherReply("/search"), false);
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

test("buildLookupText shows Active status under heading when not frozen", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
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
  assert.match(text, /<b>#42<\/b>/);
});

test("buildLookupText shows Frozen status with reason under heading when frozen", () => {
  const text = buildLookupText({
    targetUsername: "icebox",
    isFrozen: true,
    freezeReason: "scam attempt",
    entries: [],
  });

  assert.match(text, /<b><u>@icebox<\/u><\/b>/);
  assert.match(text, /Status: Frozen — <i>scam attempt<\/i>/);
  assert.match(text, /No entries for <b>@icebox<\/b>\./);
});

test("buildLookupText falls back to 'no reason given' when frozen with null reason", () => {
  const text = buildLookupText({
    targetUsername: "icebox",
    isFrozen: true,
    freezeReason: null,
    entries: [],
  });

  assert.match(text, /Status: Frozen — <i>no reason given<\/i>/);
});

test("fmtDate renders dd/mm/yyyy in UTC", () => {
  assert.equal(fmtDate(new Date(Date.UTC(2026, 3, 5, 12))), "05/04/2026");
  assert.equal(fmtDate(new Date(Date.UTC(2025, 10, 2, 0))), "02/11/2025");
});

test("fmtDateTime renders dd/mm/yyyy HH:MM in UTC", () => {
  assert.equal(fmtDateTime(new Date(Date.UTC(2026, 3, 5, 9, 7))), "05/04/2026 09:07");
  assert.equal(fmtDateTime(new Date(Date.UTC(2025, 10, 2, 23, 45))), "02/11/2025 23:45");
});

test("buildAdminHelpText lists every admin command (v9 — /search renamed from /lookup, no /vouch)", () => {
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
  ]) {
    assert.match(text, new RegExp(cmd.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")));
  }
  // /vouch was removed in v9 phase 3 and stays gone.
  assert.doesNotMatch(text, /\/vouch/);
});

test("buildLookupBotShortDescription is the locked copy", () => {
  assert.equal(
    buildLookupBotShortDescription(),
    "Search vouches by @username. Read-only lookup bot for the Vouch Hub community.",
  );
});

test("buildLookupBotDescription is the locked copy", () => {
  const text = buildLookupBotDescription();
  assert.match(text, /Read-only lookup for the Vouch Hub community\./);
  assert.match(text, /search bar at the top of the group/);
  assert.match(text, /never post vouches/);
});

test("buildAdminBotShortDescription is the locked copy", () => {
  assert.equal(
    buildAdminBotShortDescription(),
    "Admin tooling for the Vouch Hub. Restricted access — operator commands only.",
  );
});

test("buildAdminBotDescription is the locked copy", () => {
  const text = buildAdminBotDescription();
  assert.match(text, /Operator-only admin bot/);
  assert.match(text, /freeze\/unfreeze\/audit/);
  assert.match(text, /chat-moderation/);
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
  assert.match(text, /look like buy\/sell/);
  assert.match(text, /DM <code>@VouchAdminBot<\/code>/);
});

test("buildModerationWarnText: buy/sell branch without admin-bot username falls back to 'contact an admin'", () => {
  const text = buildModerationWarnText({
    groupName: "VouchVault",
    hitSource: "phrase",
    adminBotUsername: null,
  });
  assert.match(text, /contact an admin/);
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
