import { test } from "node:test";
import assert from "node:assert/strict";

const KNOWN_CALLBACKS = [
  "archive:start",
  "archive:start:-1001234567890",
  "archive:start:-100999999999999999",
  "archive:result:positive",
  "archive:result:mixed",
  "archive:result:negative",
  "archive:tag:good_comms",
  "archive:tag:efficient",
  "archive:tag:on_time",
  "archive:tag:good_quality",
  "archive:tag:mixed_comms",
  "archive:tag:some_delays",
  "archive:tag:acceptable_quality",
  "archive:tag:minor_issue",
  "archive:tag:poor_comms",
  "archive:tag:late",
  "archive:tag:quality_issue",
  "archive:tag:item_mismatch",
  "archive:done",
  "archive:cancel",
  "archive:confirm",
  "archive:skip_admin_note",
];

test("every callback data string is <= 64 bytes", () => {
  for (const cb of KNOWN_CALLBACKS) {
    const bytes = Buffer.byteLength(cb, "utf8");
    assert.ok(bytes <= 64, `${cb} is ${bytes} bytes`);
  }
});
