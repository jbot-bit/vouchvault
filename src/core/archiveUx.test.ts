import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArchiveEntryText,
  buildBotDescriptionText,
  buildBotShortDescription,
  buildGroupLauncherReplyText,
  buildPinnedGuideText,
  buildPreviewText,
  buildWelcomeText,
} from "./archive.ts";
import {
  buildReplyKeyboardRemove,
  buildTargetRequestReplyMarkup,
  buildThreadedGroupReplyOptions,
  shouldSendThreadedLauncherReply,
  TARGET_USER_REQUEST_ID,
} from "./telegramUx.ts";

test("buildArchiveEntryText renders live entries with bold labels and no heading", () => {
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
      "<b>From:</b> <b>@alice</b>",
      "<b>For:</b> <b>@bobbiz</b>",
      "<b>Vouch:</b> <b>Positive</b>",
      "<b>Tags:</b> Good Comms, On Time",
    ].join("\n"),
  );
});

test("buildArchiveEntryText renders legacy entries with bold labels, dd/mm/yyyy Date, and an italic '(repost)' footer", () => {
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
      "<b>From:</b> <b>@legacyop</b>",
      "<b>For:</b> <b>@oldvendor</b>",
      "<b>Vouch:</b> <b>Negative</b>",
      "<b>Tags:</b> Poor Comms",
      "<b>Date:</b> 02/11/2025",
      "",
      "<i>(repost)</i>",
    ].join("\n"),
  );
});

test("buildPreviewText mirrors the posted format with a bold underlined heading", () => {
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
      "<b>From:</b> <b>@alice</b>",
      "<b>For:</b> <b>@bobbiz</b>",
      "<b>Vouch:</b> <b>Positive</b>",
      "<b>Tags:</b> Good Comms, On Time",
    ].join("\n"),
  );
});

test("welcome text uses locked v3 wording", () => {
  const text = buildWelcomeText();
  assert.match(text, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(text, /Log and verify local-business service experiences/);
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
  assert.match(desc, /Log and verify local-business service experiences/);
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
