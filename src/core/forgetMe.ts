// Data-deletion path. DM /forgetme triggers a two-step confirmation flow;
// reply YES within FORGET_CONFIRM_TTL_MS to execute the delete. State is
// in-memory + process-local — sufficient for single-replica deploys.
//
// Honours the user-facing /forgetme pointer in the welcome / pinned guide
// (added in the ToS-hardening pass). Closes one of the compliance gaps
// flagged in docs/research/telegram-official-implications.md.

export const FORGET_CONFIRM_TTL_MS = 5 * 60 * 1000;

export function buildForgetPromptText(): string {
  return [
    "<b>Forget me — confirm</b>",
    "",
    "This will permanently delete:",
    "• every vouch <b>you authored</b>,",
    "• your draft state, first-seen record, and stored profile.",
    "",
    "Vouches other members wrote <b>about</b> you stay — they're those members' words, not your data, and removing them would let bad actors wipe negative feedback about themselves.",
    "",
    "This cannot be undone. Reply <code>YES</code> within 5 minutes to confirm.",
  ].join("\n");
}

export function buildForgetCancelledText(): string {
  return "Cancelled. Your data is unchanged.";
}

export function buildForgetDoneText(deletedCount: number): string {
  const noun = deletedCount === 1 ? "row" : "rows";
  return `Done — deleted ${deletedCount} ${noun} tied to your account. If anyone vouches you again later, /forgetme again.`;
}

export function buildForgetExpiredText(): string {
  return "Confirmation window expired. DM /forgetme again to start over.";
}

export function buildForgetGroupRedirectText(): string {
  return "DM me to use /forgetme — this command only works in direct messages.";
}

export type ForgetState = {
  pendingByUser: Map<number, number>; // userId → expiresAt (ms)
};

export function createForgetState(): ForgetState {
  return { pendingByUser: new Map() };
}

export type ForgetStep =
  | { kind: "prompt" } // first /forgetme — store pending, show prompt
  | { kind: "execute" } // YES within window — run delete
  | { kind: "expired" } // YES after window
  | { kind: "ignore" }; // YES with no pending state

// First /forgetme call: register pending and return "prompt".
export function beginForget(
  state: ForgetState,
  userId: number,
  now: number = Date.now(),
): ForgetStep {
  state.pendingByUser.set(userId, now + FORGET_CONFIRM_TTL_MS);
  return { kind: "prompt" };
}

// User replies (anything). Returns execute / expired / ignore.
export function tryConfirmForget(
  state: ForgetState,
  userId: number,
  reply: string,
  now: number = Date.now(),
): ForgetStep {
  const expiresAt = state.pendingByUser.get(userId);
  if (expiresAt == null) return { kind: "ignore" };
  if (reply.trim().toUpperCase() !== "YES") return { kind: "ignore" };
  state.pendingByUser.delete(userId);
  if (now > expiresAt) return { kind: "expired" };
  return { kind: "execute" };
}

export function clearForget(state: ForgetState, userId: number): void {
  state.pendingByUser.delete(userId);
}

// DB execute. Deletes vouch_entries (where the user is reviewer or target),
// vouch_drafts, users_first_seen, users — in that order so FK constraints
// don't fire. Audit-logged. Returns total rows deleted.
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
