import test from "node:test";
import assert from "node:assert/strict";

import { buildTelegramSendMessageParams } from "./tools/telegramTools.ts";

test("buildTelegramSendMessageParams omits link_preview_options when unset", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
  });
  assert.equal(
    (params as { link_preview_options?: unknown }).link_preview_options,
    undefined,
  );
});

test("buildTelegramSendMessageParams forwards isDisabled=true as link_preview_options.is_disabled=true", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
    linkPreviewOptions: { isDisabled: true },
  });
  assert.deepEqual(
    (params as { link_preview_options?: { is_disabled?: boolean } })
      .link_preview_options,
    { is_disabled: true },
  );
});

test("buildTelegramSendMessageParams forwards isDisabled=false as link_preview_options.is_disabled=false", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
    linkPreviewOptions: { isDisabled: false },
  });
  assert.deepEqual(
    (params as { link_preview_options?: { is_disabled?: boolean } })
      .link_preview_options,
    { is_disabled: false },
  );
});
