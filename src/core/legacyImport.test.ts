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

test("skips multiple-target messages into multiple_targets bucket", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 4,
      date_unixtime: "1700000000",
      from: "alice",
      from_id: "user1",
      text: "@target1 @target2 +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.equal(decision.bucket, "multiple_targets");
  }
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

test("uses message caption when text is empty", () => {
  const decision = parseLegacyExportMessage({
    message: {
      type: "message",
      id: 5,
      date_unixtime: "1700000000",
      from: "alice",
      from_id: "user1",
      text: "",
      caption: "@target +rep",
    },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "import");
  if (decision.kind === "import") {
    assert.equal(decision.candidate.targetUsername, "target");
    assert.equal(decision.candidate.result, "positive");
  }
});

// Patterns that include a `(?<!not\s)` lookbehind — these MUST skip
// when prefixed with "not". Existing keyword-vouch markers all do.
const negationTestablePositiveSamples = [
  { name: "pos vouch", text: "@target pos vouch" },
  { name: "huge vouch", text: "@target huge vouch from me" },
  { name: "big vouch", text: "@target big vouch" },
  { name: "mad vouch", text: "@target mad vouch" },
  { name: "high vouch", text: "@target high vouch" },
  { name: "highly vouch", text: "@target highly vouch" },
  { name: "solid vouch", text: "@target solid vouch" },
  { name: "positive vouch", text: "Positive vouch @target, easy interactions" },
  { name: "massive vouch", text: "@target massive vouch from me, A1" },
  { name: "heavy vouch", text: "heavy POS vouch @target" },
];

// Phrasal patterns where "not X" doesn't naturally negate the
// sentiment — testing only the positive-shape match.
const positiveOnlySamples = [
  { name: "poss vouch typo", text: "@target poss vouch" },
  { name: "pov vouch typo", text: "Pov vouch @target solid lad" },
  { name: "vouch the bro", text: "Vouch the bro @target nice stuff bro" },
  { name: "easy to deal with", text: "@target easy to deal with, would deal again" },
  { name: "would deal again", text: "@target would deal with again" },
  { name: "no drama", text: "@target sorted me out no drama" },
  { name: "easy comms", text: "@target easy comms, smooth transaction" },
  { name: "smashed it", text: "@target smashed it, top job" },
  { name: "came through", text: "@target came through quick" },
  { name: "top bloke", text: "@target top bloke, recommend" },
  { name: "solid bloke", text: "@target seems like solid bloke" },
  { name: "good bloke", text: "@target good bloke" },
  { name: "nice bloke", text: "@target was the nicest bloke" },
  { name: "proper bloke", text: "Proper bloke @target enjoy" },
  { name: "champion", text: "@target champ, sorted me right" },
  { name: "legend", text: "@target absolute legend" },
  { name: "smooth transaction", text: "@target smooth transaction, A1" },
  { name: "straight to the point", text: "@target straight to the point, ideal" },
  { name: "paid upfront", text: "@target paid upfront, prompt" },
  { name: "on time", text: "@target was respectful and on time" },
  { name: "certi", text: "@target always certi" },
  { name: "10/10", text: "@target 10/10 service" },
  { name: "a1 biz", text: "@target A1 biz" },
  { name: "5 stars", text: "@target 5 stars all round" },
  { name: "all good", text: "@target all good bro" },
  { name: "hooked up", text: "@target hooked me up nicely" },
  { name: "great bro", text: "@target great cunt sorted me" },
  { name: "fire emoji", text: "@target 🔥🔥🔥" },
  { name: "100 emoji", text: "@target 💯💯" },
];

for (const sample of [...negationTestablePositiveSamples, ...positiveOnlySamples]) {
  test(`classifies ${sample.name} as positive`, () => {
    const decision = parseLegacyExportMessage({
      message: { type: "message", id: 100, date_unixtime: "1700000000", from: "alice", from_id: "user1", text: sample.text },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "import", `failed for: ${sample.text}`);
    if (decision.kind === "import") {
      assert.equal(decision.candidate.result, "positive");
    }
  });
}

for (const sample of negationTestablePositiveSamples) {
  test(`negated ${sample.name} skips`, () => {
    const decision = parseLegacyExportMessage({
      message: { type: "message", id: 101, date_unixtime: "1700000000", from: "alice", from_id: "user1", text: `@target not ${sample.name}` },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "skip");
    if (decision.kind === "skip") {
      assert.equal(decision.reviewItem.reason, "unclear_sentiment");
    }
  });
}

const negativeSamples = [
  { name: "neg vouch", text: "@target neg vouch" },
  { name: "scam", text: "@target is a scam" },
  { name: "scammer", text: "@target scammer" },
  { name: "scammed", text: "@target scammed me" },
  { name: "ripped", text: "@target ripped me off" },
  { name: "dodgy", text: "@target dodgy" },
  { name: "sketchy", text: "@target sketchy" },
  { name: "shady", text: "@target shady" },
  { name: "ghost", text: "@target ghost on payment" },
  { name: "ghosted", text: "@target ghosted me" },
  { name: "steer clear", text: "@target steer clear" },
  { name: "dont trust", text: "@target dont trust him" },
  { name: "don't trust", text: "@target don't trust him" },
  // ---- Expanded ----
  { name: "negative vouch", text: "@target negative vouch" },
  { name: "warned of", text: "Members warned of @target" },
  { name: "owes me money", text: "@target owes me money since June" },
  { name: "took my money", text: "@target took my money never delivered" },
  { name: "ripped me off", text: "yo gng @target ripped me off" },
  { name: "never sent", text: "@target never sent the goods" },
  { name: "blocked me", text: "@target blocked me after payment" },
  { name: "dont deal with", text: "@target don't deal with this guy" },
  { name: "fraud", text: "@target is a fraudster" },
  { name: "MIA", text: "@target MIA after taking deposit" },
];

for (const sample of negativeSamples) {
  test(`classifies ${sample.name} as negative`, () => {
    const decision = parseLegacyExportMessage({
      message: { type: "message", id: 200, date_unixtime: "1700000000", from: "alice", from_id: "user1", text: sample.text },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "import");
    if (decision.kind === "import") {
      assert.equal(decision.candidate.result, "negative");
    }
  });
}

// Query-shape detector: messages that ASK for a vouch instead of GIVING
// one must skip even if they accidentally trip a positive keyword.
const querySamples = [
  "anyone vouch @target",
  "any vouches? @target",
  "any vouches @target",
  "Any vouches for @target",
  "Can anyone vouch for @target",
  "Can any1 vouch @target ?",
  "Can someone vouch @target",
  "Can you vouch @target",
  "Can u vouch @target",
  "@target any vouches?",
  "@target vouches?",
  "is @target vouched",
  "@target can you vouch me g",
  "got any vouches for @target?",
  "Who can vouch for @target",
];
for (const text of querySamples) {
  test(`query "${text}" → skip (not a vouch)`, () => {
    const decision = parseLegacyExportMessage({
      message: { type: "message", id: 300, date_unixtime: "1700000000", from: "alice", from_id: "user1", text },
      sourceChatId: -1001234567890,
    });
    assert.equal(decision.kind, "skip", `expected skip for: ${text}`);
  });
}

test("bare @mention with no body skips (mention only, not a vouch)", () => {
  const decision = parseLegacyExportMessage({
    message: { type: "message", id: 301, date_unixtime: "1700000000", from: "alice", from_id: "user1", text: "@target" },
    sourceChatId: -1001234567890,
  });
  assert.equal(decision.kind, "skip");
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
  if (decision.kind === "import") {
    assert.equal(decision.candidate.reviewerUsername, "rixx_aus");
    assert.equal(decision.candidate.targetUsername, "mordecai_on");
    assert.equal(decision.candidate.result, "positive");
    assert.equal(
      decision.candidate.originalTimestamp.toISOString().slice(0, 10),
      "2026-04-05",
    );
  }
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
  if (decision.kind === "import") {
    assert.equal(decision.candidate.reviewerUsername, "legacy_8448430705");
    assert.equal(decision.candidate.targetUsername, "cool_ridge");
  }
});
