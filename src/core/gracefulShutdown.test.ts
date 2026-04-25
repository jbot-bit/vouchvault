import { test } from "node:test";
import assert from "node:assert/strict";
import { installGracefulShutdown } from "./gracefulShutdown.ts";

test("runOnce closes server and ends pool", async () => {
  let serverClosed = false;
  let poolClosed = false;
  const fakeServer = {
    close: (cb: () => void) => {
      serverClosed = true;
      cb();
    },
  };
  const fakePool = {
    end: async () => {
      poolClosed = true;
    },
  };
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
  const shutdown = installGracefulShutdown({
    server: fakeServer,
    dbPool: fakePool,
    drainMs: 10,
    hardCeilingMs: 200,
    logger: noopLogger,
  });
  await shutdown.runOnce("TEST");
  assert.equal(serverClosed, true);
  assert.equal(poolClosed, true);
});

test("runOnce is idempotent (second call is a no-op)", async () => {
  let serverCloseCalls = 0;
  let poolEndCalls = 0;
  const fakeServer = {
    close: (cb: () => void) => {
      serverCloseCalls += 1;
      cb();
    },
  };
  const fakePool = {
    end: async () => {
      poolEndCalls += 1;
    },
  };
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
  const shutdown = installGracefulShutdown({
    server: fakeServer,
    dbPool: fakePool,
    drainMs: 10,
    hardCeilingMs: 200,
    logger: noopLogger,
  });
  await shutdown.runOnce("TEST");
  await shutdown.runOnce("TEST_AGAIN");
  assert.equal(serverCloseCalls, 1);
  assert.equal(poolEndCalls, 1);
});
