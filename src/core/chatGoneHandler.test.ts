import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChatGone } from "./chatGoneHandler.ts";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

test("handleChatGone is a no-op when chatId is undefined", async () => {
  const calls: string[] = [];
  await handleChatGone({
    chatId: undefined,
    adminTelegramIds: [1, 2],
    logger: silentLogger,
    deps: {
      setChatGone: async (id: number) => {
        calls.push(`setChatGone(${id})`);
        return { newlyGone: true };
      },
      sendDM: async (input) => {
        calls.push(`send(${input.chatId})`);
      },
      recordAudit: async (entry) => {
        calls.push(`audit(${entry.command})`);
      },
    },
  });

  assert.deepEqual(calls, []);
});

test("handleChatGone DMs each admin once on first transition", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20, 30],
    logger: silentLogger,
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async (input) => {
        sentTo.push(input.chatId);
      },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, [10, 20, 30]);
});

test("handleChatGone does not DM on repeat transitions", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20],
    logger: silentLogger,
    deps: {
      setChatGone: async () => ({ newlyGone: false }),
      sendDM: async (input) => {
        sentTo.push(input.chatId);
      },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, []);
});

test("handleChatGone tolerates one admin's DM throwing", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20, 30],
    logger: silentLogger,
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async (input) => {
        if (input.chatId === 20) throw new Error("blocked");
        sentTo.push(input.chatId);
      },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, [10, 30]);
});

test("handleChatGone tolerates audit-log write failing", async () => {
  let dmSent = false;
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10],
    logger: silentLogger,
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async () => {
        dmSent = true;
      },
      recordAudit: async () => {
        throw new Error("db down");
      },
    },
  });
  assert.equal(dmSent, true);
});
