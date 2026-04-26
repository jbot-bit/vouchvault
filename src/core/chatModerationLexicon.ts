// Pure-helper module for chat moderation. No DB imports — safe to load
// in test contexts without DATABASE_URL.
//
// The orchestration (DB queries, Telegram calls) lives in
// `src/core/chatModeration.ts`, which imports from here.

export const STRIKE_DECAY_DAYS = 30;
export const MUTE_DURATION_HOURS = 24;
export const MODERATION_COMMAND = "chat_moderation:delete";

// Empirically derived from four chat exports (~24k messages). Each phrase
// fired dozens of times in the abuse corpus and 0–4 times in the target
// community. Drug names are deliberately excluded — Suncoast V3 uses
// bud / fire / k / mdma / pingas / caps in normal chat. The high-precision
// discriminator is commerce-shape phrasing, not vocabulary.
export const PHRASES: ReadonlyArray<string> = [
  "briar", "buying", "come thru", "dm me", "drop off", "f2f",
  "front", "got some", "got the", "hit me up", "hmu", "holding",
  "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
  "pickup", "pm me", "selling", "session", "signal me", "sold",
  "stocked", "threema", "tic", "tick", "what for", "what u sell",
  "what's the price", "wickr", "wickr me", "wtb", "wts", "wtt",
];

// Format-perfect artefacts. Empirical scan: 0 wallets, 0 emails, ~10 phones,
// 41 off-platform-comm references, 136 t.me invite links across 24k messages.
const REGEX_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "tme_invite",    re: /t\.me\/\+|t\.me\/joinchat|telegram\.me\/\+/i },
  { name: "phone",         re: /\b\+?\d[\d\s\-]{7,}\d\b/ },
  { name: "crypto_wallet", re: /\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b/ },
  { name: "email",         re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
];

const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
  "7": "t", "8": "b", "@": "a", "$": "s",
};

export function normalize(text: string): string {
  let out = text.toLowerCase();
  out = out.split("").map((c) => LEET_MAP[c] ?? c).join("");
  // Pass A: strip a single non-space-punctuation run that sits between
  // two letters. This collapses intra-word evasion like "p.m. me" /
  // "p-m me" → "pm me" without destroying actual word boundaries
  // (spaces are excluded from the run class). Single iteration —
  // catches the typical evader who inserts ONE separator at a time.
  out = out.replace(/([a-z])[^a-z0-9 ]+([a-z])/g, "$1$2");
  // Pass B: any remaining non-alphanumerics (including spaces and
  // anything Pass A didn't strip) become a single space.
  out = out.replace(/[^a-z0-9]+/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export type HitResult =
  | { matched: true; source: string }
  | { matched: false };

const PHRASES_SET: ReadonlySet<string> = new Set(PHRASES.map((p) => p.toLowerCase()));

export function findHits(text: string): HitResult {
  // Phrase pass: normalise + space-padded includes() for word-boundary safety.
  const padded = ` ${normalize(text)} `;
  for (const phrase of PHRASES_SET) {
    if (padded.includes(` ${phrase} `)) {
      return { matched: true, source: "phrase" };
    }
  }
  // Regex pass: original (non-normalised) text — format-perfect.
  for (const { name, re } of REGEX_PATTERNS) {
    if (re.test(text)) {
      return { matched: true, source: `regex_${name}` };
    }
  }
  return { matched: false };
}

export type StrikeAction =
  | { kind: "warn" }
  | { kind: "mute"; durationHours: number }
  | { kind: "ban" };

export function decideStrikeAction(strikeCount: number): StrikeAction {
  if (strikeCount < 1) {
    throw new Error(`decideStrikeAction: invalid strikeCount ${strikeCount}`);
  }
  if (strikeCount === 1) return { kind: "warn" };
  if (strikeCount === 2) return { kind: "mute", durationHours: MUTE_DURATION_HOURS };
  return { kind: "ban" };
}
