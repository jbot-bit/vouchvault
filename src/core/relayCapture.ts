// Channel-relay capture path (V3.5.4, v6 §4.1). When the channel-pair
// is enabled, Telegram auto-forwards channel posts into the supergroup's
// General topic. The ingest bot's webhook (privacy mode OFF) sees the
// auto-forwarded message and matches it to the pending DB row by
// `forward_from_message_id` to populate `supergroup_message_id`.
//
// Pure helpers — no DB or Telegram-tools imports — so the matching
// logic is unit-test safe without DATABASE_URL.

export type CaptureMatch =
  | {
      matched: true;
      channelId: number;
      channelMessageId: number;
      supergroupChatId: number;
      supergroupMessageId: number;
    }
  | { matched: false; reason: string };

// Inspect a Telegram Message and decide whether it is a channel-side
// auto-forward into our supergroup that we should match against a
// pending vouch_entries row. Returns a structured match record or a
// reason for rejecting.
export function classifyAutoForward(input: {
  message: any;
  expectedChannelId: number;
  allowedSupergroupIds: ReadonlyArray<number>;
}): CaptureMatch {
  const m = input.message;
  if (m == null || typeof m !== "object") {
    return { matched: false, reason: "no message" };
  }
  if (m.is_automatic_forward !== true) {
    return { matched: false, reason: "not is_automatic_forward" };
  }
  // forward_from_chat is the source channel; forward_from_message_id is
  // the channel-side message id. forward_origin (Bot API 7.0+) carries
  // the same data under a more general schema; tolerate either shape.
  const sourceChatId =
    m.forward_from_chat?.id ??
    m.forward_origin?.chat?.id ??
    null;
  const sourceMessageId =
    m.forward_from_message_id ??
    m.forward_origin?.message_id ??
    null;
  if (typeof sourceChatId !== "number") {
    return { matched: false, reason: "no source chat id" };
  }
  if (typeof sourceMessageId !== "number") {
    return { matched: false, reason: "no source message id" };
  }
  if (sourceChatId !== input.expectedChannelId) {
    return {
      matched: false,
      reason: `source chat ${sourceChatId} != expected ${input.expectedChannelId}`,
    };
  }
  const supergroupChatId = m.chat?.id;
  const supergroupMessageId = m.message_id;
  if (typeof supergroupChatId !== "number") {
    return { matched: false, reason: "no destination chat id" };
  }
  if (typeof supergroupMessageId !== "number") {
    return { matched: false, reason: "no destination message id" };
  }
  if (!input.allowedSupergroupIds.includes(supergroupChatId)) {
    return {
      matched: false,
      reason: `destination ${supergroupChatId} not in allowlist`,
    };
  }
  return {
    matched: true,
    channelId: sourceChatId,
    channelMessageId: sourceMessageId,
    supergroupChatId,
    supergroupMessageId,
  };
}
