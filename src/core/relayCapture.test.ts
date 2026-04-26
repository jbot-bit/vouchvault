import test from "node:test";
import assert from "node:assert/strict";

import { classifyAutoForward } from "./relayCapture.ts";

const CHANNEL = -1003744691748;
const SUPERGROUP = -1003958981628;
const OTHER_SUPERGROUP = -1009999999999;

test("classifyAutoForward: legacy fields (forward_from_chat + forward_from_message_id) match", () => {
  const r = classifyAutoForward({
    message: {
      message_id: 555,
      is_automatic_forward: true,
      forward_from_chat: { id: CHANNEL, type: "channel" },
      forward_from_message_id: 99,
      chat: { id: SUPERGROUP, type: "supergroup" },
    },
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, true);
  if (r.matched) {
    assert.equal(r.channelId, CHANNEL);
    assert.equal(r.channelMessageId, 99);
    assert.equal(r.supergroupChatId, SUPERGROUP);
    assert.equal(r.supergroupMessageId, 555);
  }
});

test("classifyAutoForward: new forward_origin shape match", () => {
  const r = classifyAutoForward({
    message: {
      message_id: 600,
      is_automatic_forward: true,
      forward_origin: {
        type: "channel",
        chat: { id: CHANNEL, type: "channel" },
        message_id: 100,
      },
      chat: { id: SUPERGROUP, type: "supergroup" },
    },
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, true);
  if (r.matched) {
    assert.equal(r.channelMessageId, 100);
    assert.equal(r.supergroupMessageId, 600);
  }
});

test("classifyAutoForward: not is_automatic_forward → no match", () => {
  const r = classifyAutoForward({
    message: {
      message_id: 7,
      forward_from_chat: { id: CHANNEL },
      forward_from_message_id: 1,
      chat: { id: SUPERGROUP },
    },
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, false);
});

test("classifyAutoForward: wrong source channel → no match", () => {
  const r = classifyAutoForward({
    message: {
      message_id: 8,
      is_automatic_forward: true,
      forward_from_chat: { id: -100999 },
      forward_from_message_id: 2,
      chat: { id: SUPERGROUP },
    },
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, false);
});

test("classifyAutoForward: destination not in allowlist → no match", () => {
  const r = classifyAutoForward({
    message: {
      message_id: 9,
      is_automatic_forward: true,
      forward_from_chat: { id: CHANNEL },
      forward_from_message_id: 3,
      chat: { id: OTHER_SUPERGROUP },
    },
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, false);
});

test("classifyAutoForward: missing message returns matched:false with reason", () => {
  const r = classifyAutoForward({
    message: null,
    expectedChannelId: CHANNEL,
    allowedSupergroupIds: [SUPERGROUP],
  });
  assert.equal(r.matched, false);
});
