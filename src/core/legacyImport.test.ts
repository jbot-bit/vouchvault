import assert from "node:assert/strict";
import test from "node:test";

import { parseLegacyExportMessage } from "./legacyImportParser.ts";

const SOURCE_CHAT_ID = -1001234567890;

function buildMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    type: "message",
    date: "2024-01-15T12:00:00Z",
    from: "reviewer_user",
    text: "+rep @target_user",
    ...overrides,
  };
}

test("imports a positive legacy message with one clear target", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage(),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.reviewerUsername, "reviewer_user");
  assert.equal(decision.candidate.targetUsername, "target_user");
  assert.equal(decision.candidate.result, "positive");
  assert.deepEqual(decision.candidate.selectedTags, ["good_comms"]);
  assert.equal(decision.candidate.entryType, "service");
});

test("imports a negative legacy message with one clear target", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "warning avoid @target_user",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.result, "negative");
  assert.deepEqual(decision.candidate.selectedTags, ["poor_comms"]);
});

test("imports not legit as a negative legacy message", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "not legit @target_user",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.result, "negative");
});

test("skips when both positive and negative legacy markers are present", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "+rep but warning avoid @target_user",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "unclear_sentiment");
});

test("skips negated positive wording instead of importing it as positive", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "not good @target_user",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "unclear_sentiment");
});

test("skips negated negative wording instead of importing it as negative", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "not bad @target_user",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "unclear_sentiment");
});

test("skips when no target handle is present", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "+rep legit trader",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "missing_target");
});

test("skips when multiple target handles are present", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "+rep @target_user and @second_user",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "multiple_targets");
});

test("skips when no sender username can be derived", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "Reviewer Display Name",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "missing_reviewer");
});

test("skips self-targeted legacy messages", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      text: "+rep @reviewer_user",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.reviewItem.reason, "self_target");
});

test("synthesises reviewer handle from numeric from_id when @username is missing", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 2,
      date_unixtime: "1700000000",
      from: null,
      from_id: "user6812728770",
      text: "@target +vouch",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "import");
  if (decision.kind === "import") {
    assert.equal(decision.candidate.reviewerUsername, "user6812728770");
    assert.equal(decision.candidate.reviewerTelegramId, 6812728770);
  }
});

test("skips chat<id> and channel<id> from_id values as bot_sender", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 3,
      date_unixtime: "1700000000",
      from: null,
      from_id: "channel1234567890",
      text: "@target +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "bot_sender");
  }
});

test("skips messages from configured bot senders", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 1,
      date_unixtime: "1700000000",
      from: "GroupHelpBot",
      from_id: "user5555555",
      text: "@target +rep",
    },
    sourceChatId: -1001234567890,
    botSenders: new Set(["grouphelpbot"]),
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "bot_sender");
    assert.equal(decision.reviewItem.reason, "bot_sender");
  }
});
