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
  buildTargetForceReplyMarkup,
  buildThreadedGroupReplyOptions,
  shouldSendThreadedLauncherReply,
} from "./telegramUx.ts";

test("buildArchiveEntryText renders compact live entries", () => {
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

  assert.equal(text, [
    "#42",
    "",
    "OP      @alice",
    "Target  @bobbiz",
    "Result  Positive",
  ].join("\n"));
});

test("buildArchiveEntryText renders compact legacy entries", () => {
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

  assert.equal(text, [
    "#7 [Legacy]",
    "",
    "OP      @legacyop",
    "Target  @oldvendor",
    "Result  Negative",
  ].join("\n"));
});

test("buildPreviewText keeps the DM review screen readable", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    entryType: "service",
    result: "positive",
    tags: ["good_comms", "on_time"],
  });

  assert.equal(text, [
    "Ready to post",
    "",
    "OP      @alice",
    "Target  @bobbiz",
    "Type    Service",
    "Result  Positive",
    "Tags    Good Comms, On Time",
  ].join("\n"));
});

test("group onboarding copy stays short and launcher-first", () => {
  assert.equal(buildGroupLauncherReplyText(), "Use the button below. The form opens in DM.");
  assert.match(buildWelcomeText(), /Start from the group launcher\./);
  assert.match(buildPinnedGuideText(), /1\. Tap Open Vouch Flow\./);
  assert.match(buildPinnedGuideText(), /\/lookup @username/);
});

test("bot profile text matches the launcher-first model", () => {
  assert.match(buildBotDescriptionText(), /group launcher/);
  assert.match(buildBotShortDescription(), /Submit in DM/);
});

test("telegram UX helpers favor threaded quiet replies", () => {
  assert.equal(shouldSendThreadedLauncherReply("/vouch"), true);
  assert.equal(shouldSendThreadedLauncherReply("/lookup"), false);
  assert.deepEqual(buildThreadedGroupReplyOptions(99), {
    replyToMessageId: 99,
    allowSendingWithoutReply: true,
    disableNotification: true,
  });
  assert.deepEqual(buildTargetForceReplyMarkup(), {
    force_reply: true,
    input_field_placeholder: "@businessname",
  });
});
