import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInlineCard, INLINE_CARD_BODY_CAP } from "./inlineCard.ts";
import { CARD_GLYPHS, looksLikeCard } from "./forgeryDetector.ts";

function row(opts: {
  reviewer: string;
  result: "POS" | "NEG" | "MIX";
  body?: string;
  date: string;
}) {
  return {
    reviewerUsername: opts.reviewer,
    result: opts.result,
    bodyText: opts.body ?? "",
    createdAt: new Date(opts.date),
  };
}

const NOW = new Date("2026-05-01T12:00:00Z");

test("returns null when archive is empty", () => {
  const r = renderInlineCard({
    targetUsername: "daveyboi",
    targetId: 42,
    archiveRows: [],
    now: NOW,
  });
  assert.equal(r, null);
});

test("renders header + bullets matching detector regex", () => {
  const r = renderInlineCard({
    targetUsername: "daveyboi",
    targetId: 42,
    archiveRows: [
      row({ reviewer: "sarah", result: "POS", body: "fast meet", date: "2026-04-15" }),
      row({ reviewer: "mike", result: "MIX", body: "shorted me", date: "2026-04-20" }),
    ],
    now: NOW,
  });
  assert.ok(r);
  // The output must satisfy the detector's regex — that's the unforgeability
  // contract. If renderer + detector drift, this test fails loudly.
  assert.equal(looksLikeCard(r.text), true);
});

test("contains all glyphs from CARD_GLYPHS", () => {
  const r = renderInlineCard({
    targetUsername: "daveyboi",
    targetId: 42,
    archiveRows: [row({ reviewer: "sarah", result: "POS", date: "2026-04-15" })],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, new RegExp(CARD_GLYPHS.board));
  assert.match(r.text, new RegExp(CARD_GLYPHS.emDash));
  assert.match(r.text, new RegExp(CARD_GLYPHS.middot));
});

test("counts POS and warn (NEG+MIX) buckets correctly", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [
      row({ reviewer: "a", result: "POS", date: "2026-04-01" }),
      row({ reviewer: "b", result: "POS", date: "2026-04-02" }),
      row({ reviewer: "c", result: "MIX", date: "2026-04-03" }),
      row({ reviewer: "d", result: "NEG", date: "2026-04-04" }),
    ],
    now: NOW,
  });
  assert.ok(r);
  // 2 POS, 2 warn (1 MIX + 1 NEG), 4 total
  assert.match(r.text, /@x — 2 ✅ · 2 ⚠️ \(4 over/);
});

test("truncates to 3 most-recent excerpts and shows the more line", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [
      row({ reviewer: "a", result: "POS", date: "2026-04-01" }),
      row({ reviewer: "b", result: "POS", date: "2026-04-02" }),
      row({ reviewer: "c", result: "POS", date: "2026-04-03" }),
      row({ reviewer: "d", result: "POS", date: "2026-04-04" }),
      row({ reviewer: "e", result: "POS", date: "2026-04-05" }),
    ],
    now: NOW,
  });
  assert.ok(r);
  // Most-recent first: e, d, c.
  assert.match(r.text, /@e/);
  assert.match(r.text, /@d/);
  assert.match(r.text, /@c/);
  assert.doesNotMatch(r.text, /@b/);
  assert.match(r.text, /…2 more — DM \/lookup @x/);
});

test("dd/mm/yyyy date format", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [
      row({ reviewer: "a", result: "POS", date: "2026-02-03T00:00:00Z" }),
    ],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, /03\/02\/2026/);
});

test("body cap respected when many short rows render", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    row({ reviewer: `r${i}`, result: "POS", body: "x".repeat(120), date: `2026-04-${String(i + 1).padStart(2, "0")}` }),
  );
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: rows,
    now: NOW,
  });
  assert.ok(r);
  assert.ok(r.text.length <= INLINE_CARD_BODY_CAP, `text len ${r.text.length}`);
});

test("contentHash stable for stable inputs", () => {
  const r1 = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [row({ reviewer: "a", result: "POS", date: "2026-04-01" })],
    now: NOW,
  });
  const r2 = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [row({ reviewer: "a", result: "POS", date: "2026-04-01" })],
    now: NOW,
  });
  assert.equal(r1?.contentHash, r2?.contentHash);
});

test("footer rotation deterministic per (targetId, day)", () => {
  const a = renderInlineCard({
    targetUsername: "x",
    targetId: 100,
    archiveRows: [row({ reviewer: "a", result: "POS", date: "2026-04-01" })],
    now: NOW,
  });
  const b = renderInlineCard({
    targetUsername: "x",
    targetId: 100,
    archiveRows: [row({ reviewer: "a", result: "POS", date: "2026-04-01" })],
    now: NOW,
  });
  assert.equal(a?.text, b?.text);
});

test("footer interpolates target username", () => {
  const r = renderInlineCard({
    targetUsername: "daveyboi",
    targetId: 42,
    archiveRows: [row({ reviewer: "sarah", result: "POS", date: "2026-04-15" })],
    now: NOW,
  });
  assert.ok(r);
  // Either footer mentions @VouchVaultBot or DM /lookup @daveyboi.
  assert.match(r.text, /@VouchVaultBot|@daveyboi/);
});

test("excerpt is truncated to 80 chars with ellipsis", () => {
  const long = "x".repeat(200);
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [row({ reviewer: "a", result: "POS", body: long, date: "2026-04-01" })],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, /…/);
});

test("empty body shows (no comment)", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [row({ reviewer: "a", result: "POS", body: "", date: "2026-04-01" })],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, /\(no comment\)/);
});

test("synthetic legacy reviewer username renders", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [
      row({ reviewer: "legacy_12345", result: "POS", body: "old", date: "2024-01-01" }),
    ],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, /@legacy_12345/);
});

test("span: same-day collapses to 1 day", () => {
  const r = renderInlineCard({
    targetUsername: "x",
    targetId: 1,
    archiveRows: [row({ reviewer: "a", result: "POS", date: "2026-04-01T12:00:00Z" })],
    now: NOW,
  });
  assert.ok(r);
  assert.match(r.text, /1 day\)/);
});
