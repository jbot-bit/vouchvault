import test from "node:test";
import assert from "node:assert/strict";

import {
  BATCH_DELAY_MS,
  FORWARD_BATCH_SIZE,
  TARGET_MSGS_PER_SEC,
  batchMessageIds,
  filterAlreadyForwarded,
  replayChannelArchive,
  type ReplayDeps,
} from "./replayToTelegram.ts";

test("batchMessageIds: chunks of 100 by default; last batch may be short", () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const batches = batchMessageIds(ids);
  assert.equal(batches.length, 3);
  assert.equal(batches[0]!.length, 100);
  assert.equal(batches[1]!.length, 100);
  assert.equal(batches[2]!.length, 50);
});

test("batchMessageIds: empty input → empty output", () => {
  assert.deepEqual(batchMessageIds([]), []);
});

test("batchMessageIds: respects custom batch size", () => {
  const batches = batchMessageIds([1, 2, 3, 4, 5], 2);
  assert.deepEqual(
    batches.map((b) => [...b]),
    [
      [1, 2],
      [3, 4],
      [5],
    ],
  );
});

test("filterAlreadyForwarded: skips ids in the already-set, preserves order", () => {
  const r = filterAlreadyForwarded([1, 2, 3, 4, 5], new Set([2, 4]));
  assert.deepEqual([...r.remaining], [1, 3, 5]);
  assert.equal(r.skipped, 2);
});

test("BATCH_DELAY_MS is calibrated to ~25 msgs/sec broadcast cap", () => {
  // 25 msgs/sec target, 100 ids per batch → 4000 ms between batches.
  assert.equal(TARGET_MSGS_PER_SEC, 25);
  assert.equal(FORWARD_BATCH_SIZE, 100);
  assert.equal(BATCH_DELAY_MS, 4000);
});

function buildDeps(): {
  deps: ReplayDeps;
  recorded: Array<{
    runId: string;
    sourceChatId: number;
    destinationChatId: number;
    pairs: ReadonlyArray<{ sourceMessageId: number; destinationMessageId: number }>;
  }>;
  forwardCalls: Array<{
    sourceChatId: number;
    destinationChatId: number;
    sourceIds: ReadonlyArray<number>;
  }>;
  sleeps: number[];
  alreadyForwarded: Set<number>;
} {
  const recorded: Array<{
    runId: string;
    sourceChatId: number;
    destinationChatId: number;
    pairs: ReadonlyArray<{ sourceMessageId: number; destinationMessageId: number }>;
  }> = [];
  const forwardCalls: Array<{
    sourceChatId: number;
    destinationChatId: number;
    sourceIds: ReadonlyArray<number>;
  }> = [];
  const sleeps: number[] = [];
  const alreadyForwarded = new Set<number>();

  const deps: ReplayDeps = {
    loadAlreadyForwarded: async () => alreadyForwarded,
    forwarder: async (sourceChatId, destinationChatId, sourceIds) => {
      forwardCalls.push({ sourceChatId, destinationChatId, sourceIds });
      // Fake destination ids: source + 10000.
      return sourceIds.map((id) => id + 10000);
    },
    recordForwarded: async (runId, sourceChatId, destinationChatId, pairs) => {
      recorded.push({ runId, sourceChatId, destinationChatId, pairs });
      // Update the in-test "already forwarded" set so a subsequent rerun
      // would skip these ids.
      for (const p of pairs) alreadyForwarded.add(p.sourceMessageId);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  return { deps, recorded, forwardCalls, sleeps, alreadyForwarded };
}

test("replayChannelArchive: forwards in batches and records each pair", async () => {
  const env = buildDeps();
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const summary = await replayChannelArchive(
    {
      runId: "00000000-0000-0000-0000-000000000001",
      sourceChatId: -1003744691748,
      destinationChatId: -1009000000000,
      sourceMessageIds: ids,
      // Use small batch for test speed; production uses 100.
      batchSize: 100,
      delayMs: 0, // tests don't care about real timing
    },
    env.deps,
  );
  assert.equal(summary.totalForwarded, 250);
  assert.equal(summary.batches, 3);
  assert.equal(summary.skippedAlreadyForwarded, 0);
  assert.equal(env.forwardCalls.length, 3);
  assert.equal(env.forwardCalls[0]!.sourceIds.length, 100);
  assert.equal(env.forwardCalls[2]!.sourceIds.length, 50);
  assert.equal(env.recorded.length, 3);
  // First-batch pair sanity: src=1 → dest=10001
  assert.deepEqual(env.recorded[0]!.pairs[0], {
    sourceMessageId: 1,
    destinationMessageId: 10001,
  });
});

test("replayChannelArchive: idempotent — rerun skips already-forwarded ids", async () => {
  const env = buildDeps();
  const ids = [1, 2, 3, 4, 5];
  const first = await replayChannelArchive(
    {
      runId: "run-A",
      sourceChatId: 100,
      destinationChatId: 200,
      sourceMessageIds: ids,
      batchSize: 5,
      delayMs: 0,
    },
    env.deps,
  );
  assert.equal(first.totalForwarded, 5);
  assert.equal(first.skippedAlreadyForwarded, 0);

  // Rerun with the same run/source/dest — all 5 ids should be skipped.
  const second = await replayChannelArchive(
    {
      runId: "run-A",
      sourceChatId: 100,
      destinationChatId: 200,
      sourceMessageIds: ids,
      batchSize: 5,
      delayMs: 0,
    },
    env.deps,
  );
  assert.equal(second.totalForwarded, 0);
  assert.equal(second.batches, 0);
  assert.equal(second.skippedAlreadyForwarded, 5);
  // Forwarder must NOT have been called again.
  assert.equal(env.forwardCalls.length, 1);
});

test("replayChannelArchive: sleeps between batches but not after the last", async () => {
  const env = buildDeps();
  await replayChannelArchive(
    {
      runId: "run-B",
      sourceChatId: 1,
      destinationChatId: 2,
      sourceMessageIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      batchSize: 3, // 4 batches: 3+3+3+1
      delayMs: 7,
    },
    env.deps,
  );
  // 4 batches → 3 inter-batch sleeps.
  assert.deepEqual(env.sleeps, [7, 7, 7]);
});

test("replayChannelArchive: forwarder length-mismatch errors loudly", async () => {
  const env = buildDeps();
  // Override forwarder to return wrong count.
  env.deps.forwarder = async () => [1, 2]; // expected 3
  await assert.rejects(
    replayChannelArchive(
      {
        runId: "bad",
        sourceChatId: 1,
        destinationChatId: 2,
        sourceMessageIds: [10, 20, 30],
        batchSize: 3,
        delayMs: 0,
      },
      env.deps,
    ),
    /returned 2 ids for 3 sources/,
  );
});

test("replayChannelArchive: empty input returns zero-everything summary, no calls", async () => {
  const env = buildDeps();
  const summary = await replayChannelArchive(
    {
      runId: "empty",
      sourceChatId: 1,
      destinationChatId: 2,
      sourceMessageIds: [],
      delayMs: 0,
    },
    env.deps,
  );
  assert.equal(summary.totalForwarded, 0);
  assert.equal(summary.batches, 0);
  assert.equal(summary.skippedAlreadyForwarded, 0);
  assert.equal(env.forwardCalls.length, 0);
  assert.equal(env.sleeps.length, 0);
});
