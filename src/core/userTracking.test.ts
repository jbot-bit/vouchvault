import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_AGE_FLOOR_HOURS,
  checkAccountAge,
} from "./accountAge.ts";

test("checkAccountAge: null first_seen → allowed, null marker (caller records + treats as new)", () => {
  const r = checkAccountAge(null);
  assert.equal(r.allowed, true);
  if (r.allowed) assert.equal(r.firstSeen, null);
});

test("checkAccountAge: account ≥24h old → allowed", () => {
  const now = new Date("2026-04-27T12:00:00Z");
  const firstSeen = new Date("2026-04-26T11:59:59Z"); // ~24h + 1s ago
  const r = checkAccountAge(firstSeen, now);
  assert.equal(r.allowed, true);
});

test("checkAccountAge: account exactly 24h old → allowed (boundary)", () => {
  const now = new Date("2026-04-27T12:00:00Z");
  const firstSeen = new Date("2026-04-26T12:00:00Z");
  const r = checkAccountAge(firstSeen, now);
  assert.equal(r.allowed, true);
});

test("checkAccountAge: account 23h old → blocked, 1h remaining", () => {
  const now = new Date("2026-04-27T12:00:00Z");
  const firstSeen = new Date("2026-04-26T13:00:00Z"); // 23h ago
  const r = checkAccountAge(firstSeen, now);
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.hoursRemaining, 1);
});

test("checkAccountAge: account 1h old → blocked, 23h remaining", () => {
  const now = new Date("2026-04-27T12:00:00Z");
  const firstSeen = new Date("2026-04-27T11:00:00Z"); // 1h ago
  const r = checkAccountAge(firstSeen, now);
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.hoursRemaining, 23);
});

test("checkAccountAge: account 1 minute old → blocked, 24h remaining (ceiling)", () => {
  const now = new Date("2026-04-27T12:00:00Z");
  const firstSeen = new Date("2026-04-27T11:59:00Z"); // 60s ago
  const r = checkAccountAge(firstSeen, now);
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.hoursRemaining, 24);
});

test("ACCOUNT_AGE_FLOOR_HOURS is 24", () => {
  assert.equal(ACCOUNT_AGE_FLOOR_HOURS, 24);
});
