// Data-deletion path. DM /forgetme triggers a TWO-STAGE confirmation flow:
//   Stage 1 — user replies YES (typed) within FORGET_CONFIRM_TTL_MS.
//   Stage 2 — user taps the inline-keyboard ✅ Confirm button within
//             FORGET_FINAL_TTL_MS of the YES.
// Two stages because deletion is irreversible — typing YES is friction
// against muscle-memory tap-throughs, and the button is friction against
// auto-completed YES from previous chats. State is in-memory + process-local;
// sufficient for single-replica deploys.

export const FORGET_CONFIRM_TTL_MS = 5 * 60 * 1000;
export const FORGET_FINAL_TTL_MS = 5 * 60 * 1000;

export function buildForgetPromptText(): string {
  return [
    "Wipes every vouch you wrote and your account. Vouches others wrote about you stay.",
    "",
    "Reply <code>YES</code> within 5 min.",
  ].join("\n");
}

export function buildForgetFinalConfirmText(): string {
  return "Last chance. Tap Confirm.";
}

export function buildForgetFinalConfirmMarkup(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: "fg:y" },
        { text: "Cancel", callback_data: "fg:n" },
      ],
    ],
  };
}

export function buildForgetCancelledText(): string {
  return "Cancelled.";
}

export function buildForgetDoneText(deletedCount: number): string {
  const noun = deletedCount === 1 ? "row" : "rows";
  return `Wiped ${deletedCount} ${noun}.`;
}

export function buildForgetExpiredText(): string {
  return "Expired. /forgetme to start over.";
}

export function buildForgetGroupRedirectText(): string {
  return "DM me to use /forgetme.";
}

export type ForgetStage = "awaitingYes" | "awaitingFinal";

export type ForgetState = {
  pendingByUser: Map<number, { stage: ForgetStage; expiresAt: number }>;
};

export function createForgetState(): ForgetState {
  return { pendingByUser: new Map() };
}

export type ForgetStep =
  | { kind: "prompt" } // /forgetme — store awaitingYes, show prompt
  | { kind: "awaitingFinal" } // YES received — show final tap-confirm
  | { kind: "execute" } // ✅ Confirm tapped within window — run delete
  | { kind: "expired" } // YES or tap after window
  | { kind: "ignore" }; // YES with no pending state, or wrong stage

// First /forgetme call: register awaitingYes and return "prompt".
export function beginForget(
  state: ForgetState,
  userId: number,
  now: number = Date.now(),
): ForgetStep {
  state.pendingByUser.set(userId, {
    stage: "awaitingYes",
    expiresAt: now + FORGET_CONFIRM_TTL_MS,
  });
  return { kind: "prompt" };
}

// User typed text reply. Returns awaitingFinal / expired / ignore.
// (Does NOT execute — execution requires the button tap in stage 2.)
export function tryConfirmForget(
  state: ForgetState,
  userId: number,
  reply: string,
  now: number = Date.now(),
): ForgetStep {
  const pending = state.pendingByUser.get(userId);
  if (pending == null) return { kind: "ignore" };
  if (pending.stage !== "awaitingYes") return { kind: "ignore" };
  if (reply.trim().toUpperCase() !== "YES") return { kind: "ignore" };
  if (now > pending.expiresAt) {
    state.pendingByUser.delete(userId);
    return { kind: "expired" };
  }
  // Advance to stage 2 with a fresh TTL.
  state.pendingByUser.set(userId, {
    stage: "awaitingFinal",
    expiresAt: now + FORGET_FINAL_TTL_MS,
  });
  return { kind: "awaitingFinal" };
}

// User tapped ✅ Confirm. Returns execute / expired / ignore.
export function tryFinalizeForget(
  state: ForgetState,
  userId: number,
  now: number = Date.now(),
): ForgetStep {
  const pending = state.pendingByUser.get(userId);
  if (pending == null) return { kind: "ignore" };
  if (pending.stage !== "awaitingFinal") return { kind: "ignore" };
  state.pendingByUser.delete(userId);
  if (now > pending.expiresAt) return { kind: "expired" };
  return { kind: "execute" };
}

export function clearForget(state: ForgetState, userId: number): void {
  state.pendingByUser.delete(userId);
}

// DB execute. Deletes vouch_entries the user authored, vouch_drafts,
// users_first_seen, users — in that order so FK constraints don't fire.
// Audit-logged. Returns total rows deleted.
export type ForgetDeps = {
  deleteVouchEntries: (input: { userId: number; username: string | null }) => Promise<number>;
  deleteVouchDrafts: (userId: number) => Promise<number>;
  deleteUsersFirstSeen: (userId: number) => Promise<number>;
  deleteUsers: (userId: number) => Promise<number>;
  audit: (input: { userId: number; username: string | null }) => Promise<void>;
};

export async function executeForget(
  input: { userId: number; username: string | null },
  deps: ForgetDeps,
): Promise<number> {
  const entries = await deps.deleteVouchEntries(input);
  const drafts = await deps.deleteVouchDrafts(input.userId);
  const seen = await deps.deleteUsersFirstSeen(input.userId);
  const u = await deps.deleteUsers(input.userId);
  await deps.audit(input);
  return entries + drafts + seen + u;
}

// DB-backed deps live in forgetMeStore.ts so this module can be unit-tested
// without DATABASE_URL — mirrors the mirrorPublish ↔ mirrorStore split.

export const memberForgetState: ForgetState = createForgetState();
