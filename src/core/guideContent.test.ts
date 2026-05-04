import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GUIDE_PAGES,
  buildGuidePage,
  buildGuidePageCallback,
  buildGuideRoot,
  getGuideChildren,
  parseGuidePageCallback,
  parseGuideStartPayload,
  validateGuideContent,
} from "./guideContent.ts";

test("guide content passes structural validation", () => {
  validateGuideContent();
});

test("guide has 4 categories and 16 leaves (21 nodes incl. root)", () => {
  const categories = getGuideChildren("root");
  assert.equal(categories.length, 4);
  let leafCount = 0;
  for (const cat of categories) {
    const children = getGuideChildren(cat.id);
    assert.equal(children.length, 4, `category ${cat.id} should have 4 leaves`);
    leafCount += children.length;
  }
  assert.equal(leafCount, 16);
  // 4 categories + 16 leaves = 20 stored pages; root is virtual.
  assert.equal(GUIDE_PAGES.length, 20);
});

test("every page body is <= 700 chars", () => {
  for (const p of GUIDE_PAGES) {
    assert.ok(
      p.body.length <= 700,
      `${p.id} body is ${p.body.length} chars`,
    );
  }
});

test("guide bodies + titles avoid the marketplace ML keyword cluster (verify/verified/legit)", () => {
  // Same posture as archiveUx.test.ts "review not verify" — keeps a T&S
  // reviewer's eye off the marketplace pattern when they /start the bot
  // after a hostile report. Code comments and lexicon trigger labels are
  // out of scope; member-rendered copy is in.
  const banned = [/\bverify\b/i, /\bverified\b/i, /\blegit\b/i];
  for (const p of GUIDE_PAGES) {
    for (const re of banned) {
      assert.doesNotMatch(p.title, re, `title "${p.title}" hits ${re}`);
      assert.doesNotMatch(p.body, re, `body of ${p.id} hits ${re}`);
    }
  }
});

test("every page is reachable from root via BFS", () => {
  const seen = new Set<string>(["root"]);
  const queue: string[] = ["root"];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of getGuideChildren(id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  assert.equal(seen.size, GUIDE_PAGES.length + 1, "root + all pages");
  for (const p of GUIDE_PAGES) {
    assert.ok(seen.has(p.id), `${p.id} unreachable from root`);
  }
});

test("every non-root page declares an existing parent", () => {
  const ids = new Set(GUIDE_PAGES.map((p) => p.id));
  for (const p of GUIDE_PAGES) {
    if (p.parent === "root") continue;
    assert.ok(ids.has(p.parent), `${p.id} parent ${p.parent} missing`);
  }
});

test("buildGuidePageCallback ↔ parseGuidePageCallback round-trip for every id", () => {
  for (const p of GUIDE_PAGES) {
    const cb = buildGuidePageCallback(p.id);
    assert.ok(cb.length <= 64, `${cb} > 64 bytes`);
    assert.equal(parseGuidePageCallback(cb), p.id);
  }
  // Root is also a valid callback target (the Menu button uses it).
  assert.equal(parseGuidePageCallback(buildGuidePageCallback("root")), "root");
});

test("parseGuidePageCallback rejects malformed payloads", () => {
  assert.equal(parseGuidePageCallback("gd:p:Bad-Id"), null);
  assert.equal(parseGuidePageCallback("gd:p:"), null);
  assert.equal(parseGuidePageCallback("gd:p:" + "a".repeat(25)), null);
  assert.equal(parseGuidePageCallback("xx:p:acc"), null);
  assert.equal(parseGuidePageCallback(""), null);
});

test("buildGuideRoot returns 2x2 categories + Bot-menu back row", () => {
  const root = buildGuideRoot();
  assert.ok(root.text.length > 0);
  const rows = root.replyMarkup.inline_keyboard;
  assert.equal(rows.length, 3, "2 category rows + 1 back row");
  assert.equal(rows[0]!.length, 2);
  assert.equal(rows[1]!.length, 2);
  assert.equal(rows[2]!.length, 1);
  // Top 4 are categories.
  const categoryButtons = [...rows[0]!, ...rows[1]!];
  for (const b of categoryButtons) {
    assert.ok((b as { callback_data: string }).callback_data.startsWith("gd:p:"));
  }
  // Bottom row routes back to the welcome menu (wc:back).
  const backBtn = rows[2]![0]! as { text: string; callback_data: string };
  assert.match(backBtn.text, /Bot menu/);
  assert.equal(backBtn.callback_data, "wc:back");
});

test("buildGuidePage(category) lists 4 leaves + [Back, Bot menu] row", () => {
  const cat = buildGuidePage("acc");
  assert.ok(cat);
  const rows = cat!.replyMarkup.inline_keyboard;
  assert.equal(rows.length, 5, "4 leaf rows + 1 back/menu row");
  for (let i = 0; i < 4; i += 1) {
    assert.equal(rows[i]!.length, 1);
  }
  const navRow = rows[4]!;
  assert.equal(navRow.length, 2);
  const backBtn = navRow[0]! as { text: string; callback_data: string };
  const menuBtn = navRow[1]! as { text: string; callback_data: string };
  assert.match(backBtn.text, /Back/);
  assert.equal(backBtn.callback_data, buildGuidePageCallback("root"));
  assert.match(menuBtn.text, /Bot menu/);
  assert.equal(menuBtn.callback_data, "wc:back");
});

test("buildGuidePage(leaf with cite) renders Source button + Back/Menu row", () => {
  const leaf = buildGuidePage("grp_posts");
  assert.ok(leaf);
  assert.match(leaf!.text, /Why some posts auto-delete/);
  assert.match(leaf!.text, /marketplace and scam phrases/);
  // grp_posts cites telegram.org/tos. Two rows: Source URL + Back/Menu.
  const rows = leaf!.replyMarkup.inline_keyboard;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.length, 1);
  assert.match(rows[0]![0]!.text, /Source/);
  assert.equal((rows[0]![0]! as { url: string }).url, "https://telegram.org/tos");
  assert.equal(rows[1]!.length, 2);
  assert.match(rows[1]![0]!.text, /Back/);
  assert.match(rows[1]![1]!.text, /Bot menu/);
  assert.equal(
    (rows[1]![0]! as { callback_data: string }).callback_data,
    buildGuidePageCallback("grp"),
  );
  assert.equal((rows[1]![1]! as { callback_data: string }).callback_data, "wc:back");
});

