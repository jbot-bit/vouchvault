import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleChosenInlineResult,
  handleInlineQuery,
  type InlineQueryDeps,
} from "./inlineQueryHandler.ts";

const NOW = new Date("2026-05-01T12:00:00Z");

type Calls = {
  answers: Array<{ id: string; results: Array<Record<string, unknown>>; button?: any }>;
  fetched: string[];
  rateLimitedUsers: Set<number>;
};

function buildDeps(opts?: {
  isMember?: (userId: number) => Promise<boolean>;
  archive?: Map<string, { targetId: number; rows: any[] }>;
  rateLimitDenyForUser?: number;
  fetchDelayMs?: number;
}): { deps: InlineQueryDeps; calls: Calls } {
  const calls: Calls = { answers: [], fetched: [], rateLimitedUsers: new Set() };
  const archive = opts?.archive ?? new Map();
  const deps: InlineQueryDeps = {
    isMember: opts?.isMember ?? (async () => true),
    fetchArchive: async (username) => {
      calls.fetched.push(username);
      if (opts?.fetchDelayMs) {
        await new Promise((r) => setTimeout(r, opts.fetchDelayMs));
      }
      return archive.get(username) ?? null;
    },
    rateLimit: (userId) => {
      if (opts?.rateLimitDenyForUser === userId) {
        calls.rateLimitedUsers.add(userId);
        return { allowed: false, retryAfterMs: 3000 };
      }
      return { allowed: true };
    },
    answer: async (input) => {
      calls.answers.push({ id: input.inlineQueryId, results: input.results, button: input.button });
    },
    now: () => NOW,
    logger: { info: () => {}, warn: () => {} },
  };
  return { deps, calls };
}

test("missing inline_query_id is ignored", async () => {
  const { deps, calls } = buildDeps();
  const r = await handleInlineQuery(deps, { from: { id: 1 } });
  assert.equal(r.kind, "ignored");
  assert.equal(calls.answers.length, 0);
});

test("non-member sees redirect-to-DM hint with PM button", async () => {
  const { deps, calls } = buildDeps({ isMember: async () => false });
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "daveyboi",
    chat_type: "supergroup",
  });
  assert.equal(r.kind, "non_member");
  assert.equal(calls.answers.length, 1);
  assert.equal(calls.answers[0]!.button?.text, "DM the bot to /lookup");
});

test("wrong chat_type (group) returns non-insertable hint", async () => {
  const { deps, calls } = buildDeps();
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "x",
    chat_type: "group",
  });
  assert.equal(r.kind, "wrong_chat_type");
  assert.equal(calls.answers.length, 1);
});

test("wrong chat_type (channel) returns non-insertable hint", async () => {
  const { deps, calls } = buildDeps();
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "x",
    chat_type: "channel",
  });
  assert.equal(r.kind, "wrong_chat_type");
});

test("supergroup chat_type is allowed", async () => {
  const { deps } = buildDeps();
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "",
    chat_type: "supergroup",
  });
  assert.equal(r.kind, "empty_query");
});

test("sender chat_type (DM with bot) is allowed", async () => {
  const { deps } = buildDeps();
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "",
    chat_type: "sender",
  });
  assert.equal(r.kind, "empty_query");
});

test("empty query returns 'Type a username' hint", async () => {
  const { deps, calls } = buildDeps();
  await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "   ",
    chat_type: "supergroup",
  });
  const a = calls.answers[0];
  const result = a!.results[0]! as { title: string };
  assert.match(result.title, /Type a username/i);
});

test("rate-limited query returns 'Slow down' hint", async () => {
  const { deps, calls } = buildDeps({ rateLimitDenyForUser: 1 });
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "daveyboi",
    chat_type: "supergroup",
  });
  assert.equal(r.kind, "rate_limited");
  const result = calls.answers[0]!.results[0]! as { title: string };
  assert.match(result.title, /Slow down/i);
});

test("query strips leading @ and lowercases", async () => {
  const { deps, calls } = buildDeps();
  await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "@DAVEYBOI",
    chat_type: "supergroup",
  });
  assert.equal(calls.fetched[0], "daveyboi");
});

test("no-record returns no_record hint", async () => {
  const { deps, calls } = buildDeps();
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "daveyboi",
    chat_type: "supergroup",
  });
  assert.equal(r.kind, "no_record");
  const result = calls.answers[0]!.results[0]! as { title: string };
  assert.match(result.title, /No record/);
});

test("valid query renders insertable card with content hash in id", async () => {
  const archive = new Map([
    [
      "daveyboi",
      {
        targetId: 42,
        rows: [
          {
            reviewerUsername: "sarah",
            result: "POS" as const,
            bodyText: "fast meet",
            createdAt: new Date("2026-04-15T00:00:00Z"),
          },
        ],
      },
    ],
  ]);
  const { deps, calls } = buildDeps({ archive });
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "daveyboi",
    chat_type: "supergroup",
  });
  assert.equal(r.kind, "card");
  const result = calls.answers[0]!.results[0]! as {
    id: string;
    input_message_content: { message_text: string };
  };
  assert.match(result.id, /^42:[a-f0-9]+$/);
  assert.match(result.input_message_content.message_text, /@daveyboi/);
});

test("fetch-archive throwing settles via Promise.race catch", async () => {
  const deps: InlineQueryDeps = {
    isMember: async () => true,
    fetchArchive: async () => {
      throw new Error("db down");
    },
    rateLimit: () => ({ allowed: true }),
    answer: async () => {},
    logger: { warn: () => {} },
  };
  const r = await handleInlineQuery(deps, {
    id: "q1",
    from: { id: 1 },
    query: "x",
    chat_type: "supergroup",
  });
  assert.match(r.kind, /ignored|deadline_exceeded/);
});

test("handleChosenInlineResult records choice with parsed hash", async () => {
  let recorded: any = null;
  await handleChosenInlineResult(
    {
      recordChoice: async (input) => {
        recorded = input;
      },
    },
    { result_id: "42:abcdef0123456789", from: { id: 7 }, query: "@DaveyBoi" },
  );
  assert.deepEqual(recorded, {
    userId: 7,
    targetUsername: "daveyboi",
    contentHash: "abcdef0123456789",
  });
});

test("handleChosenInlineResult ignores updates with no hash", async () => {
  let called = false;
  await handleChosenInlineResult(
    {
      recordChoice: async () => {
        called = true;
      },
    },
    { result_id: "no_hash", from: { id: 7 }, query: "x" },
  );
  assert.equal(called, false);
});

test("handleChosenInlineResult swallows recordChoice errors", async () => {
  await handleChosenInlineResult(
    {
      recordChoice: async () => {
        throw new Error("db");
      },
      logger: { warn: () => {} },
    },
    { result_id: "1:abc", from: { id: 7 }, query: "x" },
  );
  // Should not throw.
  assert.ok(true);
});
