import test from "node:test";
import assert from "node:assert/strict";

import { buildAdminAuditRow } from "./adminAuditFormat.ts";

test("buildAdminAuditRow fills required fields and defaults optional ones to null/false", () => {
  const row = buildAdminAuditRow({
    adminTelegramId: 123,
    command: "/freeze",
  });

  assert.equal(row.adminTelegramId, 123);
  assert.equal(row.command, "/freeze");
  assert.equal(row.adminUsername, null);
  assert.equal(row.targetChatId, null);
  assert.equal(row.targetUsername, null);
  assert.equal(row.entryId, null);
  assert.equal(row.reason, null);
  assert.equal(row.denied, false);
});

test("buildAdminAuditRow preserves provided fields verbatim, including denied=true", () => {
  const row = buildAdminAuditRow({
    adminTelegramId: 1,
    adminUsername: "alice",
    command: "/remove_entry",
    targetChatId: -1001234567890,
    targetUsername: "scammer",
    entryId: 42,
    reason: "wrong status: published",
    denied: true,
  });

  assert.deepEqual(row, {
    adminTelegramId: 1,
    adminUsername: "alice",
    command: "/remove_entry",
    targetChatId: -1001234567890,
    targetUsername: "scammer",
    entryId: 42,
    reason: "wrong status: published",
    denied: true,
  });
});

test("buildAdminAuditRow normalizes undefined fields to null", () => {
  const row = buildAdminAuditRow({
    adminTelegramId: 99,
    adminUsername: undefined,
    command: "/unfreeze",
    targetChatId: undefined,
    targetUsername: undefined,
    entryId: undefined,
    reason: undefined,
  });

  assert.equal(row.adminUsername, null);
  assert.equal(row.targetChatId, null);
  assert.equal(row.targetUsername, null);
  assert.equal(row.entryId, null);
  assert.equal(row.reason, null);
  assert.equal(row.denied, false);
});
