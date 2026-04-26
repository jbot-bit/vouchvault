import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminHelpText,
  buildArchiveEntryText,
  buildBotDescriptionText,
  buildBotShortDescription,
  buildFrozenListText,
  buildGroupLauncherReplyText,
  buildLookupText,
  buildPinnedGuideText,
  buildPreviewText,
  buildProfileText,
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

test("buildArchiveEntryText renders live entries with a POS/MIX/NEG Vouch heading", () => {
  const text = buildArchiveEntryText({
    entryId: 42,
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    entryType: "service",
    result: "positive",
    tags: ["good_comms", "on_time"],
    createdAt: new Date("2026-04-24T10:00:00.000Z"),
    source: "live",
  });

  assert.equal(
    text,
    [
      "<b>POS Vouch &gt; @bobbiz</b>",
      "<b>From:</b> <b>@alice</b>",
      "<b>Tags:</b> Good Comms, On Time",
      "<code>#42</code>",
    ].join("\n"),
  );
});

test("buildArchiveEntryText renders legacy entries with a NEG heading and original Date, no repost footer", () => {
  const text = buildArchiveEntryText({
    entryId: 7,
    reviewerUsername: "legacyop",
    targetUsername: "oldvendor",
    entryType: "service",
    result: "negative",
    tags: ["poor_comms"],
    createdAt: new Date("2025-11-02T00:00:00.000Z"),
    source: "legacy_import",
    legacySourceTimestamp: new Date(Date.UTC(2025, 10, 2, 12)),
  });

  assert.equal(
    text,
    [
      "<b>NEG Vouch &gt; @oldvendor</b>",
      "<b>From:</b> <b>@legacyop</b>",
      "<b>Tags:</b> Poor Comms",
      "<b>Date:</b> 02/11/2025",
      "<code>#7</code>",
    ].join("\n"),
  );
});

test("buildArchiveEntryText puts the tap-to-copy id last, after the Date line on legacy", () => {
  const live = buildArchiveEntryText({
    entryId: 100,
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    entryType: "service",
    result: "positive",
    tags: ["good_comms"],
    createdAt: new Date("2026-04-26T00:00:00.000Z"),
    source: "live",
  });
  assert.match(live, /<code>#100<\/code>$/);

  const legacy = buildArchiveEntryText({
    entryId: 9,
    reviewerUsername: "legacyop",
    targetUsername: "oldvendor",
    entryType: "service",
    result: "negative",
    tags: ["poor_comms"],
    createdAt: new Date("2025-11-02T00:00:00.000Z"),
    source: "legacy_import",
    legacySourceTimestamp: new Date(Date.UTC(2025, 10, 2, 12)),
  });
  // ID line is the absolute last line, after the Date line.
  const lines = legacy.split("\n");
  assert.equal(lines[lines.length - 1], "<code>#9</code>");
  assert.equal(lines[lines.length - 2], "<b>Date:</b> 02/11/2025");
});

test("buildArchiveEntryText uses MIX prefix for mixed-result entries", () => {
  const text = buildArchiveEntryText({
    entryId: 99,
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    entryType: "service",
    result: "mixed",
    tags: ["mixed_comms", "some_delays"],
    createdAt: new Date("2026-04-24T10:00:00.000Z"),
    source: "live",
  });

  assert.match(text, /^<b>MIX Vouch &gt; @bobbiz<\/b>/);
});

test("buildPreviewText mirrors the posted format under a Preview heading + attestation", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "positive",
    tags: ["good_comms", "on_time"],
  });

  assert.equal(
    text,
    [
      "<b><u>Preview</u></b>",
      "",
      "<b>POS Vouch &gt; @bobbiz</b>",
      "<b>From:</b> <b>@alice</b>",
      "<b>Tags:</b> Good Comms, On Time",
      "",
      "<i>By confirming, you declare you personally know this member and stand behind this vouch. You are responsible for what you submit.</i>",
    ].join("\n"),
  );
});

test("buildPreviewText includes the honest-opinion attestation line", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "positive",
    tags: ["good_comms"],
  });
  assert.match(
    text,
    /By confirming, you declare you personally know this member and stand behind this vouch\./,
  );
});

test("buildPreviewText shows admin-only-note label only when note provided", () => {
  const without = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "negative",
    tags: ["poor_comms"],
  });
  assert.equal(without.includes("Admin-only note"), false);

  const withNote = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "negative",
    tags: ["poor_comms"],
    privateNote: "they did not show up twice",
  });
  assert.match(
    withNote,
    /Admin-only note \(not published\):<\/i> they did not show up twice/,
  );
});

test("buildPreviewText HTML-escapes the admin-only note", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "negative",
    tags: ["poor_comms"],
    privateNote: "owes <script>",
  });
  assert.match(text, /owes &lt;script&gt;/);
  assert.equal(text.includes("<script>"), false);
});

