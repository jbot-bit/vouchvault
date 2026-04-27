import { test } from "node:test";
import assert from "node:assert/strict";
import { describeOptInFeatures, validateBootEnv } from "./bootValidation.ts";

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

test("VV_RELAY_ENABLED=true requires TELEGRAM_CHANNEL_ID", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        NODE_ENV: "development",
        VV_RELAY_ENABLED: "true",
      }),
    /TELEGRAM_CHANNEL_ID/,
  );
});

test("VV_RELAY_ENABLED=true rejects TELEGRAM_CHANNEL_ID without -100 prefix", () => {
  assert.throws(
    () =>
      validateBootEnv({
        DATABASE_URL: "postgres://x",
        TELEGRAM_BOT_TOKEN: "12345:abcdef",
        TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
        TELEGRAM_ADMIN_IDS: "1",
        NODE_ENV: "development",
        VV_RELAY_ENABLED: "true",
        TELEGRAM_CHANNEL_ID: "12345",
      }),
    /TELEGRAM_CHANNEL_ID.*-100 prefix/,
  );
});

test("VV_RELAY_ENABLED=true accepts TELEGRAM_CHANNEL_ID with -100 prefix", () => {
  assert.doesNotThrow(() =>
    validateBootEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "12345:abcdef",
      TELEGRAM_ALLOWED_CHAT_IDS: "-100123",
      TELEGRAM_ADMIN_IDS: "1",
      NODE_ENV: "development",
      VV_RELAY_ENABLED: "true",
      TELEGRAM_CHANNEL_ID: "-1001234567890",
    }),
  );
});

test("describeOptInFeatures reports channel-relay disabled when env unset", () => {
  const lines = describeOptInFeatures({});
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /channel-relay: disabled/);
});

test("describeOptInFeatures reports channel-relay enabled when configured", () => {
  const lines = describeOptInFeatures({
    VV_RELAY_ENABLED: "true",
    TELEGRAM_CHANNEL_ID: "-1001234567890",
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /channel-relay: ENABLED/);
  assert.match(lines[0]!, /-1001234567890/);
});
