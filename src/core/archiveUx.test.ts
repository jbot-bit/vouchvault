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

test("buildArchiveEntryText renders compact live entries with HTML formatting", () => {
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
      "🧾 <b>Entry #42</b>",
      "",
      "OP: <b>@alice</b>",
      "Target: <b>@bobbiz</b>",
      "Result: <b>Positive</b>",
    ].join("\n"),
  );
});

test("buildArchiveEntryText renders compact legacy entries with HTML formatting", () => {
  const text = buildArchiveEntryText({
    entryId: 7,
    reviewerUsername: "legacyop",
    targetUsername: "oldvendor",
    entryType: "service",
    result: "negative",
    tags: ["poor_comms"],
    createdAt: new Date("2025-11-02T00:00:00.000Z"),
    source: "legacy_import",
    legacySourceTimestamp: new Date("2025-11-02T00:00:00.000Z"),
  });

  assert.equal(
    text,
    [
      "🧾 <b>Legacy Entry #7</b>",
      "",
      "OP: <b>@legacyop</b>",
      "Target: <b>@oldvendor</b>",
      "Result: <b>Negative</b>",
      "Original: 2025-11-02",
    ].join("\n"),
  );
});

test("buildPreviewText renders the DM review screen with a bold heading", () => {
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
      "OP: <b>@alice</b>",
      "Target: <b>@bobbiz</b>",
      "Result: <b>Positive</b>",
      "Tags: Good Comms, On Time",
    ].join("\n"),
  );
});

test("welcome and pinned guide use the business-hub framing and How to Vouch walkthrough", () => {
  assert.equal(buildGroupLauncherReplyText(), "Tap below to submit your vouch in DM.");

  const welcome = buildWelcomeText();
  assert.match(welcome, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(welcome, /business hub for local businesses/);
  assert.match(welcome, /<b><u>How to Vouch<\/u><\/b>/);
  assert.match(welcome, /1\. Tap <b>Submit Vouch<\/b> in the group\./);
  assert.match(welcome, /Telegram's Terms of Service/);
  assert.match(welcome, /No illegal activity/);

  const guide = buildPinnedGuideText();
  assert.match(guide, /<b>Welcome to the Vouch Hub<\/b>/);
  assert.match(guide, /business hub for local businesses/);
  assert.match(guide, /<b><u>How to Vouch<\/u><\/b>/);
  assert.match(guide, /1\. Tap <b>Submit Vouch<\/b> below\./);
  assert.match(guide, /Telegram's Terms of Service/);
  assert.match(guide, /No illegal activity/);
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
