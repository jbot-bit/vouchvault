import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBootEnv } from "./bootValidation.ts";

test("rejects missing TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_BOT_TOKEN/,
  );
});

test("rejects malformed TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "not-a-token",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_BOT_TOKEN/i,
  );
});

test("rejects empty TELEGRAM_ADMIN_IDS", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "",
        TELEGRAM_WEBHOOK_SECRET_TOKEN: "abc",
        NODE_ENV: "production",
      }),
    /TELEGRAM_ADMIN_IDS/,
  );
});

test("rejects missing TELEGRAM_WEBHOOK_SECRET_TOKEN in production", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        NODE_ENV: "production",
      }),
    /TELEGRAM_WEBHOOK_SECRET_TOKEN/i,
  );
});

test("accepts a valid full config", () => {
  assert.doesNotThrow(() =>
    validateBootEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "12345:abcdef-_xy",
      TELEGRAM_ALLOWED_CHAT_IDS: "-1001,-1002",
      TELEGRAM_ADMIN_IDS: "1,2",
      TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret_token-123",
      NODE_ENV: "production",
    }),
  );
});

test("non-production allows missing webhook secret", () => {
  assert.doesNotThrow(() =>
    validateBootEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "12345:abcdef",
      TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
      TELEGRAM_ADMIN_IDS: "1",
      NODE_ENV: "development",
    }),
  );
});
