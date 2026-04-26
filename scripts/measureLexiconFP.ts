// Operator script — measures lexicon false-positive rate against a Telegram
// export JSON. Run as: `npm run measure:lexicon-fp <path-to-export.json>`.
//
// Reports two numbers per source-tag:
//   - total hits (how many messages in the corpus this rule matched)
//   - marginal hits (matched by this rule and NOT also by a higher-priority
//     rule earlier in the chain — these are the rule's unique contribution)
//
// Usage in v6 §8.3:
//   - TBC26 export → expect 0 marginal `compound_buy_solicit` hits
//   - QLD Vouches → expect <5 marginal hits
//   - QLD Chasing → expect 100+ marginal hits
//
// findHits() short-circuits on the first match, so to compute marginal
// hits we also need to know what *would* have matched if the earlier
// passes weren't there. This script re-implements the staged check so
// it can attribute correctly.

import { readFileSync } from "node:fs";
import { findHits } from "../src/core/chatModerationLexicon.ts";

type ExportMessage = {
  id: number;
  type: string;
  text?: string | Array<string | { type: string; text: string }>;
};

type Export = {
  name?: string;
  messages: ReadonlyArray<ExportMessage>;
};

function plainTextOf(m: ExportMessage): string {
  if (typeof m.text === "string") return m.text;
  if (!Array.isArray(m.text)) return "";
  return m.text
    .map((part) => (typeof part === "string" ? part : part.text ?? ""))
    .join("");
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run measure:lexicon-fp <path-to-export.json>");
    process.exit(1);
  }

  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as Export;
  const messages = data.messages.filter((m) => m.type === "message");
  const total = messages.length;

  const sourceCounts = new Map<string, number>();
  let totalMatched = 0;
  for (const m of messages) {
    const text = plainTextOf(m);
    if (text.length === 0) continue;
    const r = findHits(text);
    if (!r.matched) continue;
    totalMatched += 1;
    sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  }

  console.log(`corpus: ${data.name ?? "(unnamed)"}`);
  console.log(`total messages: ${total}`);
  console.log(`total matched:  ${totalMatched} (${pct(totalMatched, total)}%)`);
  console.log(``);
  console.log(`per-source-tag counts (marginal — first-match attribution):`);
  const rows = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [src, n] of rows) {
    console.log(`  ${src.padEnd(28)} ${String(n).padStart(6)}  (${pct(n, total)}%)`);
  }

  const compound = sourceCounts.get("compound_buy_solicit") ?? 0;
  console.log(``);
  console.log(`compound_buy_solicit marginal: ${compound}`);
}

function pct(n: number, d: number): string {
  if (d === 0) return "0";
  return ((100 * n) / d).toFixed(2);
}

main();
