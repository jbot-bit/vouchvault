// Compile-time + smoke tests for the bot_kind multi-bot idempotency
// extension to processed_telegram_updates. Full DB-roundtrip
// integration coverage requires a live DATABASE_URL and lives outside
// the unit test surface — this file just asserts the shape that the
// rest of the multi-bot work relies on.

import test from "node:test";
import assert from "node:assert/strict";

import type { BotKind } from "../archiveStore.ts";
import { processedTelegramUpdates } from "./schema.ts";

test("BotKind type accepts ingest/lookup/admin", () => {
  // Compile-time check via const-assertion; runtime sanity by referencing
  // each value. If any of these stop being valid BotKind values, this
  // file will fail to type-check.
  const ingest: BotKind = "ingest";
  const lookup: BotKind = "lookup";
  const admin: BotKind = "admin";
  assert.equal(ingest, "ingest");
  assert.equal(lookup, "lookup");
  assert.equal(admin, "admin");
});

test("processed_telegram_updates schema has bot_kind column", () => {
  // Drizzle Table proxy exposes column names as keys on the table object.
  // We don't rely on the runtime SQL shape here; we just confirm the
  // schema-level binding exists so a future rename surfaces as a test
  // failure rather than a silent regression.
  const cols = Object.keys(processedTelegramUpdates);
  assert.ok(cols.includes("botKind"), `expected 'botKind' in ${cols.join(",")}`);
  assert.ok(cols.includes("updateId"), `expected 'updateId' in ${cols.join(",")}`);
});
