// Parser-only dry-run for a Telegram Desktop export. Reads the JSON, runs
// `parseLegacyExportMessage` over every record, and prints a summary plus a
// JSON review report. Does NOT touch the database or Telegram. Use this
// before `replayLegacyTelegramExport` to see what would actually import and
// why anything was skipped.
//
// Usage:
//   node --experimental-strip-types scripts/analyzeLegacyExport.ts <export.json> [--out review.json]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  getLegacyExportMessages,
  parseLegacyExportMessage,
  resolveLegacySourceChatId,
  sortLegacyMessages,
  type LegacyImportCandidate,
  type LegacyReviewItem,
  type LegacySkipReason,
} from "../src/mastra/legacyImportParser.ts";

type Options = {
  exportFilePath: string;
  outPath: string | null;
  sourceChatId: number | null;
};

function parseArgs(argv: string[]): Options {
  let exportFilePath: string | null = null;
  let outPath: string | null = null;
  let sourceChatId: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--source-chat-id") {
      const value = argv[i + 1];
      sourceChatId = value ? Number(value) : null;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (exportFilePath) {
      throw new Error(`Unexpected extra positional: ${arg}`);
    }
    exportFilePath = arg;
  }

  if (!exportFilePath) {
    throw new Error("Usage: analyzeLegacyExport <export.json> [--out review.json] [--source-chat-id <id>]");
  }

  return { exportFilePath, outPath, sourceChatId };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = await readFile(opts.exportFilePath, "utf8");
  const data = JSON.parse(raw);

  const messages = sortLegacyMessages(getLegacyExportMessages(data));
  const sourceChatId = resolveLegacySourceChatId(data, opts.sourceChatId);

  const imports: LegacyImportCandidate[] = [];
  const skips: Array<LegacyReviewItem & { sourceChatId: number }> = [];
  const skipsByReason = new Map<LegacySkipReason, number>();
  const importsByResult = { positive: 0, negative: 0, mixed: 0 } as Record<string, number>;
  const reviewerCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();

  for (const message of messages) {
    const decision = parseLegacyExportMessage({ message, sourceChatId });
    if (decision.kind === "import") {
      imports.push(decision.candidate);
      importsByResult[decision.candidate.result] = (importsByResult[decision.candidate.result] ?? 0) + 1;
      reviewerCounts.set(
        decision.candidate.reviewerUsername,
        (reviewerCounts.get(decision.candidate.reviewerUsername) ?? 0) + 1,
      );
      targetCounts.set(
        decision.candidate.targetUsername,
        (targetCounts.get(decision.candidate.targetUsername) ?? 0) + 1,
      );
    } else {
      skips.push({ ...decision.reviewItem, sourceChatId });
      skipsByReason.set(decision.reviewItem.reason, (skipsByReason.get(decision.reviewItem.reason) ?? 0) + 1);
    }
  }

  const skipBreakdown = Object.fromEntries([...skipsByReason.entries()].sort((a, b) => b[1] - a[1]));
  const topReviewers = [...reviewerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topTargets = [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const earliest = imports.reduce<Date | null>((acc, c) => (!acc || c.originalTimestamp < acc ? c.originalTimestamp : acc), null);
  const latest = imports.reduce<Date | null>((acc, c) => (!acc || c.originalTimestamp > acc ? c.originalTimestamp : acc), null);

  const summary = {
    exportFile: path.resolve(opts.exportFilePath),
    sourceChatId,
    totalScanned: messages.length,
    importable: imports.length,
    skipped: skips.length,
    importsByResult,
    skipBreakdown,
    earliestOriginal: earliest?.toISOString().slice(0, 10) ?? null,
    latestOriginal: latest?.toISOString().slice(0, 10) ?? null,
    topReviewers,
    topTargets,
  };

  console.info(JSON.stringify(summary, null, 2));

  if (opts.outPath) {
    const outAbs = path.resolve(opts.outPath);
    const reviewReport = {
      summary,
      imports: imports.map((c) => ({
        sourceMessageId: c.sourceMessageId,
        originalDate: c.originalTimestamp.toISOString().slice(0, 10),
        reviewer: c.reviewerUsername,
        target: c.targetUsername,
        result: c.result,
        text: c.text.slice(0, 240),
      })),
      skips,
    };
    await writeFile(outAbs, JSON.stringify(reviewReport, null, 2), "utf8");
    console.info(`\nFull report written to: ${outAbs}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
