import test from "node:test";
import assert from "node:assert/strict";

import { buildTelegramSendMessageParams } from "./tools/telegramTools.ts";

test("buildTelegramSendMessageParams forwards protectContent as protect_content=true", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
    protectContent: true,
  });
  assert.equal((params as { protect_content?: boolean }).protect_content, true);
});

test("buildTelegramSendMessageParams omits protect_content when not set", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
  });
  assert.equal((params as { protect_content?: boolean }).protect_content, undefined);
});

test("buildTelegramSendMessageParams forwards protect_content=false explicitly", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
    protectContent: false,
  });
  assert.equal((params as { protect_content?: boolean }).protect_content, false);
});
