// Operator CLI for v6 §4.5 mass-forward replay.
//
// Reads vouch_entries with channel_message_id IS NOT NULL and forwards
// each from the source channel into the destination chat via Bot API
// `forwardMessages`. Idempotent via the replay_log table — reruns skip
// already-forwarded source messages.
//
// Usage:
//   npm run replay:to-telegram -- \
//     --destination-chat-id <id> \
//     [--run-id <uuid>]              \  # default: random uuid
//     [--source-chat-id <id>]         \  # default: TELEGRAM_CHANNEL_ID
//     [--limit <N>]                    \ # forward at most N
//     [--dry-run]
//
// Per opsec.md §11.3, this is the canonical recovery procedure when
// the supergroup is gone but the channel survives.

import process from "node:process";
import { randomUUID } from "node:crypto";

import { db, pool } from "../src/core/storage/db.ts";
import { replayLog, vouchEntries } from "../src/core/storage/schema.ts";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { callTelegramAPI } from "../src/core/tools/telegramTools.ts";
import {
  replayChannelArchive,
  type ReplayDeps,
} from "../src/core/replayToTelegram.ts";

type CliOptions = {
  destinationChatId: number;
  runId: string;
  sourceChatId: number;
  limit: number | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let destinationChatId: number | null = null;
  let runId: string | null = null;
  let sourceChatId: number | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--destination-chat-id") {
      if (!next) throw new Error("--destination-chat-id requires a value");
      destinationChatId = Number(next);
      i += 1;
    } else if (flag === "--run-id") {
      if (!next) throw new Error("--run-id requires a value");
      runId = next;
      i += 1;
    } else if (flag === "--source-chat-id") {
      if (!next) throw new Error("--source-chat-id requires a value");
      sourceChatId = Number(next);
      i += 1;
    } else if (flag === "--limit") {
      if (!next) throw new Error("--limit requires a value");
      limit = Number(next);
      i += 1;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (destinationChatId == null || !Number.isSafeInteger(destinationChatId)) {
    throw new Error("--destination-chat-id is required");
  }

  if (sourceChatId == null) {
    const env = process.env.TELEGRAM_CHANNEL_ID?.trim();
    if (!env) {
      throw new Error(
        "--source-chat-id not provided and TELEGRAM_CHANNEL_ID env var unset",
      );
    }
    sourceChatId = Number(env);
    if (!Number.isSafeInteger(sourceChatId)) {
      throw new Error("TELEGRAM_CHANNEL_ID is not a safe integer");
    }
  }

  return {
    destinationChatId,
    runId: runId ?? randomUUID(),
    sourceChatId,
    limit,
    dryRun,
  };
}

function printUsage(): void {
  console.info(
    [
      "Usage:",
      "  replay:to-telegram --destination-chat-id <id> [options]",
      "",
      "Options:",
      "  --destination-chat-id <id>   Required. Target chat for the forwards.",
      "  --run-id <uuid>              Optional. Defaults to a fresh UUID.",
      "  --source-chat-id <id>        Optional. Defaults to TELEGRAM_CHANNEL_ID env.",
      "  --limit <N>                  Optional. Forward at most N messages.",
      "  --dry-run                    Print what would happen, don't call Bot API.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Source message ids in publish order. Filter to entries that have
  // a channel-side message id (i.e. were published via the channel
  // relay path) so we can actually forward them. Include both
  // 'published' (auto-forward observed) AND 'channel_published' rows
  // (channel post landed but auto-forward was lost) — for recovery,
  // the channel post is the recovery asset, so any row with a
  // channel_message_id is forwardable.
  const rows = await db
    .select({ channelMessageId: vouchEntries.channelMessageId })
    .from(vouchEntries)
    .where(
      and(
        isNotNull(vouchEntries.channelMessageId),
        inArray(vouchEntries.status, ["published", "channel_published"]),
      ),
    )
    .orderBy(vouchEntries.createdAt, vouchEntries.id);

  let sourceMessageIds = rows
    .map((r) => r.channelMessageId)
    .filter((id): id is number => typeof id === "number");

  if (opts.limit != null && opts.limit > 0) {
    sourceMessageIds = sourceMessageIds.slice(0, opts.limit);
  }

  console.info(
    `[replay:to-telegram] run_id=${opts.runId} source=${opts.sourceChatId} ` +
      `destination=${opts.destinationChatId} candidates=${sourceMessageIds.length}` +
      (opts.dryRun ? " (DRY RUN)" : ""),
  );

  if (opts.dryRun) {
    console.info(
      `[replay:to-telegram] would forward ids: ${sourceMessageIds.slice(0, 10).join(", ")}` +
        (sourceMessageIds.length > 10 ? ` ... (${sourceMessageIds.length - 10} more)` : ""),
    );
    await pool.end();
    return;
  }

  const deps: ReplayDeps = {
    loadAlreadyForwarded: async (runId, sourceChatId, destinationChatId) => {
      const existing = await db
        .select({ sourceMessageId: replayLog.sourceMessageId })
        .from(replayLog)
        .where(
          and(
            eq(replayLog.replayRunId, runId),
            eq(replayLog.sourceChatId, sourceChatId),
            eq(replayLog.destinationChatId, destinationChatId),
          ),
        );
      return new Set(existing.map((row) => row.sourceMessageId));
    },
    forwarder: async (sourceChatId, destinationChatId, sourceIds) => {
      const result = await callTelegramAPI("forwardMessages", {
        chat_id: destinationChatId,
        from_chat_id: sourceChatId,
        message_ids: sourceIds,
      });
      // Bot API forwardMessages returns an array of MessageId objects.
      const out = (result as Array<{ message_id: number }> | null) ?? [];
      return out.map((m) => m.message_id);
    },
    recordForwarded: async (runId, sourceChatId, destinationChatId, pairs) => {
      if (pairs.length === 0) return;
      await db.insert(replayLog).values(
        pairs.map((p) => ({
          replayRunId: runId,
          sourceChatId,
          sourceMessageId: p.sourceMessageId,
          destinationChatId,
          destinationMessageId: p.destinationMessageId,
        })),
      );
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };

  const summary = await replayChannelArchive(
    {
      runId: opts.runId,
      sourceChatId: opts.sourceChatId,
      destinationChatId: opts.destinationChatId,
      sourceMessageIds,
      onBatch: (batch) => {
        console.info(
          `[replay:to-telegram] batch ${batch.batchIndex + 1}: ` +
            `${batch.sourceMessageIds.length} forwarded`,
        );
      },
    },
    deps,
  );

  console.info(
    `[replay:to-telegram] done — forwarded ${summary.totalForwarded} ` +
      `in ${summary.batches} batches; skipped ${summary.skippedAlreadyForwarded} already-forwarded`,
  );

  await pool.end();
}

main().catch((error) => {
  console.error("[replay:to-telegram] failed:", error);
  process.exit(1);
});
