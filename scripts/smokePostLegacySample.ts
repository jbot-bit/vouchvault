// Smoke test: parse the legacy export, pick a small representative sample,
// and post each candidate into a target Telegram chat using the same
// `buildArchiveEntryText` formatter the live bot would use. NO DATABASE —
// nothing is persisted or deduped. Use this to validate format only, then
// run the real `replayLegacyTelegramExport` once a Postgres is available.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/smokePostLegacySample.ts <export.json> --target-chat-id <id> [--count 25]

import { readFile } from "node:fs/promises";
import process from "node:process";

import { buildArchiveEntryText } from "../src/core/archive.ts";
import {
  getLegacyExportMessages,
  parseLegacyExportMessage,
  resolveLegacySourceChatId,
  sortLegacyMessages,
  type LegacyImportCandidate,
} from "../src/core/legacyImportParser.ts";

type Options = {
  exportFilePath: string;
  targetChatId: number;
  count: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Options {
  let exportFilePath: string | null = null;
  let targetChatId: number | null = null;
  let count = 25;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--target-chat-id") {
      targetChatId = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--count") {
      count = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
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

  if (!exportFilePath || targetChatId == null || !Number.isFinite(targetChatId)) {
    throw new Error(
      "Usage: smokePostLegacySample <export.json> --target-chat-id <id> [--count 25] [--dry-run]",
    );
  }

  return { exportFilePath, targetChatId, count, dryRun };
}

function pickRepresentativeSample(
  candidates: LegacyImportCandidate[],
  desired: number,
): LegacyImportCandidate[] {
  const fromVault = candidates.filter((c) => c.text.length > 0 && c.reviewerUsername.startsWith("legacy_"));
  const negatives = candidates.filter((c) => c.result === "negative" && !c.reviewerUsername.startsWith("legacy_"));
  const positives = candidates.filter((c) => c.result === "positive" && !c.reviewerUsername.startsWith("legacy_"));

  const slots = {
    deleted: Math.min(2, fromVault.length),
    negative: Math.min(5, negatives.length),
    positive: Math.max(0, desired - 2 - 5),
  };

  const seen = new Set<number>();
  const sample: LegacyImportCandidate[] = [];
  function take(list: LegacyImportCandidate[], n: number) {
    for (const c of list) {
      if (sample.length >= desired) return;
      if (seen.has(c.sourceMessageId)) continue;
      seen.add(c.sourceMessageId);
      sample.push(c);
      if (sample.filter((x) => list.includes(x)).length >= n) break;
    }
  }
  take(fromVault, slots.deleted);
  take(negatives, slots.negative);
  take(positives, slots.positive);

  // Fill any remaining slots from the full list if we under-shot a bucket.
  for (const c of candidates) {
    if (sample.length >= desired) break;
    if (seen.has(c.sourceMessageId)) continue;
    seen.add(c.sourceMessageId);
    sample.push(c);
  }

  return sample;
}

async function sendMessage(chatId: number, text: string, token: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: true,
    }),
  });
  const data = await response.json() as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description ?? response.statusText}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token && !opts.dryRun) {
    throw new Error("TELEGRAM_BOT_TOKEN is required (set in .env.local).");
  }

  const raw = await readFile(opts.exportFilePath, "utf8");
  const data = JSON.parse(raw);
  const messages = sortLegacyMessages(getLegacyExportMessages(data));
  const sourceChatId = resolveLegacySourceChatId(data, null);

  const candidates: LegacyImportCandidate[] = [];
  for (const m of messages) {
    const decision = parseLegacyExportMessage({ message: m, sourceChatId });
    if (decision.kind === "import") candidates.push(decision.candidate);
  }

  const sample = pickRepresentativeSample(candidates, opts.count);
  console.info(`Picked ${sample.length} of ${candidates.length} candidates for the smoke run.`);

  for (let i = 0; i < sample.length; i += 1) {
    const candidate = sample[i]!;
    const text = buildArchiveEntryText({
      entryId: i + 1,
      reviewerUsername: candidate.reviewerUsername,
      targetUsername: candidate.targetUsername,
      entryType: candidate.entryType,
      result: candidate.result,
      tags: candidate.selectedTags,
      createdAt: new Date(),
      source: "legacy_import",
      legacySourceTimestamp: candidate.originalTimestamp,
    });

    if (opts.dryRun) {
      console.info(`\n--- ${i + 1}/${sample.length} (would send) ---\n${text}`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${sample.length}] ${candidate.reviewerUsername} -> ${candidate.targetUsername} (${candidate.result}) ... `);
    try {
      await sendMessage(opts.targetChatId, text, token!);
      process.stdout.write("OK\n");
    } catch (error) {
      process.stdout.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    // Stay well under Telegram's 30-msg/sec per-chat limit.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  console.info("\nSmoke run complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
