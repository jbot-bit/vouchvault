import { test } from "node:test";
import assert from "node:assert/strict";
import { purgeForgeries, renderForgeriesPage, type StrikeRow } from "./forgeriesAdmin.ts";
import { CARD_GLYPHS } from "./forgeryDetector.ts";

const NOW = new Date("2026-05-01T12:00:00Z");
const OUR_BOT_ID = 12345;

function fakeCard(target = "daveyboi", date = "03/02/2026"): string {
  return `${CARD_GLYPHS.board} @${target} ${CARD_GLYPHS.emDash} 14 ${CARD_GLYPHS.pos} ${CARD_GLYPHS.middot} 2 ${CARD_GLYPHS.warn} (16 over 8 months)\n${CARD_GLYPHS.middot} ${date} @sarah ${CARD_GLYPHS.emDash} "fast meet" ${CARD_GLYPHS.pos}`;
}

function strike(opts?: Partial<StrikeRow>): StrikeRow {
  return {
    id: opts?.id ?? 1,
    userId: opts?.userId ?? 7,
    chatId: opts?.chatId ?? -1003728299216,
    messageId: opts?.messageId ?? 100,
    kind: opts?.kind ?? "forge_from_blank",
    detectedAt: opts?.detectedAt ?? NOW,
    contentHash: opts?.contentHash ?? "abcdef0123456789",
    deleted: opts?.deleted ?? true,
  };
}

test("renderForgeriesPage: empty state", () => {
  const out = renderForgeriesPage({ rows: [], page: 0, total: 0 });
  assert.match(out.text, /No forgeries recorded/);
  assert.deepEqual(out.replyMarkup, { inline_keyboard: [] });
});

test("renderForgeriesPage: shows page n/N + total", () => {
  const out = renderForgeriesPage({
    rows: [strike()],
    page: 0,
    total: 25,
  });
  assert.match(out.text, /page 1\/3 \(25 total\)/);
});

test("renderForgeriesPage: row shows date + kind + uid + status + hash", () => {
  const out = renderForgeriesPage({
    rows: [
      strike({
        userId: 42,
        kind: "forge_from_blank",
        detectedAt: new Date("2026-04-15T00:00:00Z"),
        contentHash: "abc1234567890def",
        deleted: true,
      }),
    ],
    page: 0,
    total: 1,
  });
  assert.match(out.text, /15\/04\/2026 · forge_from_blank · uid=42 · deleted · abc1234567890def/);
});

test("renderForgeriesPage: prev hidden on first page, next shown when more pages", () => {
  const out = renderForgeriesPage({ rows: [strike()], page: 0, total: 25 });
  const buttons = (out.replyMarkup.inline_keyboard as any[][])[0]!;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].text, "next ›");
  assert.equal(buttons[0].callback_data, "vc:p:1");
});

test("renderForgeriesPage: middle page shows prev + next", () => {
  const out = renderForgeriesPage({ rows: [strike()], page: 1, total: 30 });
  const buttons = (out.replyMarkup.inline_keyboard as any[][])[0]!;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].callback_data, "vc:p:0");
  assert.equal(buttons[1].callback_data, "vc:p:2");
});

test("renderForgeriesPage: last page shows prev only", () => {
  const out = renderForgeriesPage({ rows: [strike()], page: 2, total: 30 });
  const buttons = (out.replyMarkup.inline_keyboard as any[][])[0]!;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].callback_data, "vc:p:1");
});

test("renderForgeriesPage: page beyond total clamps to last page", () => {
  const out = renderForgeriesPage({ rows: [], page: 99, total: 5 });
  assert.match(out.text, /page 1\/1/);
});

test("purgeForgeries: dry-run reports candidates without deleting", async () => {
  let deleted = 0;
  const result = await purgeForgeries({
    ourBotId: OUR_BOT_ID,
    confirm: false,
    fetchBatch: async (offset) => {
      if (offset > 0) return [];
      return [
        { groupChatId: -100, groupMessageId: 1, viaBotId: null, text: fakeCard("aaa") },
        { groupChatId: -100, groupMessageId: 2, viaBotId: null, text: "not a card" },
        {
          groupChatId: -100,
          groupMessageId: 3,
          viaBotId: OUR_BOT_ID,
          text: fakeCard("ccc"),
        },
      ];
    },
    deleteMessage: async () => {
      deleted += 1;
    },
  });
  assert.equal(result.scanned, 3);
  assert.equal(result.candidates, 1); // only msg 1 — msg 3 has via=ours, msg 2 isn't a card
  assert.equal(result.deleted, 0);
  assert.equal(deleted, 0);
  assert.equal(result.sample.length, 1);
});

test("purgeForgeries: confirm mode deletes candidates", async () => {
  const calls: Array<[number, number]> = [];
  const result = await purgeForgeries({
    ourBotId: OUR_BOT_ID,
    confirm: true,
    fetchBatch: async (offset) => {
      if (offset > 0) return [];
      return [
        { groupChatId: -100, groupMessageId: 1, viaBotId: null, text: fakeCard("aaa") },
        { groupChatId: -100, groupMessageId: 2, viaBotId: null, text: fakeCard("bbb") },
      ];
    },
    deleteMessage: async (c, m) => {
      calls.push([c, m]);
    },
  });
  assert.equal(result.candidates, 2);
  assert.equal(result.deleted, 2);
  assert.deepEqual(calls, [
    [-100, 1],
    [-100, 2],
  ]);
});

test("purgeForgeries: confirm mode counts deleteMessage failures", async () => {
  const result = await purgeForgeries({
    ourBotId: OUR_BOT_ID,
    confirm: true,
    fetchBatch: async (offset) => {
      if (offset > 0) return [];
      return [{ groupChatId: -100, groupMessageId: 1, viaBotId: null, text: fakeCard("aaa") }];
    },
    deleteMessage: async () => {
      throw new Error("not found");
    },
  });
  assert.equal(result.candidates, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.errors, 1);
});

test("purgeForgeries: walks multiple batches", async () => {
  let totalSeen = 0;
  const result = await purgeForgeries({
    ourBotId: OUR_BOT_ID,
    confirm: false,
    fetchBatch: async (offset, limit) => {
      // Two batches of 100 then empty.
      if (offset >= 200) return [];
      const out = [];
      for (let i = 0; i < limit; i++) {
        out.push({
          groupChatId: -100,
          groupMessageId: offset + i,
          viaBotId: null,
          text: fakeCard("xxx"),
        });
      }
      totalSeen += out.length;
      return out;
    },
    deleteMessage: async () => {},
  });
  assert.equal(result.scanned, 200);
  assert.equal(result.candidates, 200);
  assert.equal(totalSeen, 200);
});

test("purgeForgeries: null text rows are skipped", async () => {
  const result = await purgeForgeries({
    ourBotId: OUR_BOT_ID,
    confirm: false,
    fetchBatch: async (offset) => {
      if (offset > 0) return [];
      return [
        { groupChatId: -100, groupMessageId: 1, viaBotId: null, text: null },
        { groupChatId: -100, groupMessageId: 2, viaBotId: null, text: fakeCard("yyyaaa") },
      ];
    },
    deleteMessage: async () => {},
  });
  assert.equal(result.scanned, 2);
  assert.equal(result.candidates, 1);
});
