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
    ].join("\n"),
  );
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

test("buildPreviewText mirrors the posted format under a Preview heading", () => {
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
    ].join("\n"),
  );
});

test("welcome text uses locked v3 wording", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Log and review local-business service experiences/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Tap <b>Submit Vouch<\/b> in the group/);
  assert.match(text, /Send the target @username here/);
  assert.match(text, /Choose result and tags/);
  assert.match(text, /I post the entry back to the group/);
  assert.match(text, /Lawful use only — follow Telegram's Terms of Service/);
});

test("pinned guide text uses locked v3 wording", () => {
  const text = buildPinnedGuideText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /<b><u>How to vouch<\/u><\/b>/);
  assert.match(text, /Tap <b>Submit Vouch<\/b> below/);
  assert.match(text, /In DM, send only the target @username/);
  assert.match(text, /I post the final entry back here/);
  assert.match(text, /Lawful use only/);
});

test("bot profile text uses the locked v3 copy", () => {
  const desc = buildBotDescriptionText();
  assert.match(desc, /Log and review local-business service experiences/);
  assert.match(desc, /Tap Submit Vouch/);
  assert.match(desc, /Lawful use only/);
  assert.ok(desc.length <= 512);

  const short = buildBotShortDescription();
  assert.match(short, /Vouch Hub/);
  assert.match(short, /local-business service experiences/);
  assert.ok(short.length <= 120);
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

test("buildProfileText renders totals, status and last 5 entries", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 4, mixed: 1, negative: 2 },
    isFrozen: false,
    freezeReason: null,
    recent: [
      { id: 42, result: "positive", createdAt: new Date(Date.UTC(2026, 3, 5, 12)) },
      { id: 41, result: "negative", createdAt: new Date(Date.UTC(2026, 3, 4, 12)) },
    ],
  });

  assert.match(text, /<b><u>@bobbiz<\/u><\/b>/);
  assert.match(text, /Positive: 4 • Mixed: 1 • Negative: 2/);
  assert.match(text, /Status: Active/);
  assert.match(text, /<b>Last 5 entries<\/b>/);
  assert.match(text, /<b>#42<\/b> — <b>Positive<\/b> • 05\/04\/2026/);
  assert.match(text, /<b>#41<\/b> — <b>Negative<\/b> • 04\/04\/2026/);
});

test("buildProfileText shows Frozen status with reason when frozen, no recent block when none", () => {
  const text = buildProfileText({
    targetUsername: "icebox",
    totals: { positive: 0, mixed: 0, negative: 1 },
    isFrozen: true,
    freezeReason: "scam attempt 2025-12",
    recent: [],
  });

  assert.match(text, /Status: Frozen — <i>scam attempt 2025-12<\/i>/);
  assert.doesNotMatch(text, /Last 5 entries/);
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
