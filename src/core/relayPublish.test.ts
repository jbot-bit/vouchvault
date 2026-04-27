import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY_FOOTER_PREFIX,
  ENTRY_FOOTER_SUFFIX,
  buildChannelPostBody,
  buildChannelPostUrl,
  publishToChannelAndCapture,
} from "./relayPublish.ts";

test("buildChannelPostBody: prose + footer", () => {
  const out = buildChannelPostBody({
    proseEscaped: "Solid bloke, smooth pickup.",
    entryId: 42,
  });
  assert.equal(
    out,
    `Solid bloke, smooth pickup.\n\n${ENTRY_FOOTER_PREFIX}42${ENTRY_FOOTER_SUFFIX}`,
  );
});

test("buildChannelPostBody: HTML-escaped prose passes through unchanged", () => {
  // Wizard escapes; relay does not double-escape.
  const proseEscaped = "Said &quot;top tier&quot; &amp; meant it";
  const out = buildChannelPostBody({ proseEscaped, entryId: 7 });
  assert.ok(out.startsWith(proseEscaped));
});

test("buildChannelPostUrl: private channel -100xxxx → t.me/c/xxxx/<msgId>", () => {
  const url = buildChannelPostUrl(-1003744691748, 99);
  assert.equal(url, "https://t.me/c/3744691748/99");
});

test("buildChannelPostUrl: positive id treated as raw numeric", () => {
  const url = buildChannelPostUrl(123456, 5);
  assert.equal(url, "https://t.me/c/123456/5");
});

test("publishToChannelAndCapture: invokes sender with built body and returns id+url", async () => {
  let receivedChatId: number | null = null;
  let receivedBody: string | null = null;
  const result = await publishToChannelAndCapture({
    channelId: -1003744691748,
    proseEscaped: "All good",
    entryId: 11,
    sender: async (chatId, body) => {
      receivedChatId = chatId;
      receivedBody = body;
      return { message_id: 901 };
    },
  });
  assert.equal(receivedChatId, -1003744691748);
  assert.equal(receivedBody, `All good\n\n${ENTRY_FOOTER_PREFIX}11${ENTRY_FOOTER_SUFFIX}`);
  assert.equal(result.channelMessageId, 901);
  assert.equal(result.channelPostUrl, "https://t.me/c/3744691748/901");
});
