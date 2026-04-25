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

test("imports `pos vouch @target` style messages", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({ text: "POS VOUCH @target_user great deal" }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.result, "positive");
  assert.equal(decision.candidate.targetUsername, "target_user");
});

test("imports `neg vouch @target` style messages", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({ text: "Neg vouch @target_user owes me money" }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.result, "negative");
});

test("skips messages whose sender display name contains 'bot'", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "Suncoast Bot",
      text: "@target_user [12345] banned.",
    }),
  });

  assert.equal(decision.kind, "skip");
  assert.equal(decision.bucket, "other");
});

test("unwraps a FROM/DATE manual-repost header and uses its fields", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "-",
      text:
        "FROM: @rixx_aus / 2091586089\n" +
        "DATE: 05/04/2026\n" +
        "\n" +
        "Pos vouch @mordecai_on good lad, always a pleasure",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.reviewerUsername, "rixx_aus");
  assert.equal(decision.candidate.targetUsername, "mordecai_on");
  assert.equal(decision.candidate.result, "positive");
  assert.equal(
    decision.candidate.originalTimestamp.toISOString().slice(0, 10),
    "2026-04-05",
  );
});

test("unwraps a FROM/DATE header for a DELETED ACCOUNT into a synthetic legacy username", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "-",
      text:
        "FROM: DELETED ACCOUNT / 8448430705\n" +
        "DATE: 05/04/2026\n" +
        "\n" +
        "+rep @cool_ridge solid",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.reviewerUsername, "legacy_8448430705");
  assert.equal(decision.candidate.targetUsername, "cool_ridge");
});

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
