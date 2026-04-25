import test from "node:test";
import assert from "node:assert/strict";

import { parseChatMigration, shouldMarkChatKicked } from "./telegramDispatch.ts";

test("shouldMarkChatKicked is true for 'kicked' and 'left'", () => {
  assert.equal(shouldMarkChatKicked("kicked"), true);
  assert.equal(shouldMarkChatKicked("left"), true);
});

test("shouldMarkChatKicked is false for member-like statuses", () => {
  for (const status of ["member", "administrator", "creator", "restricted"]) {
    assert.equal(shouldMarkChatKicked(status), false, status);
  }
});

test("shouldMarkChatKicked is false for missing/null/undefined status", () => {
  assert.equal(shouldMarkChatKicked(undefined), false);
  assert.equal(shouldMarkChatKicked(null), false);
  assert.equal(shouldMarkChatKicked(""), false);
});

test("parseChatMigration extracts old + new chat ids when both are safe integers", () => {
  const parsed = parseChatMigration({
    chat: { id: -1001 },
    migrate_to_chat_id: -1001234567890,
  });
  assert.deepEqual(parsed, { oldId: -1001, newId: -1001234567890 });
});

test("parseChatMigration returns null when migrate_to_chat_id is absent", () => {
  assert.equal(parseChatMigration({ chat: { id: -1001 } }), null);
  assert.equal(parseChatMigration({ chat: { id: -1001 }, migrate_to_chat_id: null }), null);
  assert.equal(parseChatMigration(null), null);
  assert.equal(parseChatMigration(undefined), null);
});

test("parseChatMigration returns null when ids are not safe integers", () => {
  assert.equal(
    parseChatMigration({ chat: { id: "not-a-number" }, migrate_to_chat_id: 5 }),
    null,
  );
  assert.equal(parseChatMigration({ chat: { id: 1 }, migrate_to_chat_id: "x" }), null);
});
