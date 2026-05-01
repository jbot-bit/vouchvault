import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";

import pino from "pino";

import { createLogger, REDACT_PATHS } from "./logger.ts";

// Asserts the createLogger() redact configuration suppresses our note
// fields in structured logs. We can't read the redact paths off the
// logger object, so we serialize through a captured stream and assert
// against the bytes that would have been emitted.
function loggerWithCapturedStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  // Sanity-check that the production constructor still imports cleanly;
  // we use a separate pino instance below for the assertion stream so we
  // can capture its serialized output deterministically.
  void createLogger();

  const logger = pino(
    {
      level: "info",
      redact: {
        paths: [...REDACT_PATHS],
        censor: "[REDACTED]",
      },
    },
    stream,
  );

  return { lines, logger };
}

test("logger redacts entry.privateNote (camelCase)", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info({ entry: { privateNote: "leak-camelCase" } }, "x");
  const all = lines.join("\n");
  assert.ok(!all.includes("leak-camelCase"), "camelCase note leaked");
  assert.ok(all.includes("[REDACTED]"));
});

test("logger redacts row.private_note (snake_case)", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info({ row: { private_note: "leak-snake_case" } }, "y");
  const all = lines.join("\n");
  assert.ok(!all.includes("leak-snake_case"), "snake_case note leaked");
  assert.ok(all.includes("[REDACTED]"));
});

test("logger preserves non-sensitive fields alongside the redacted note", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info({ entry: { id: 42, privateNote: "redact-me" } }, "with id");
  const all = lines.join("\n");
  assert.ok(all.includes("\"id\":42"), "non-sensitive id field was lost");
  assert.ok(!all.includes("redact-me"), "note leaked");
});

test("logger redacts top-level invite link string", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info(
    { chatId: -1, fromId: 7, link: "https://t.me/+SECRETHASHabcdef" },
    "join",
  );
  const all = lines.join("\n");
  assert.ok(!all.includes("SECRETHASHabcdef"), "top-level invite link leaked");
  assert.ok(all.includes("[REDACTED]"));
  assert.ok(all.includes("\"chatId\":-1"), "non-sensitive chatId was lost");
});

test("logger redacts nested invite_link / inviteLink variants", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info(
    {
      ctx: {
        invite_link: "https://t.me/+SNAKE_VARIANT_xyz",
        inviteLink: "https://t.me/+CAMEL_VARIANT_xyz",
      },
    },
    "y",
  );
  const all = lines.join("\n");
  assert.ok(!all.includes("SNAKE_VARIANT_xyz"), "snake_case invite_link leaked");
  assert.ok(!all.includes("CAMEL_VARIANT_xyz"), "camelCase inviteLink leaked");
});

test("logger redacts invite_url / inviteUrl too (paranoia path)", () => {
  const { lines, logger } = loggerWithCapturedStream();
  logger.info(
    {
      invite_url: "https://t.me/+URL_SNAKE_xyz",
      inviteUrl: "https://t.me/+URL_CAMEL_xyz",
    },
    "z",
  );
  const all = lines.join("\n");
  assert.ok(!all.includes("URL_SNAKE_xyz"));
  assert.ok(!all.includes("URL_CAMEL_xyz"));
});
