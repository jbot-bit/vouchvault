const DEFAULT_BOT_SENDERS = ["combot", "grouphelpbot", "groupanonymousbot"];

export function getLegacyBotSenders(): Set<string> {
  const raw = process.env.LEGACY_BOT_SENDERS?.trim();
  const list = raw
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_BOT_SENDERS;
  return new Set(list);
}
