import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMirrorConfig, shouldMirror } from "./mirrorPublish.ts";

const allowed = [-1003744691748, -1003958981628] as const;

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: 42,
    chat: { id: -1003744691748 },
    from: { id: 1234, is_bot: false },
    ...overrides,
  };
}

test("shouldMirror: accepts a vanilla member post in an allowed group", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage(),
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    true,
  );
});

test("shouldMirror: rejects when moderation already deleted the message", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage(),
      allowedGroupChatIds: allowed,
      moderationDeleted: true,
    }),
    false,
  );
});

test("shouldMirror: rejects messages from outside allowed groups", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage({ chat: { id: -999 } }),
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    false,
  );
});

test("shouldMirror: rejects bot senders", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage({ from: { id: 1, is_bot: true } }),
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    false,
  );
});

test("shouldMirror: rejects via_bot relays", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage({ via_bot: { id: 99 } }),
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    false,
  );
});

test("shouldMirror: rejects messages missing message_id", () => {
  const msg = baseMessage();
  delete (msg as { message_id?: number }).message_id;
  assert.equal(
    shouldMirror({
      message: msg,
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    false,
  );
});

test("shouldMirror: rejects messages missing chat.id", () => {
  assert.equal(
    shouldMirror({
      message: baseMessage({ chat: {} }),
      allowedGroupChatIds: allowed,
      moderationDeleted: false,
    }),
    false,
  );
});

test("resolveMirrorConfig: returns null when VV_MIRROR_ENABLED is unset", () => {
  assert.equal(resolveMirrorConfig({ TELEGRAM_CHANNEL_ID: "-1001234567890" }), null);
});

test("resolveMirrorConfig: returns null when VV_MIRROR_ENABLED is not exactly 'true'", () => {
  assert.equal(
    resolveMirrorConfig({ VV_MIRROR_ENABLED: "1", TELEGRAM_CHANNEL_ID: "-1001234567890" }),
    null,
  );
});

test("resolveMirrorConfig: returns null when channel id is missing", () => {
  assert.equal(resolveMirrorConfig({ VV_MIRROR_ENABLED: "true" }), null);
});

test("resolveMirrorConfig: returns null when channel id has wrong shape", () => {
  assert.equal(
    resolveMirrorConfig({ VV_MIRROR_ENABLED: "true", TELEGRAM_CHANNEL_ID: "1234" }),
    null,
  );
  assert.equal(
    resolveMirrorConfig({ VV_MIRROR_ENABLED: "true", TELEGRAM_CHANNEL_ID: "-200123" }),
    null,
  );
});

test("resolveMirrorConfig: returns the parsed channel id when valid", () => {
  const result = resolveMirrorConfig({
    VV_MIRROR_ENABLED: "true",
    TELEGRAM_CHANNEL_ID: "-1001234567890",
  });
  assert.deepEqual(result, { channelChatId: -1001234567890 });
});
