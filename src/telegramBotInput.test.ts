import assert from "node:assert/strict";
import test from "node:test";

import { parseTypedTargetUsername } from "./telegramTargetInput.ts";

test("accepts a valid @username", () => {
  assert.deepEqual(parseTypedTargetUsername("@Target_User"), {
    targetUsername: "target_user",
    error: null,
  });
});

test("accepts a bare username token", () => {
  assert.deepEqual(parseTypedTargetUsername("Target_User"), {
    targetUsername: "target_user",
    error: null,
  });
});

test("rejects links instead of usernames", () => {
  assert.deepEqual(parseTypedTargetUsername("https://t.me/target_user"), {
    targetUsername: null,
    error: "Send only the @username, not a link.",
  });
});

test("rejects extra words around the username", () => {
  assert.deepEqual(parseTypedTargetUsername("@target_user thanks"), {
    targetUsername: null,
    error: "Send only one @username and nothing else.",
  });
});

test("rejects multiple handles", () => {
  assert.deepEqual(parseTypedTargetUsername("@target_user@other_user"), {
    targetUsername: null,
    error: "Send only one @username.",
  });
});

test("rejects invalid username shapes", () => {
  assert.deepEqual(parseTypedTargetUsername("@1234"), {
    targetUsername: null,
    error: "Send a valid Telegram @username.",
  });
});
