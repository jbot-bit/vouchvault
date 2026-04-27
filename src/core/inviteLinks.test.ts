import test from "node:test";
import assert from "node:assert/strict";

import { buildExpireDateUnix, validateInviteLinkParams } from "./inviteLinks.ts";

test("buildExpireDateUnix returns now + (expireHours * 3600) in seconds", () => {
  const fixed = new Date("2026-04-27T12:00:00.000Z");
  const result = buildExpireDateUnix(24, fixed);
  // Bot API expects integer Unix seconds (snapshot 11369-11373).
  assert.equal(typeof result, "number");
  assert.ok(Number.isInteger(result));
  // 24 hours = 86400 seconds.
  assert.equal(result, Math.floor(fixed.getTime() / 1000) + 86_400);
});

test("buildExpireDateUnix handles fractional expireHours (rounds down)", () => {
  const fixed = new Date("2026-04-27T12:00:00.000Z");
  // 1.5 hours = 5400 seconds; floored to 5400 (already integer).
  const result = buildExpireDateUnix(1.5, fixed);
  assert.equal(result, Math.floor(fixed.getTime() / 1000) + 5_400);
});

test("buildExpireDateUnix produces values future-dated relative to now", () => {
  const before = Math.floor(Date.now() / 1000);
  const result = buildExpireDateUnix(1);
  const after = Math.floor(Date.now() / 1000);
  // Result must sit in [before+3600, after+3600] inclusive.
  assert.ok(result >= before + 3600);
  assert.ok(result <= after + 3600);
});

test("validateInviteLinkParams rejects names longer than 32 chars (Bot API cap)", () => {
  assert.throws(
    () => validateInviteLinkParams({ name: "x".repeat(33) }),
    /must be 0-32 chars/,
  );
});

test("validateInviteLinkParams accepts names at the 32-char boundary", () => {
  validateInviteLinkParams({ name: "x".repeat(32) });
  validateInviteLinkParams({ name: "" });
  validateInviteLinkParams({ name: null });
});

test("validateInviteLinkParams rejects member_limit outside Bot API range 1-99999", () => {
  assert.throws(
    () => validateInviteLinkParams({ memberLimit: 0 }),
    /must be 1-99999/,
  );
  assert.throws(
    () => validateInviteLinkParams({ memberLimit: 100_000 }),
    /must be 1-99999/,
  );
});

test("validateInviteLinkParams accepts member_limit at the boundaries", () => {
  validateInviteLinkParams({ memberLimit: 1 });
  validateInviteLinkParams({ memberLimit: 99_999 });
});
