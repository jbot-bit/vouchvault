import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_MEMBER_STATUSES,
  INACTIVE_MEMBER_STATUSES,
  createSeenCache,
  statusIsActive,
} from "./sc45Members.ts";

test("statusIsActive returns true for member/administrator/creator/restricted", () => {
  for (const status of ["member", "administrator", "creator", "restricted"]) {
    assert.equal(statusIsActive(status), true, `expected active for ${status}`);
  }
});

test("statusIsActive returns false for left/kicked", () => {
  for (const status of ["left", "kicked"]) {
    assert.equal(statusIsActive(status), false, `expected inactive for ${status}`);
  }
});

test("statusIsActive returns false for unknown status", () => {
  assert.equal(statusIsActive("ghost"), false);
  assert.equal(statusIsActive(""), false);
});

test("ACTIVE_MEMBER_STATUSES + INACTIVE_MEMBER_STATUSES are disjoint", () => {
  for (const s of ACTIVE_MEMBER_STATUSES) {
    assert.equal(INACTIVE_MEMBER_STATUSES.has(s), false);
  }
});

test("createSeenCache: recentlySeen returns false before markSeen", () => {
  const cache = createSeenCache(10);
  assert.equal(cache.recentlySeen(1), false);
});

test("createSeenCache: recentlySeen returns true after markSeen", () => {
  const cache = createSeenCache(10);
  cache.markSeen(1);
  assert.equal(cache.recentlySeen(1), true);
});

test("createSeenCache: markSeen is idempotent (no growth on repeat)", () => {
  const cache = createSeenCache(10);
  cache.markSeen(1);
  cache.markSeen(1);
  cache.markSeen(1);
  assert.equal(cache.size(), 1);
});

test("createSeenCache: FIFO evicts oldest at cap", () => {
  const cache = createSeenCache(3);
  cache.markSeen(1);
  cache.markSeen(2);
  cache.markSeen(3);
  cache.markSeen(4); // evicts 1
  assert.equal(cache.recentlySeen(1), false);
  assert.equal(cache.recentlySeen(2), true);
  assert.equal(cache.recentlySeen(3), true);
  assert.equal(cache.recentlySeen(4), true);
});

test("createSeenCache: recentlySeen refreshes recency", () => {
  const cache = createSeenCache(3);
  cache.markSeen(1);
  cache.markSeen(2);
  cache.markSeen(3);
  // Touch 1 — should move it to most-recent.
  assert.equal(cache.recentlySeen(1), true);
  cache.markSeen(4); // evicts 2 (oldest after touch), not 1
  assert.equal(cache.recentlySeen(1), true);
  assert.equal(cache.recentlySeen(2), false);
});

test("createSeenCache: clear empties the cache", () => {
  const cache = createSeenCache(10);
  cache.markSeen(1);
  cache.markSeen(2);
  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.recentlySeen(1), false);
});

test("createSeenCache: cap of 1 evicts on every new id", () => {
  const cache = createSeenCache(1);
  cache.markSeen(1);
  cache.markSeen(2);
  assert.equal(cache.recentlySeen(1), false);
  assert.equal(cache.recentlySeen(2), true);
  assert.equal(cache.size(), 1);
});
