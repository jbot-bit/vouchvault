import assert from "node:assert/strict";
import test from "node:test";

import {
  beginForget,
  buildForgetCancelledText,
  buildForgetDoneText,
  buildForgetExpiredText,
  buildForgetFinalConfirmMarkup,
  buildForgetFinalConfirmText,
  buildForgetGroupRedirectText,
  buildForgetPromptText,
  createForgetState,
  executeForget,
  FORGET_CONFIRM_TTL_MS,
  FORGET_FINAL_TTL_MS,
  tryConfirmForget,
  tryFinalizeForget,
  type ForgetDeps,
} from "./forgetMe.ts";

test("buildForgetPromptText names the deletion scope and the YES window", () => {
  const text = buildForgetPromptText();
  assert.match(text, /Wipes every vouch you wrote/);
  assert.match(text, /Vouches others wrote about you stay/);
  assert.match(text, /Reply <code>YES<\/code> within 5 min/);
  assert.ok(text.length <= 250, `forget prompt is ${text.length} chars`);
});

test("buildForgetFinalConfirmText is short and unambiguous", () => {
  const text = buildForgetFinalConfirmText();
  assert.match(text, /Last chance/);
  assert.match(text, /Tap Confirm/);
  assert.ok(text.length <= 80);
});

test("buildForgetFinalConfirmMarkup carries fg:y + fg:n callbacks", () => {
  const markup = buildForgetFinalConfirmMarkup();
  assert.equal(markup.inline_keyboard.length, 1);
  assert.equal(markup.inline_keyboard[0]!.length, 2);
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, "fg:y");
  assert.equal(markup.inline_keyboard[0]![1]!.callback_data, "fg:n");
});

test("buildForgetDoneText pluralises 'row' correctly", () => {
  assert.equal(buildForgetDoneText(1), "Wiped 1 row.");
  assert.equal(buildForgetDoneText(7), "Wiped 7 rows.");
});

test("buildForgetExpiredText + cancelled + group-redirect copy", () => {
  assert.match(buildForgetExpiredText(), /Expired/);
  assert.equal(buildForgetCancelledText(), "Cancelled.");
  assert.match(buildForgetGroupRedirectText(), /DM me to use \/forgetme/);
});

test("beginForget records awaitingYes pending state and returns prompt", () => {
  const state = createForgetState();
  const step = beginForget(state, 42, 1_000);
  assert.deepEqual(step, { kind: "prompt" });
  const pending = state.pendingByUser.get(42);
  assert.equal(pending?.stage, "awaitingYes");
  assert.equal(pending?.expiresAt, 1_000 + FORGET_CONFIRM_TTL_MS);
});

test("tryConfirmForget with YES inside the window advances to awaitingFinal (does NOT execute)", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "yes", 1_000 + 60_000);
  assert.deepEqual(step, { kind: "awaitingFinal" });
  // State persists with new stage + refreshed TTL.
  const pending = state.pendingByUser.get(42);
  assert.equal(pending?.stage, "awaitingFinal");
  assert.equal(pending?.expiresAt, 1_000 + 60_000 + FORGET_FINAL_TTL_MS);
});

test("tryConfirmForget with YES after the window returns expired and clears state", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "YES", 1_000 + FORGET_CONFIRM_TTL_MS + 1);
  assert.deepEqual(step, { kind: "expired" });
  assert.equal(state.pendingByUser.has(42), false);
});

test("tryConfirmForget with non-YES reply ignores and keeps awaitingYes state", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryConfirmForget(state, 42, "no", 1_000 + 60_000);
  assert.deepEqual(step, { kind: "ignore" });
  assert.equal(state.pendingByUser.get(42)?.stage, "awaitingYes");
});

test("tryConfirmForget with no pending state ignores", () => {
  const state = createForgetState();
  const step = tryConfirmForget(state, 42, "YES", 1_000);
  assert.deepEqual(step, { kind: "ignore" });
});

test("tryConfirmForget cannot bypass stage 2 — typing YES twice does not execute", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  // First YES → advances to awaitingFinal.
  assert.deepEqual(
    tryConfirmForget(state, 42, "YES", 1_000 + 1_000),
    { kind: "awaitingFinal" },
  );
  // Second YES while awaitingFinal must NOT execute — execution
  // requires the button tap (tryFinalizeForget). This is the
  // double-confirm guarantee.
  assert.deepEqual(
    tryConfirmForget(state, 42, "YES", 1_000 + 2_000),
    { kind: "ignore" },
  );
  // State remains awaitingFinal — the user still has a button to tap.
  assert.equal(state.pendingByUser.get(42)?.stage, "awaitingFinal");
});

test("tryFinalizeForget executes when awaitingFinal within the window", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  tryConfirmForget(state, 42, "YES", 1_000 + 60_000);
  const step = tryFinalizeForget(state, 42, 1_000 + 60_000 + 1_000);
  assert.deepEqual(step, { kind: "execute" });
  assert.equal(state.pendingByUser.has(42), false);
});

test("tryFinalizeForget returns expired when stage-2 window has passed", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  tryConfirmForget(state, 42, "YES", 1_000 + 1_000);
  // 1_000 (begin) + 1_000 (yes) → final TTL starts at 2_000.
  const step = tryFinalizeForget(state, 42, 2_000 + FORGET_FINAL_TTL_MS + 1);
  assert.deepEqual(step, { kind: "expired" });
  assert.equal(state.pendingByUser.has(42), false);
});

test("tryFinalizeForget without stage 1 ignores (button tap with no pending YES)", () => {
  const state = createForgetState();
  const step = tryFinalizeForget(state, 42, 1_000);
  assert.deepEqual(step, { kind: "ignore" });
});

test("tryFinalizeForget while still awaitingYes ignores (button can't skip stage 1)", () => {
  const state = createForgetState();
  beginForget(state, 42, 1_000);
  const step = tryFinalizeForget(state, 42, 1_000 + 1_000);
  assert.deepEqual(step, { kind: "ignore" });
  assert.equal(state.pendingByUser.get(42)?.stage, "awaitingYes");
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
