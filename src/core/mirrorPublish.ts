// v9 phase 1: backup-channel mirror via forwardMessage.
//
// Every member-posted message in an allowed vouch group is forwarded
// into the configured backup channel (TELEGRAM_CHANNEL_ID) when
// VV_MIRROR_ENABLED=true. The channel becomes a durable replica:
// if the group is taken down, the channel survives with attribution
// preserved (forward_origin), and the v6 replay:to-telegram tool can
// forward the channel back into a recovery group.
//
// On-the-wire shape: forwardMessage produces "forwarded from <member>"
// at the destination — different fingerprint than sendMessage (KB:F2.5).
//
// Idempotency: mirror_log uniquely keys on (group_chat_id, group_message_id);
// a webhook retry won't produce a duplicate forward.
//
// Policy:
// - Skip bot senders and via_bot relays (already excluded by Telegram
//   convention; defence in depth here).
// - Skip messages that runChatModeration deleted (lexicon hits should
//   not land in the archive). Caller passes `moderationDeleted: true`.
// - Best-effort: forward failures log but do not block other handlers.
//
// Pure helpers (no DB / no Telegram imports) so the bulk of the logic
// is unit-testable without DATABASE_URL or a Telegram fake.

export type MirrorMessage = {
  message_id?: number;
  chat?: { id?: number };
  from?: { id?: number; is_bot?: boolean };
  via_bot?: { id?: number } | null;
};

export type ShouldMirrorInput = {
  message: MirrorMessage;
  allowedGroupChatIds: ReadonlyArray<number>;
  moderationDeleted: boolean;
};

// Pure decision: should this message be mirrored to the backup channel?
// Returns false (no mirror) for:
// - Messages whose chat is not in the allowed-groups list
// - Messages from bots or via_bot relays
// - Messages already deleted by chat moderation
// - Messages missing the structural fields needed to forward
export function shouldMirror(input: ShouldMirrorInput): boolean {
  const { message, allowedGroupChatIds, moderationDeleted } = input;
  if (moderationDeleted) return false;
  const chatId = message.chat?.id;
  if (typeof chatId !== "number") return false;
  if (!allowedGroupChatIds.includes(chatId)) return false;
  if (typeof message.message_id !== "number") return false;
  if (message.from?.is_bot) return false;
  if (message.via_bot != null) return false;
  return true;
}

// Resolve mirror config from the environment. Returns null if disabled
// or misconfigured — callers treat null as "feature off, no-op."
export function resolveMirrorConfig(env: NodeJS.ProcessEnv = process.env): {
  channelChatId: number;
} | null {
  if (env.VV_MIRROR_ENABLED !== "true") return null;
  const raw = env.TELEGRAM_CHANNEL_ID?.trim();
  if (!raw) return null;
  if (!/^-100\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id >= 0) return null;
  return { channelChatId: id };
}
