import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_SUPPRESSION_MS,
  buildVelocityAlertText,
  classifyChatMemberTransition,
  createMemberVelocityState,
  JOIN_THRESHOLD,
  LEAVE_THRESHOLD,
  recordMemberEvent,
  VELOCITY_WINDOW_MS,
} from "./memberVelocity.ts";

test("classifyChatMemberTransition treats kicked/left → member-like as a join", () => {
  for (const old of ["left", "kicked"]) {
    for (const next of ["member", "restricted", "administrator", "creator"]) {
      assert.equal(classifyChatMemberTransition(old, next), "join", `${old} -> ${next}`);
    }
  }
});

test("classifyChatMemberTransition treats member-like → kicked/left as a leave", () => {
  for (const old of ["member", "restricted", "administrator", "creator"]) {
    for (const next of ["left", "kicked"]) {
      assert.equal(classifyChatMemberTransition(old, next), "leave", `${old} -> ${next}`);
    }
  }
});

test("classifyChatMemberTransition ignores promotion/demotion/restriction changes", () => {
  for (const [old, next] of [
    ["member", "administrator"],
    ["administrator", "member"],
    ["member", "restricted"],
    ["restricted", "member"],
    ["administrator", "creator"],
  ]) {
    assert.equal(classifyChatMemberTransition(old, next), "ignore", `${old} -> ${next}`);
  }
});

test("classifyChatMemberTransition returns ignore for missing fields", () => {
  assert.equal(classifyChatMemberTransition(undefined, "member"), "ignore");
  assert.equal(classifyChatMemberTransition("member", undefined), "ignore");
  assert.equal(classifyChatMemberTransition(null, null), "ignore");
});

test("recordMemberEvent fires an alert exactly when joins cross the threshold", () => {
  const state = createMemberVelocityState();
  const baseTs = 1_000_000;
  for (let i = 0; i < JOIN_THRESHOLD - 1; i += 1) {
    const alert = recordMemberEvent(state, {
      chatId: -1001,
      kind: "join",
      nowMs: baseTs + i,
    });
    assert.equal(alert, null, `event #${i + 1} should not alert`);
  }

  const alert = recordMemberEvent(state, {
    chatId: -1001,
    kind: "join",
    nowMs: baseTs + JOIN_THRESHOLD,
  });
  assert.ok(alert, "threshold event should alert");
  assert.equal(alert?.chatId, -1001);
  assert.equal(alert?.kind, "join");
  assert.equal(alert?.count, JOIN_THRESHOLD);
});

test("recordMemberEvent suppresses re-alerts for ALERT_SUPPRESSION_MS, then re-fires", () => {
  const state = createMemberVelocityState();
  const baseTs = 1_000_000;
  let alert = null;
  for (let i = 0; i < JOIN_THRESHOLD; i += 1) {
    alert = recordMemberEvent(state, {
      chatId: -1001,
      kind: "join",
      nowMs: baseTs + i,
    });
  }
  assert.ok(alert, "first alert should fire");

  const reAttempt = recordMemberEvent(state, {
    chatId: -1001,
    kind: "join",
    nowMs: baseTs + JOIN_THRESHOLD + 5,
  });
  assert.equal(reAttempt, null);

  const recoveryTs = baseTs + ALERT_SUPPRESSION_MS + 1;
  let recovered: ReturnType<typeof recordMemberEvent> = null;
  for (let i = 0; i < JOIN_THRESHOLD; i += 1) {
    const next = recordMemberEvent(state, {
      chatId: -1001,
      kind: "join",
      nowMs: recoveryTs + i,
    });
    if (next) recovered = next;
  }
  assert.ok(recovered, "alert should re-fire after suppression expires");
});

test("recordMemberEvent counts joins and leaves separately, with their own thresholds", () => {
  const state = createMemberVelocityState();
  const baseTs = 1_000_000;

  let leaveAlert = null;
  for (let i = 0; i < LEAVE_THRESHOLD; i += 1) {
    leaveAlert = recordMemberEvent(state, {
      chatId: -1001,
      kind: "leave",
      nowMs: baseTs + i,
    });
  }
  assert.ok(leaveAlert, "leave threshold should fire");
  assert.equal(leaveAlert?.kind, "leave");

  for (let i = 0; i < JOIN_THRESHOLD - 1; i += 1) {
    const joinAlert = recordMemberEvent(state, {
      chatId: -1001,
      kind: "join",
      nowMs: baseTs + 100 + i,
    });
    assert.equal(joinAlert, null, `join #${i + 1} (under threshold) should not alert`);
  }
});

test("recordMemberEvent prunes events older than the velocity window", () => {
  const state = createMemberVelocityState();
  const ancient = 1_000_000;
  for (let i = 0; i < JOIN_THRESHOLD - 1; i += 1) {
    recordMemberEvent(state, { chatId: -1001, kind: "join", nowMs: ancient + i });
  }

  const fresh = ancient + VELOCITY_WINDOW_MS + 1;
  const alert = recordMemberEvent(state, { chatId: -1001, kind: "join", nowMs: fresh });
  assert.equal(alert, null);
});

test("recordMemberEvent isolates state per (chatId, kind)", () => {
  const state = createMemberVelocityState();
  const baseTs = 1_000_000;

  for (let i = 0; i < JOIN_THRESHOLD - 1; i += 1) {
    recordMemberEvent(state, { chatId: -1001, kind: "join", nowMs: baseTs + i });
  }
  const otherChat = recordMemberEvent(state, {
    chatId: -1002,
    kind: "join",
    nowMs: baseTs + 50,
  });
  assert.equal(otherChat, null);
});

test("buildVelocityAlertText renders chatId, count, and minutes", () => {
  const text = buildVelocityAlertText({
    chatId: -1001234567890,
    kind: "join",
    count: 7,
    windowMs: VELOCITY_WINDOW_MS,
  });

  assert.match(text, /Member-velocity alert/);
  assert.match(text, /<code>-1001234567890<\/code>/);
  assert.match(text, /7 joins/);
  assert.match(text, /60 min/);
  assert.match(text, /docs\/runbook\/opsec\.md/);
});

test("buildVelocityAlertText distinguishes leaves", () => {
  const text = buildVelocityAlertText({
    chatId: -1001,
    kind: "leave",
    count: 3,
    windowMs: VELOCITY_WINDOW_MS,
  });
  assert.match(text, /3 leaves/);
});