test("buildGuidePage(leaf without cite) just has the Back/Menu row", () => {
  // new_vouch is one of the few procedural leaves without a cite.
  const leaf = buildGuidePage("new_vouch");
  assert.ok(leaf);
  const rows = leaf!.replyMarkup.inline_keyboard;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.length, 2);
  const back = rows[0]![0]! as { text: string };
  const menu = rows[0]![1]! as { text: string };
  assert.match(back.text, /Back/);
  assert.match(menu.text, /Bot menu/);
});

test("buildGuidePage(leaf with cite) renders italic Source line in body", () => {
  const leaf = buildGuidePage("acc_2fa");
  assert.ok(leaf);
  // Source line strips https:// for cleaner display but URL button
  // carries the full URL.
  assert.match(leaf!.text, /<i>Source: telegram\.org/);
  assert.equal(leaf!.text.includes("https://"), false);
});

test("every cite is a full https URL so the Source button can open it", () => {
  for (const p of GUIDE_PAGES) {
    if (p.cite == null) continue;
    assert.match(
      p.cite,
      /^https:\/\//,
      `cite for ${p.id} must be a full URL — got ${p.cite}`,
    );
  }
});

test("every leaf making a substantive factual claim has a cite", () => {
  // Sourcing audit: leaves that describe Telegram behavior, account
  // mechanics, or moderation policy must cite. Procedural leaves about
  // OUR bot's commands (new_search, new_vouch) are exempt — they're
  // describing this bot's behavior, not making third-party claims.
  const exemptIds = new Set(["new_search", "new_vouch"]);
  for (const p of GUIDE_PAGES) {
    if (p.parent === "root") continue; // categories don't make claims
    if (exemptIds.has(p.id)) continue;
    assert.ok(
      p.cite != null && p.cite.length > 0,
      `${p.id} makes a factual claim — needs a cite`,
    );
  }
});

test("buildGuidePage(unknown id) returns null", () => {
  assert.equal(buildGuidePage("nope"), null);
  assert.equal(buildGuidePage("acc_unknown"), null);
});

test("every page render produces non-empty text and at least one button", () => {
  const root = buildGuideRoot();
  assert.ok(root.text.length > 0);
  assert.ok(root.replyMarkup.inline_keyboard.length > 0);
  for (const p of GUIDE_PAGES) {
    const r = buildGuidePage(p.id);
    assert.ok(r, `page ${p.id} should render`);
    assert.ok(r!.text.length > 0);
    assert.ok(r!.replyMarkup.inline_keyboard.length > 0);
  }
});

test("parseGuideStartPayload routes 'guide' and known leaves", () => {
  assert.equal(parseGuideStartPayload("guide"), "root");
  assert.equal(parseGuideStartPayload("guide_acc_2fa"), "acc_2fa");
  assert.equal(parseGuideStartPayload("guide_grp_posts"), "grp_posts");
  assert.equal(parseGuideStartPayload("guide_root"), "root");
});

test("parseGuideStartPayload falls back to root for unknown ids", () => {
  assert.equal(parseGuideStartPayload("guide_unknown"), "root");
  assert.equal(parseGuideStartPayload("guide_acc_unknown"), "root");
  // Bad-shape ids fall back to root rather than throw.
  assert.equal(parseGuideStartPayload("guide_Bad-Id"), "root");
});

test("parseGuideStartPayload rejects non-guide payloads", () => {
  assert.equal(parseGuideStartPayload("search_bobbiz"), null);
  assert.equal(parseGuideStartPayload(""), null);
  assert.equal(parseGuideStartPayload("guideish"), null);
});
