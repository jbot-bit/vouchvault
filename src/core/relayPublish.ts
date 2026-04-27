// Channel-relay publish path (V3.5.4, v6 §4.1). When VV_RELAY_ENABLED
// is true, the ingest bot publishes to the paired channel; Telegram's
// channel-discussion link auto-forwards into the supergroup's General
// topic. This module owns the pure render of the channel post body and
// the typed result shape; callers wire in the actual sendMessage call.
//
// Pure helpers — no DB or Telegram-tools imports — so this is unit-test
// safe without DATABASE_URL.

export const ENTRY_FOOTER_PREFIX = "<code>#";
export const ENTRY_FOOTER_SUFFIX = "</code>";

// Build the prose+id channel post body. Reviewer-supplied prose is
// passed in already HTML-escaped by the wizard. The footer is the only
// structured token in the published post; structured fields (target,
// tags, result) live only in DB and surface only via /search.
export function buildChannelPostBody(input: {
  proseEscaped: string;
  entryId: number;
}): string {
  return `${input.proseEscaped}\n\n${ENTRY_FOOTER_PREFIX}${input.entryId}${ENTRY_FOOTER_SUFFIX}`;
}

// Telegram channel-post URLs are of the form t.me/c/<numericChannelId>/<msgId>
// for private channels (the -100 prefix is stripped). For public channels
// the URL form is t.me/<username>/<msgId>; we don't currently store the
// channel @username, so private-channel form is the canonical output here.
export function buildChannelPostUrl(
  channelId: number,
  channelMessageId: number,
): string {
  // Private channel ids are negative and start with -100 by convention.
  // Strip the -100 prefix to get the t.me/c/<id> form.
  const prefix = -1_000_000_000_000; // -1e12
  const numeric =
    channelId < 0 && String(channelId).startsWith("-100")
      ? Math.abs(channelId - prefix)
      : Math.abs(channelId);
  return `https://t.me/c/${numeric}/${channelMessageId}`;
}

export type RelayPublishResult = {
  channelMessageId: number;
  channelPostUrl: string;
};

// Orchestration. The caller supplies a sender function so this module
// stays free of Telegram-tools imports and can be exercised by unit
// tests with a fake. The sender returns the message_id of the resulting
// channel post.
export async function publishToChannelAndCapture(input: {
  channelId: number;
  proseEscaped: string;
  entryId: number;
  sender: (chatId: number, body: string) => Promise<{ message_id: number }>;
}): Promise<RelayPublishResult> {
  const body = buildChannelPostBody({
    proseEscaped: input.proseEscaped,
    entryId: input.entryId,
  });
  const sent = await input.sender(input.channelId, body);
  const channelMessageId = sent.message_id;
  return {
    channelMessageId,
    channelPostUrl: buildChannelPostUrl(input.channelId, channelMessageId),
  };
}