test("welcome text uses locked v3.2 wording (community-framing, /profile, chat-moderation)", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Vouch for members you personally know/);
  assert.match(text, /community helps each other find trustworthy people to deal with/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Tap <b>Submit Vouch<\/b> in the group/);
  assert.match(text, /Send the target @username here/);
  assert.match(text, /Choose result and tags/);
  assert.match(text, /I post the entry back to the group/);
  assert.match(text, /<b><u>Check before you deal<\/u><\/b>/);
  assert.match(text, /\/profile @username/);
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /auto-removed/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
  assert.match(text, /Follow Telegram's Terms of Service/);
  // No commerce vocabulary in the locked copy.
  assert.equal(text.includes("local-business"), false);
  assert.equal(text.includes("service experiences"), false);
});

test("pinned guide text uses locked v3.2 wording (community-framing, /profile, chat-moderation)", () => {
  const text = buildPinnedGuideText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Vouch for members you personally know/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Tap <b>Submit Vouch<\/b> below/);
  assert.match(text, /In DM, send only the target @username/);
  assert.match(text, /I post the final entry back here/);
  assert.match(text, /<b><u>Check before you deal<\/u><\/b>/);
  assert.match(text, /\/profile @username/);
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /auto-removed/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
  assert.match(text, /Follow Telegram's Terms of Service/);
  assert.equal(text.includes("local-business"), false);
});

test("bot profile text uses the locked v3.1 copy (community-framing)", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /community vouch hub for members who personally know each other/);
  assert.match(desc, /Tap Submit Vouch/);
  assert.match(desc, /Follow Telegram's Terms of Service/);
  assert.equal(desc.includes("local-business"), false);
  assert.equal(desc.includes("service experiences"), false);
  assert.ok(desc.length <= 512);

  const short = buildBotShortDescription();
  assert.match(short, /Vouch Hub/);
  assert.match(short, /community vouches between members who know each other/);
  assert.equal(short.includes("local-business"), false);
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
  // The bot description has a 512-char Telegram limit and uses a compact
  // rules line. The full block is carried by welcome / pinned only.
  assert.match(desc, /Follow Telegram's Terms of Service/);
  assert.match(desc, /Vouch only members you know personally/);
  assert.match(desc, /You are responsible for your vouches/);
  // Not the multi-bullet shape:
  assert.equal(desc.includes("<b>Rules</b>"), false);
  assert.ok(desc.length <= 512, `bot description is ${desc.length} chars`);
});

test("locked v3 copy uses 'review' not 'verify' to avoid the marketplace ML keyword cluster", () => {
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
  assert.equal(shouldSendThreadedLauncherReply("/vouch"), true);
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
  assert.match(text, /…and 3 more — refine with \/lookup @x/);
});

test("buildProfileText member view shows P/M counts (Negative hidden) and Caution status when negatives exist", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 4, mixed: 1, negative: 2 },
    isFrozen: false,
    freezeReason: null,
    recent: [
      { id: 42, result: "positive", createdAt: new Date(Date.UTC(2026, 3, 5, 12)) },
      { id: 41, result: "negative", createdAt: new Date(Date.UTC(2026, 3, 4, 12)) },
    ],
    hasCaution: true,
  });

  assert.match(text, /<b><u>@bobbiz<\/u><\/b>/);
  assert.match(text, /Positive: 4 • Mixed: 1/);
  // Negative count is hidden from members.
  assert.equal(text.includes("Negative"), false);
  assert.match(text, /Status: Caution/);
  assert.match(text, /<b>Last 5 entries<\/b>/);
  assert.match(text, /<b>#42<\/b> — <b>Positive<\/b> • 05\/04\/2026/);
  // NEG #41 must be filtered out of the member-visible recent list.
  assert.equal(text.includes("#41"), false);
});

test("buildProfileText shows Active when no NEGs and not frozen", () => {
  const text = buildProfileText({
    targetUsername: "alice",
    totals: { positive: 3, mixed: 0, negative: 0 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: false,
  });
  assert.match(text, /Status: Active/);
});

test("buildProfileText shows Frozen status (enum label) when frozen, no recent block when none", () => {
  const text = buildProfileText({
    targetUsername: "icebox",
    totals: { positive: 0, mixed: 0, negative: 1 },
    isFrozen: true,
    freezeReason: "policy_violation",
    recent: [],
    hasCaution: true,
  });

  assert.match(text, /Status: Frozen — <i>policy violation<\/i>/);
  // Frozen wins over Caution.
  assert.equal(text.includes("Status: Caution"), false);
  assert.doesNotMatch(text, /Last 5 entries/);
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

test("buildAdminHelpText lists every admin command", () => {
  const text = buildAdminHelpText();
  assert.match(text, /<b><u>Admin commands<\/u><\/b>/);
  for (const cmd of [
    "/freeze @x",
    "/unfreeze @x",
    "/frozen_list",
    "/remove_entry",
    "/recover_entry",
    "/profile @x",
    "/lookup @x",
    "/pause",
    "/unpause",
  ]) {
    assert.match(text, new RegExp(cmd.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")));
  }
});
