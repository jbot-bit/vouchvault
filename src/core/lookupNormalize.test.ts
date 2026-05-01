import test from "node:test";
import assert from "node:assert/strict";

import { normalizeUsername } from "./archive.ts";

// /lookup edge-case coverage. The DB queries use LOWER() on the column
// (see archiveStore.ts), so as long as normalizeUsername returns a stable
// lowercase token, lookup resolves regardless of stored case. These tests
// formalise the input-side guarantees.

test("strips a single leading @", () => {
  assert.equal(normalizeUsername("@bobbiz"), "bobbiz");
});

test("strips multiple leading @ (paste smudges)", () => {
  assert.equal(normalizeUsername("@@bobbiz"), "bobbiz");
  assert.equal(normalizeUsername("@@@bobbiz"), "bobbiz");
});

test("accepts no @ prefix", () => {
  assert.equal(normalizeUsername("bobbiz"), "bobbiz");
});

test("trims surrounding whitespace", () => {
  assert.equal(normalizeUsername("  @bobbiz  "), "bobbiz");
  assert.equal(normalizeUsername("\t@bobbiz\n"), "bobbiz");
});

test("lowercases mixed-case input (matches LOWER() in DB queries)", () => {
  assert.equal(normalizeUsername("@BOBBIZ"), "bobbiz");
  assert.equal(normalizeUsername("@BobBiz"), "bobbiz");
  assert.equal(normalizeUsername("BOBBIZ"), "bobbiz");
});

test("accepts underscore + digits in non-leading positions", () => {
  assert.equal(normalizeUsername("@bob_biz_2"), "bob_biz_2");
  assert.equal(normalizeUsername("@user123"), "user123");
});

test("rejects empty / whitespace / @-only", () => {
  assert.equal(normalizeUsername(""), null);
  assert.equal(normalizeUsername("   "), null);
  assert.equal(normalizeUsername("@"), null);
  assert.equal(normalizeUsername("@@"), null);
  assert.equal(normalizeUsername(null), null);
  assert.equal(normalizeUsername(undefined), null);
});

test("rejects too-short usernames (Telegram min is 5 chars)", () => {
  // regex requires {4,31} after the leading letter → 5 to 32 chars total.
  assert.equal(normalizeUsername("@a"), null);
  assert.equal(normalizeUsername("@abcd"), null); // 4 chars
  assert.equal(normalizeUsername("@abcde"), "abcde"); // 5 — boundary
});

test("rejects too-long usernames (Telegram max is 32 chars)", () => {
  assert.equal(normalizeUsername("@" + "a".repeat(32)), "a".repeat(32));
  assert.equal(normalizeUsername("@" + "a".repeat(33)), null);
});

test("rejects digit-leading (Telegram disallows)", () => {
  assert.equal(normalizeUsername("@1bobbiz"), null);
  assert.equal(normalizeUsername("1bobbiz"), null);
});

test("rejects underscore-leading (Telegram disallows)", () => {
  assert.equal(normalizeUsername("@_bobbiz"), null);
});

test("rejects punctuation / dots / hyphens", () => {
  assert.equal(normalizeUsername("@bob.biz"), null);
  assert.equal(normalizeUsername("@bob-biz"), null);
  assert.equal(normalizeUsername("@bob biz"), null);
  assert.equal(normalizeUsername("user@example.com"), null);
});

test("rejects t.me/ links pasted as-is (caller should strip the URL first)", () => {
  // Defensive: a member pasting "/lookup t.me/bobbiz" trips the reject
  // path and gets "Lookup requires /lookup @username." rather than
  // silently looking up nothing useful.
  assert.equal(normalizeUsername("t.me/bobbiz"), null);
  assert.equal(normalizeUsername("https://t.me/bobbiz"), null);
});

test("rejects Cyrillic / emoji / other non-ASCII (Telegram disallows)", () => {
  assert.equal(normalizeUsername("@боббиз"), null);
  assert.equal(normalizeUsername("@bob🔥biz"), null);
});

test("idempotent — normalising twice gives the same result", () => {
  const inputs = ["@BOBBIZ", "  @bobbiz  ", "@@bobbiz", "Bobbiz"];
  for (const input of inputs) {
    const once = normalizeUsername(input);
    const twice = once == null ? null : normalizeUsername(once);
    assert.equal(twice, once, input);
  }
});
