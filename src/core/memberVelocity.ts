// In-process rolling-window counter for chat_member transitions, per
// takedown-resilience spec §3.4. State is intentionally in-memory and
// resets on deploy — the alert is a heuristic and a fresh window after
// deploy is acceptable. No DB.

export type MemberEventKind = "join" | "leave";

export const VELOCITY_WINDOW_MS = 60 * 60 * 1000;
export const JOIN_THRESHOLD = 5;
export const LEAVE_THRESHOLD = 3;
export const ALERT_SUPPRESSION_MS = 60 * 60 * 1000;

export type MemberVelocityState = {
  events: Map<string, number[]>;
  nextAlertAfter: Map<string, number>;
};

export function createMemberVelocityState(): MemberVelocityState {
  return { events: new Map(), nextAlertAfter: new Map() };
}

export type ChatMemberTransition = "join" | "leave" | "ignore";

const MEMBER_LIKE = new Set(["member", "restricted", "administrator", "creator"]);
const GONE_LIKE = new Set(["left", "kicked"]);

// Classifies an `old.status -> new.status` transition reported by Telegram's
// `chat_member` update. Promotion / demotion / restriction-only changes
// (e.g. member -> administrator) are intentionally ignored — those are not
// brigading signals.
export function classifyChatMemberTransition(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): ChatMemberTransition {
  if (!oldStatus || !newStatus) return "ignore";
  if (GONE_LIKE.has(oldStatus) && MEMBER_LIKE.has(newStatus)) return "join";
  if (MEMBER_LIKE.has(oldStatus) && GONE_LIKE.has(newStatus)) return "leave";
  return "ignore";
}

export type VelocityAlert = {
  chatId: number;
  kind: MemberEventKind;
  count: number;
  windowMs: number;
};

function thresholdFor(kind: MemberEventKind): number {
  return kind === "join" ? JOIN_THRESHOLD : LEAVE_THRESHOLD;
}

function keyOf(chatId: number, kind: MemberEventKind): string {
  return `${chatId}:${kind}`;
}

// Records a single member event and returns an alert iff the threshold has
// been crossed and we're not inside a suppression window. Pruning of stale
// timestamps happens on every push so the in-memory map can't grow without
// bound for a chronically active chat.
export function recordMemberEvent(
  state: MemberVelocityState,
  input: { chatId: number; kind: MemberEventKind; nowMs: number },
): VelocityAlert | null {
  const key = keyOf(input.chatId, input.kind);
  const cutoff = input.nowMs - VELOCITY_WINDOW_MS;

  const previous = state.events.get(key) ?? [];
  const fresh = previous.filter((ts) => ts > cutoff);
  fresh.push(input.nowMs);
  state.events.set(key, fresh);

  const suppressedUntil = state.nextAlertAfter.get(key) ?? 0;
  if (input.nowMs < suppressedUntil) {
    return null;
  }

  if (fresh.length < thresholdFor(input.kind)) {
    return null;
  }

  state.nextAlertAfter.set(key, input.nowMs + ALERT_SUPPRESSION_MS);
  return {
    chatId: input.chatId,
    kind: input.kind,
    count: fresh.length,
    windowMs: VELOCITY_WINDOW_MS,
  };
}

export function buildVelocityAlertText(alert: VelocityAlert): string {
  const minutes = Math.round(alert.windowMs / 60_000);
  const counter = alert.kind === "join" ? `${alert.count} joins` : `${alert.count} leaves`;
  return (
    `Member-velocity alert in <code>${alert.chatId}</code>: ${counter} ` +
    `in last ${minutes} min. Possible brigading. ` +
    `See <code>docs/runbook/opsec.md</code>.`
  );
}
