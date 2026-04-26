import test from "node:test";
import assert from "node:assert/strict";

import { isReservedTarget } from "./archive.ts";

test("reserved exact-match handles are rejected", () => {
  for (const handle of ["telegram", "spambot", "botfather", "notoscam", "replies", "gif"]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("reserved match is case-insensitive (caller normalises but defence-in-depth)", () => {
  // normalizeUsername already lowercases, but isReservedTarget is robust to
  // any caller that forgets to.
  for (const handle of ["TELEGRAM", "Telegram", "BotFather"]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("bot's own username is rejected when env is set", () => {
  process.env.TELEGRAM_BOT_USERNAME = "vouchvault_bot";
  try {
    assert.equal(isReservedTarget("vouchvault_bot"), true);
    assert.equal(isReservedTarget("VouchVault_Bot"), true);
    assert.equal(isReservedTarget("@vouchvault_bot"), true);
  } finally {
    delete process.env.TELEGRAM_BOT_USERNAME;
  }
});

test("marketplace substrings are rejected case-insensitively", () => {
  for (const handle of [
    "scammer42",
    "best_vendor",
    "the_plug",
    "gear_supplier",
    "coke_au",
    "_4sale_now",
    "MDMA_supply",
    "tabs_fest",
    "myplug_2025",
    "weed_man",
    "fent_ttown",
    "OXY_dealer",
  ]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("substrings with required punctuation don't false-positive on benign words", () => {
  // tabs_/_tabs requires the underscore so handles like "tablefriend" pass.
  // Drug substrings are scoped with _ separators to avoid catching common
  // English: oxygen, fenton (surname), methodist, etc.
  for (const handle of [
    "tablefriend",
    "fenton",
    "oxley",
    "kettle",
    "ketchup_lover",
    "methodist_camp",
    "oxygen_user",
  ]) {
    assert.equal(isReservedTarget(handle), false, handle);
  }
});

test("benign usernames pass", () => {
  for (const handle of [
    "alice",
    "bob_smith",
    "real_person99",
    "long_username_okay",
    "joshd",
    "vouchvault_user",
  ]) {
    assert.equal(isReservedTarget(handle), false, handle);
  }
});
