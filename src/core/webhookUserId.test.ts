import test from "node:test";
import assert from "node:assert/strict";

import { extractUpdateUserId } from "./webhookUserId.ts";

test("extractUpdateUserId: returns null for null/undefined/{}", () => {
  assert.equal(extractUpdateUserId(null), null);
  assert.equal(extractUpdateUserId(undefined), null);
  assert.equal(extractUpdateUserId({}), null);
});

test("extractUpdateUserId: message.from.id", () => {
  assert.equal(
    extractUpdateUserId({ message: { from: { id: 12345 } } }),
    12345,
  );
});

test("extractUpdateUserId: edited_message.from.id", () => {
  assert.equal(
    extractUpdateUserId({ edited_message: { from: { id: 67890 } } }),
    67890,
  );
});

test("extractUpdateUserId: callback_query.from.id", () => {
  assert.equal(
    extractUpdateUserId({ callback_query: { from: { id: 1 } } }),
    1,
  );
});

test("extractUpdateUserId: my_chat_member / chat_member", () => {
  assert.equal(
    extractUpdateUserId({ my_chat_member: { from: { id: 100 } } }),
    100,
  );
  assert.equal(
    extractUpdateUserId({ chat_member: { from: { id: 200 } } }),
    200,
  );
});

test("extractUpdateUserId: inline_query / chosen_inline_result", () => {
  assert.equal(
    extractUpdateUserId({ inline_query: { from: { id: 300 } } }),
    300,
  );
  assert.equal(
    extractUpdateUserId({ chosen_inline_result: { from: { id: 400 } } }),
    400,
  );
});

test("extractUpdateUserId: rejects non-positive / non-finite / non-integer ids", () => {
  // Telegram user_ids are always positive; channel ids are negative.
  // We don't want to record channels in users_first_seen.
  assert.equal(extractUpdateUserId({ message: { from: { id: 0 } } }), null);
  assert.equal(extractUpdateUserId({ message: { from: { id: -1001234567890 } } }), null);
  assert.equal(
    extractUpdateUserId({ message: { from: { id: Number.NaN } } }),
    null,
  );
  assert.equal(
    extractUpdateUserId({ message: { from: { id: 1.5 } } }),
    null,
  );
  assert.equal(
    extractUpdateUserId({ message: { from: { id: "12345" as any } } }),
    null,
  );
  assert.equal(
    extractUpdateUserId({ message: { from: null as any } }),
    null,
  );
});

test("extractUpdateUserId: channel_post (no from) → null", () => {
  // A channel_post without a from has no user — return null.
  assert.equal(
    extractUpdateUserId({ channel_post: { from: null as any } }),
    null,
  );
});

test("extractUpdateUserId: prefers message over later kinds when both present", () => {
  // Telegram sends one kind per update, but the helper is defensive:
  // first-match wins.
  assert.equal(
    extractUpdateUserId({
      message: { from: { id: 111 } },
      callback_query: { from: { id: 222 } },
    }),
    111,
  );
});
