// v6 §4.5 / commit 7: mass-forward replay capability.
//
// Replays archived channel posts into a destination chat via Bot API
// `forwardMessages` (plural, batches up to 100 ids per call). Used for
// recovery-from-takedown and channel-migration events. Idempotent via
// the `replay_log` table (migration 0010): rerunning the same
// replay_run_id skips already-forwarded source messages.
//
// This module owns the pure batching + throttling logic and exposes a
// caller-supplied `forwarder` so tests can drive the orchestration
// without touching the real Bot API.

export const FORWARD_BATCH_SIZE = 100;
// Bot API broadcast cap is ~30 msgs/sec. We throttle below that with a
// safety margin: 25 msgs/sec → batches of 100 forwards every 4 seconds.
export const TARGET_MSGS_PER_SEC = 25;
export const BATCH_DELAY_MS = Math.ceil(
  (1000 * FORWARD_BATCH_SIZE) / TARGET_MSGS_PER_SEC,
);

export type ReplayBatchResult = {
  batchIndex: number;
  sourceMessageIds: ReadonlyArray<number>;
  destinationMessageIds: ReadonlyArray<number>;
};

export type ReplaySummary = {
  totalForwarded: number;
  batches: number;
  skippedAlreadyForwarded: number;
};

// Pure helper: chunk an ordered list of source message ids into batches
// of up to FORWARD_BATCH_SIZE.
export function batchMessageIds(
  ids: ReadonlyArray<number>,
  batchSize: number = FORWARD_BATCH_SIZE,
): ReadonlyArray<ReadonlyArray<number>> {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    out.push(ids.slice(i, i + batchSize));
  }
  return out;
}

// Pure helper: filter out source ids that are already in the
// `alreadyForwarded` set (e.g. loaded from replay_log for the same run
// + destination). Preserves input order.
export function filterAlreadyForwarded(
  sourceIds: ReadonlyArray<number>,
  alreadyForwarded: ReadonlySet<number>,
): { remaining: ReadonlyArray<number>; skipped: number } {
  const remaining: number[] = [];
  let skipped = 0;
  for (const id of sourceIds) {
    if (alreadyForwarded.has(id)) {
      skipped += 1;
    } else {
      remaining.push(id);
    }
  }
  return { remaining, skipped };
}

export type ReplayDeps = {
  // Loads the set of source_message_ids already forwarded for this
  // (replay_run_id, source_chat_id, destination_chat_id). Caller wires
  // this to the replay_log table.
  loadAlreadyForwarded: (
    runId: string,
    sourceChatId: number,
    destinationChatId: number,
  ) => Promise<ReadonlySet<number>>;
  // Bot API forwardMessages caller. Returns the forwarded
  // destination_message_ids in the same order as sourceMessageIds.
  forwarder: (
    sourceChatId: number,
    destinationChatId: number,
    sourceMessageIds: ReadonlyArray<number>,
  ) => Promise<ReadonlyArray<number>>;
  // Records the (run, source, destination, source_msg, dest_msg)
  // tuples in replay_log. Caller wires this to the DB insert.
  recordForwarded: (
    runId: string,
    sourceChatId: number,
    destinationChatId: number,
    sourceToDestination: ReadonlyArray<{ sourceMessageId: number; destinationMessageId: number }>,
  ) => Promise<void>;
  // Sleep between batches. Tests inject a no-op.
  sleep: (ms: number) => Promise<void>;
};

export type ReplayInput = {
  runId: string;
  sourceChatId: number;
  destinationChatId: number;
  sourceMessageIds: ReadonlyArray<number>;
  batchSize?: number;
  delayMs?: number;
  onBatch?: (batch: ReplayBatchResult) => void;
};

export async function replayChannelArchive(
  input: ReplayInput,
  deps: ReplayDeps,
): Promise<ReplaySummary> {
  const batchSize = input.batchSize ?? FORWARD_BATCH_SIZE;
  const delayMs = input.delayMs ?? BATCH_DELAY_MS;

  const already = await deps.loadAlreadyForwarded(
    input.runId,
    input.sourceChatId,
    input.destinationChatId,
  );
  const { remaining, skipped } = filterAlreadyForwarded(
    input.sourceMessageIds,
    already,
  );
  const batches = batchMessageIds(remaining, batchSize);

  let totalForwarded = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const sourceIds = batches[batchIndex]!;
    const destIds = await deps.forwarder(
      input.sourceChatId,
      input.destinationChatId,
      sourceIds,
    );
    if (destIds.length !== sourceIds.length) {
      throw new Error(
        `forwarder returned ${destIds.length} ids for ${sourceIds.length} sources`,
      );
    }
    const pairs = sourceIds.map((sourceMessageId, i) => ({
      sourceMessageId,
      destinationMessageId: destIds[i]!,
    }));
    // recordForwarded is the dual-write half: forward first (Telegram side
    // effect already happened by here) then log to replay_log. If this
    // throws we're in a split-brain — the messages are forwarded but no
    // log row exists, so a rerun would re-forward them. Wrap the failure
    // so the operator sees what just happened and can decide whether to
    // resume the run with a fresh runId vs. tolerate duplicates.
    try {
      await deps.recordForwarded(
        input.runId,
        input.sourceChatId,
        input.destinationChatId,
        pairs,
      );
    } catch (recordErr) {
      const summary = sourceIds.slice(0, 5).join(",");
      throw new Error(
        `recordForwarded failed AFTER successful forward of ${sourceIds.length} ` +
          `messages (run=${input.runId}, source=${input.sourceChatId}, ` +
          `dest=${input.destinationChatId}, src_ids=${summary}...). ` +
          `Forwards already landed in Telegram; rerunning this run_id will ` +
          `re-forward them. Use a fresh --run-id only if duplicates are ` +
          `acceptable. Original error: ${(recordErr as Error)?.message ?? recordErr}`,
        { cause: recordErr },
      );
    }
    totalForwarded += sourceIds.length;
    input.onBatch?.({
      batchIndex,
      sourceMessageIds: sourceIds,
      destinationMessageIds: destIds,
    });
    // Don't sleep after the last batch — there's nothing to throttle for.
    if (batchIndex < batches.length - 1) {
      await deps.sleep(delayMs);
    }
  }

  return {
    totalForwarded,
    batches: batches.length,
    skippedAlreadyForwarded: skipped,
  };
}
