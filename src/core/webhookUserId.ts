// Pure helper for the v6 account-age guard wiring (V3.5.3, KB:F5.6).
//
// Extracts the originating user's telegram_id from any Telegram Update
// payload shape. Used by processTelegramUpdate to record a first-seen
// timestamp for every observed user_id, which the wizard then reads
// at start to gate <24h accounts.
//
// No DB or Telegram-tools imports — safe to load in test contexts.

export type TelegramUpdate = {
  message?: { from?: { id?: unknown } | null } | null;
  edited_message?: { from?: { id?: unknown } | null } | null;
  channel_post?: { from?: { id?: unknown } | null } | null;
  callback_query?: { from?: { id?: unknown } | null } | null;
  my_chat_member?: { from?: { id?: unknown } | null } | null;
  chat_member?: { from?: { id?: unknown } | null } | null;
  inline_query?: { from?: { id?: unknown } | null } | null;
  chosen_inline_result?: { from?: { id?: unknown } | null } | null;
  shipping_query?: { from?: { id?: unknown } | null } | null;
  pre_checkout_query?: { from?: { id?: unknown } | null } | null;
};

// Returns the telegram_id of the originating user for any update kind
// we care about, or null if the update has no user (e.g. channel_post
// without a from). Skips bot-side updates.
export function extractUpdateUserId(payload: TelegramUpdate | null | undefined): number | null {
  if (payload == null) return null;
  // Order matters when the platform someday delivers update kinds we
  // don't currently handle: pick the first kind whose envelope has a
  // user_id and return it. We don't try to combine multiple kinds.
  const candidates: Array<{ from?: { id?: unknown } | null } | null | undefined> = [
    payload.message,
    payload.edited_message,
    payload.callback_query,
    payload.my_chat_member,
    payload.chat_member,
    payload.inline_query,
    payload.chosen_inline_result,
    payload.shipping_query,
    payload.pre_checkout_query,
    // channel_post.from is the channel itself — not a user — but for
    // completeness we still include it; the type guard below rejects
    // non-positive ids.
    payload.channel_post,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const id = c.from?.id;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
      return id;
    }
  }
  return null;
}
