// Inline-cards phase 1: forgery enforcement orchestrator.
//
// Receives a verdict from forgeryDetector and:
//   1. Deletes the offending message (best-effort).
//   2. Records a forgery_strikes row (deleted flag reflects step 1).
//   3. DM-warns the offender (best-effort; swallow blocked-by-user).
//   4. Audit-logs via recordAdminAction.
//   5. If recent-strike count >= FORGERY_FREEZE_THRESHOLD within
//      FORGERY_FREEZE_WINDOW_HOURS, escalates to a freeze action
//      (idempotent — caller's freeze pathway is no-op when the user
//      is already frozen).
//
// Dependency-injected so unit tests can stub Telegram + DB. Burst
// dedup via an in-memory LRU keyed on (chat_id, message_id, kind)
// so a stream of edited_message events from the same edit doesn't
// create N strikes.
//
// See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md
// and docs/superpowers/plans/2026-05-01-inline-vouch-cards.md (Phase 1).

import type { ForgeryVerdict } from "./forgeryDetector.ts";

export const DEFAULT_FREEZE_THRESHOLD = 3;
export const DEFAULT_FREEZE_WINDOW_HOURS = 168; // 7 days

export type EnforcementDeps = {
  deleteMessage: (input: {
    chatId: number;
    messageId: number;
  }) => Promise<{ deleted: boolean }>;
  dmUser: (input: { userId: number; text: string }) => Promise<void>;
  recordStrike: (input: {
    userId: number;
    chatId: number;
    messageId: number;
    kind: ForgeryVerdict["kind"];
    contentHash: string;
    deleted: boolean;
  }) => Promise<{ id: number }>;
  countRecentStrikes: (input: {
    userId: number;
    withinHours: number;
  }) => Promise<number>;
  audit: (input: {
    userId: number;
    chatId: number;
    kind: ForgeryVerdict["kind"];
    contentHash: string;
    deleted: boolean;
    escalatedToFreeze: boolean;
  }) => Promise<void>;
  freezeUser: (input: {
    userId: number;
    reason: string;
  }) => Promise<{ frozen: boolean }>;
  logger?: { warn?: (ctx: any, msg: string) => void; info?: (ctx: any, msg: string) => void };
};

export type EnforcementConfig = {
  freezeThreshold?: number;
  freezeWindowHours?: number;
};

const DEDUP_LRU_CAP = 256;
const DEDUP_TTL_MS = 60_000;

type DedupKey = string;
const dedupSeen = new Map<DedupKey, number>();

function dedupKey(chatId: number, messageId: number, kind: string): DedupKey {
  return `${chatId}:${messageId}:${kind}`;
}

function recentlyEnforced(key: DedupKey, now: number): boolean {
  const seenAt = dedupSeen.get(key);
  if (seenAt == null) return false;
  if (now - seenAt > DEDUP_TTL_MS) {
    dedupSeen.delete(key);
    return false;
  }
  return true;
}

function markEnforced(key: DedupKey, now: number): void {
  if (dedupSeen.size >= DEDUP_LRU_CAP) {
    const firstKey = dedupSeen.keys().next().value;
    if (firstKey !== undefined) dedupSeen.delete(firstKey);
  }
  dedupSeen.set(key, now);
}

export function _resetDedupCacheForTests(): void {
  dedupSeen.clear();
}

export function buildWarnText(kind: ForgeryVerdict["kind"]): string {
  if (kind === "edit_of_real_card") {
    return (
      "That vouch card was edited and removed. Vouch cards from " +
      "@VouchVaultBot must not be edited — content stays as inserted. " +
      "Repeat edits will result in a freeze."
    );
  }
  if (kind === "lookalike_bot") {
    return (
      "That message was a vouch card relayed via a different bot and " +
      "was removed. Real cards come via @VouchVaultBot only."
    );
  }
  return (
    "That message looked like a forged vouch card and was removed. " +
    "Real cards come from @VouchVaultBot inline mode (you'll see " +
    "'via @VouchVaultBot' under the sender). Repeat forgeries will " +
    "result in a freeze."
  );
}

export type EnforceResult = {
  deduped: boolean;
  deleted: boolean;
  strikeId?: number;
  recentStrikeCount?: number;
  escalatedToFreeze: boolean;
};

export async function enforceForgery(
  deps: EnforcementDeps,
  input: {
    chatId: number;
    messageId: number;
    userId: number;
    verdict: ForgeryVerdict;
    nowMs?: number;
    config?: EnforcementConfig;
  },
): Promise<EnforceResult> {
  const now = input.nowMs ?? Date.now();
  const key = dedupKey(input.chatId, input.messageId, input.verdict.kind);
  if (recentlyEnforced(key, now)) {
    return { deduped: true, deleted: false, escalatedToFreeze: false };
  }
  markEnforced(key, now);

  const threshold = input.config?.freezeThreshold ?? DEFAULT_FREEZE_THRESHOLD;
  const windowHours = input.config?.freezeWindowHours ?? DEFAULT_FREEZE_WINDOW_HOURS;

  // (1) Delete the offending message.
  let deleted = false;
  try {
    const r = await deps.deleteMessage({
      chatId: input.chatId,
      messageId: input.messageId,
    });
    deleted = r.deleted;
  } catch (error) {
    deps.logger?.warn?.(
      { chatId: input.chatId, messageId: input.messageId, error },
      "[forgery] delete failed (non-fatal)",
    );
  }

  // (2) Record the strike.
  const strike = await deps.recordStrike({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.messageId,
    kind: input.verdict.kind,
    contentHash: input.verdict.contentHash,
    deleted,
  });

  // (3) DM warn the offender (best-effort).
  try {
    await deps.dmUser({
      userId: input.userId,
      text: buildWarnText(input.verdict.kind),
    });
  } catch (error) {
    deps.logger?.warn?.(
      { userId: input.userId, error },
      "[forgery] DM warn failed (non-fatal)",
    );
  }

  // (4) Recent strike count + (5) freeze escalation.
  const recentStrikeCount = await deps.countRecentStrikes({
    userId: input.userId,
    withinHours: windowHours,
  });

  let escalatedToFreeze = false;
  if (recentStrikeCount >= threshold) {
    try {
      const r = await deps.freezeUser({
        userId: input.userId,
        reason: "forgery",
      });
      escalatedToFreeze = r.frozen;
    } catch (error) {
      deps.logger?.warn?.(
        { userId: input.userId, error },
        "[forgery] freeze escalation failed",
      );
    }
  }

  await deps.audit({
    userId: input.userId,
    chatId: input.chatId,
    kind: input.verdict.kind,
    contentHash: input.verdict.contentHash,
    deleted,
    escalatedToFreeze,
  });

  deps.logger?.info?.(
    {
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.messageId,
      kind: input.verdict.kind,
      deleted,
      recentStrikeCount,
      escalatedToFreeze,
    },
    "[forgery] enforced",
  );

  return {
    deduped: false,
    deleted,
    strikeId: strike.id,
    recentStrikeCount,
    escalatedToFreeze,
  };
}
