import assert from "node:assert/strict";
import test from "node:test";

import {
  beginForget,
  buildForgetCancelledText,
  buildForgetDoneText,
  buildForgetExpiredText,
  buildForgetGroupRedirectText,
  buildForgetPromptText,
  createForgetState,
  executeForget,
  FORGET_CONFIRM_TTL_MS,
  tryConfirmForget,
  type ForgetDeps,
} from "./forgetMe.ts";

test("buildForgetPromptText names the deletion scope and the YES window", () => {
  const text = buildForgetPromptText();
  assert.match(text, /<b>Forget me — confirm<\/b>/);
  assert.match(text, /every vouch <b>you authored<\/b>/);
  assert.match(text, /Vouches other members wrote <b>about<\/b> you stay/);
  assert.match(text, /Reply <code>YES<\/code> within 5 minutes/);
});

test("buildForgetDoneText pluralises 'row' correctly", () => {
  assert.match(buildForgetDoneText(1), /deleted 1 row /);
  assert.match(buildForgetDoneText(7), /deleted 7 rows /);
});

test("buildForgetExpiredText + cancelled + group-redirect copy", () => {
  assert.match(buildForgetExpiredText(), /Confirmation window expired/);
  assert.equal(buildForgetCancelledText(), "Cancelled. Your data is unchanged.");
  assert.match(buildForgetGroupRedirectText(), /DM me to use \/forgetme/);
});

test("beginForget records pending state and returns prompt", () => {
  const state = createForgetState();
  const step = beginForget(state, 42, 1_000);
  assert.deepEqual(step, { kind: "prompt" });
  assert.equal(state.pendingByUser.get(42), 1_000 + FORGET_CONFIRM_TTL_MS);
});

test("tryConfirmForget with YES inside the window executes and clears state", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "yes", 1_000 + 60_000);
  assert.deepEqual(step, { kind: "execute" });
  assert.equal(state.pendingByUser.has(42), false);
});

test("tryConfirmForget with YES after the window returns expired and clears state", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "YES", 1_000 + FORGET_CONFIRM_TTL_MS + 1);
  assert.deepEqual(step, { kind: "expired" });
  assert.equal(state.pendingByUser.has(42), false);
});

test("tryConfirmForget with non-YES reply ignores", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "no", 1_000 + 60_000);
  assert.deepEqual(step, { kind: "ignore" });
  assert.equal(state.pendingByUser.has(42), true);
});

test("tryConfirmForget with no pending state ignores", () => {
  const state = createForgetState();
  const step = tryConfirmForget(state, 42, "YES", 1_000);
  assert.deepEqual(step, { kind: "ignore" });
});

test("executeForget calls all delete deps in order, audits, sums rowcounts", async () => {
  const calls: string[] = [];
  const deps: ForgetDeps = {
    async deleteVouchEntries({ userId, username }) {
      calls.push(`entries:${userId}:${username}`);
      return 3;
    },
    async deleteVouchDrafts(userId) {
      calls.push(`drafts:${userId}`);
      return 1;
    },
    async deleteUsersFirstSeen(userId) {
      calls.push(`firstseen:${userId}`);
      return 1;
    },
    async deleteUsers(userId) {
      calls.push(`users:${userId}`);
      return 1;
    },
    async audit({ userId, username }) {
      calls.push(`audit:${userId}:${username}`);
    },
  };

  const total = await executeForget({ userId: 42, username: "bobbiz" }, deps);
  assert.equal(total, 6);
  assert.deepEqual(calls, [
    "entries:42:bobbiz",
    "drafts:42",
    "firstseen:42",
    "users:42",
    "audit:42:bobbiz",
  ]);
});

test("executeForget with null username still passes through to deps", async () => {
  let receivedUsername: string | null | undefined = "sentinel";
  const deps: ForgetDeps = {
    async deleteVouchEntries({ username }) {
      receivedUsername = username;
      return 0;
    },
    async deleteVouchDrafts() {
      return 0;
    },
    async deleteUsersFirstSeen() {
      return 0;
    },
    async deleteUsers() {
      return 0;
    },
    async audit() {},
  };
  await executeForget({ userId: 99, username: null }, deps);
  assert.equal(receivedUsername, null);
});
