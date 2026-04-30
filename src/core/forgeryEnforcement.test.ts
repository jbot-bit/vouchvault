import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _resetDedupCacheForTests,
  buildWarnText,
  enforceForgery,
  type EnforcementDeps,
} from "./forgeryEnforcement.ts";
import type { ForgeryVerdict } from "./forgeryDetector.ts";

beforeEach(() => {
  _resetDedupCacheForTests();
});

type Calls = {
  deleted: number;
  dmed: number;
  strikeRecorded: number;
  audited: number;
  frozen: number;
  warnLogs: any[];
};

function buildDeps(opts?: {
  recentStrikes?: number;
  deleteSucceeds?: boolean;
  dmThrows?: boolean;
  freezeReturns?: { frozen: boolean };
}): { deps: EnforcementDeps; calls: Calls } {
  const calls: Calls = {
    deleted: 0,
    dmed: 0,
    strikeRecorded: 0,
    audited: 0,
    frozen: 0,
    warnLogs: [],
  };
  const deps: EnforcementDeps = {
    deleteMessage: async () => {
      calls.deleted += 1;
      if (opts?.deleteSucceeds === false) {
        throw new Error("not found");
      }
      return { deleted: true };
    },
    dmUser: async () => {
      calls.dmed += 1;
      if (opts?.dmThrows) throw new Error("blocked");
    },
    recordStrike: async () => {
      calls.strikeRecorded += 1;
      return { id: 99 };
    },
    countRecentStrikes: async () => opts?.recentStrikes ?? 1,
    audit: async () => {
      calls.audited += 1;
    },
    freezeUser: async () => {
      calls.frozen += 1;
      return opts?.freezeReturns ?? { frozen: true };
    },
    logger: {
      warn: (ctx) => {
        calls.warnLogs.push(ctx);
      },
      info: () => {},
    },
  };
  return { deps, calls };
}

const verdict: ForgeryVerdict = {
  kind: "forge_from_blank",
  reason: "test",
  contentHash: "abcdef0123456789",
};

test("enforceForgery: happy path — delete + strike + dm + audit + no freeze", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 1 });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(result.deduped, false);
  assert.equal(result.deleted, true);
  assert.equal(result.strikeId, 99);
  assert.equal(result.recentStrikeCount, 1);
  assert.equal(result.escalatedToFreeze, false);
  assert.equal(calls.deleted, 1);
  assert.equal(calls.dmed, 1);
  assert.equal(calls.strikeRecorded, 1);
  assert.equal(calls.audited, 1);
  assert.equal(calls.frozen, 0);
});

test("enforceForgery: delete failure still records strike + audits", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 1, deleteSucceeds: false });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(result.deleted, false);
  assert.equal(calls.strikeRecorded, 1);
  assert.equal(calls.audited, 1);
  assert.ok(calls.warnLogs.length >= 1, "delete failure should log warn");
});

test("enforceForgery: dm failure swallowed", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 1, dmThrows: true });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(result.deleted, true);
  assert.equal(calls.audited, 1);
});

test("enforceForgery: 3rd strike escalates to freeze", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 3 });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(result.escalatedToFreeze, true);
  assert.equal(calls.frozen, 1);
});

test("enforceForgery: 2nd strike does not freeze", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 2 });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(result.escalatedToFreeze, false);
  assert.equal(calls.frozen, 0);
});

test("enforceForgery: dedup short-circuits a re-fire on same key within TTL", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 1 });
  const r1 = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  const r2 = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(calls.deleted, 1, "delete should fire only once");
  assert.equal(calls.strikeRecorded, 1);
});

test("enforceForgery: different message ids do not dedup", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 1 });
  await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
  });
  await enforceForgery(deps, {
    chatId: -100,
    messageId: 43,
    userId: 7,
    verdict,
  });
  assert.equal(calls.deleted, 2);
});

test("enforceForgery: custom config overrides defaults", async () => {
  const { deps, calls } = buildDeps({ recentStrikes: 5 });
  const result = await enforceForgery(deps, {
    chatId: -100,
    messageId: 42,
    userId: 7,
    verdict,
    config: { freezeThreshold: 10, freezeWindowHours: 1 },
  });
  assert.equal(result.escalatedToFreeze, false);
  assert.equal(calls.frozen, 0);
});

test("buildWarnText: forge_from_blank mentions @VouchVaultBot", () => {
  const t = buildWarnText("forge_from_blank");
  assert.match(t, /@VouchVaultBot/);
  assert.match(t, /forged|forgery|forge/);
});

test("buildWarnText: edit_of_real_card mentions edit", () => {
  const t = buildWarnText("edit_of_real_card");
  assert.match(t, /edit/i);
});

test("buildWarnText: lookalike_bot mentions different bot", () => {
  const t = buildWarnText("lookalike_bot");
  assert.match(t, /different bot/i);
});
