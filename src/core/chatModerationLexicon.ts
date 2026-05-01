// Pure-helper module for chat moderation. No DB imports — safe to load
// in test contexts without DATABASE_URL.
//
// The orchestration (audit-log insert + Telegram calls) lives in
// `src/core/chatModeration.ts`, which imports from here.

export const MODERATION_COMMAND = "chat_moderation:delete";

// Empirically derived from four chat exports (~24k messages). Each phrase
// fired dozens of times in the abuse corpus and 0–4 times in the target
// community. Drug names are deliberately excluded — Suncoast V3 uses
// bud / fire / k / mdma / pingas / caps in normal chat. The high-precision
// discriminator is commerce-shape phrasing, not vocabulary.
// 2026-05 expansion mixed in. Keep alphabetised for diff readability;
// chatModeration.test.ts asserts it.
export const PHRASES: ReadonlyArray<string> = [
  "any deals", "any plug", "any plugs", "any1 got", "any1 selling",
  "anyone got", "anyone holding", "anyone selling",
  "best price", "briar", "buying", "come thru",
  "delivery service", "dm me", "drop loc", "drop off", "drop spot",
  "drop the loc", "drop ya loc", "drop your loc",
  "f2f", "free delivery", "free sample", "front", "front me", "fronting",
  "go halves", "going halves", "going rate", "got some", "got the",
  "hit me up", "hmu", "holding", "how much",
  "in stock", "inbox me", "kik me", "lay it on tic",
  "matrix me", "meet up", "my rate", "owe me", "p2p",
  "pick up spot", "pickup", "pickup spot", "pm me",
  "selling", "session", "signal me", "snap me", "snapchat me",
  "sold", "split a", "stocked", "tab me", "tab up", "the plug",
  "threema", "tic", "tick", "tox me",
  "what for", "what u sell", "what's the price",
  "wickr", "wickr me", "wtb", "wts", "wtt",
];

// Format-perfect artefacts + vouch-shape patterns. Empirical scan:
// 0 wallets, 0 emails, ~10 phones, 41 off-platform-comm references,
// 136 t.me invite links across 24k messages. Vouch-shape patterns
// catch members trying to type their own vouches in chat instead
// of going through the bot's DM flow — those are reportable artefacts
// (unstructured "vouch" claims in the public chat) and only the bot
// should publish vouch-shaped content. The bot's own posts are skipped
// upstream via the is_bot + id-equals-bot check, so the bot's heading
// "POS Vouch > @target" doesn't moderate itself.
const REGEX_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "tme_invite",         re: /t\.me\/\+|t\.me\/joinchat|telegram\.me\/\+/i },
  { name: "phone",              re: /\b\+?\d[\d\s\-]{7,}\d\b/ },
  { name: "crypto_wallet",      re: /\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b/ },
  { name: "email",              re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "vouch_heading",      re: /\b(?:pos|neg|mix)\s+vouch\b/i },
  { name: "vouch_for_username", re: /\bvouch(?:ing|ed)?\b[^\n]{0,30}@[A-Za-z]/i },
  { name: "vouch_shorthand",    re: /[+\-]vouch\b/i },
  // 2026-05 expansion. The patterns below were derived from common
  // sales/solicitation shapes seen across multiple takedown corpora.
  // Each is high-precision on its own: a hostile reporter reading a
  // hit through any of these patterns gets a clearly-classifiable
  // commerce signal, which is what we want auto-deleted.

  // Price-with-quantity: "$50 for a g", "$200 oz", "350 a qp" — the
  // numeric figure adjacent to a quantity unit is rare in legit chat.
  // Constrained to numbers ≤ 4 digits so we don't fire on phone-number
  // remnants the phone regex didn't catch. Connector words ("for", "a",
  // "per", "of", "=", "/", "-") may appear 0–3 times between the price
  // and the quantity unit. The unit list is a closed set so benign
  // phrasings like "$200 a month" or "$50 last night" don't fire.
  {
    name: "price_quantity",
    re: /(?:\$\s*\d{1,4}|\baud\s*\$?\s*\d{1,4}|\b\d{2,4})\b\s*(?:[/\-]\s*|(?:per|for|a|of|=|=>|gets?|grabs?)\s+){0,3}(?:gram|grams|oz|ounce|qp|hp|eighth|teener|ball|8\s?ball|bag|bags|cap|caps|tab|tabs|pill|pills)\b/i,
  },
  // Comm-handle sharing in "Service: handle" form. "snap: bobsmith",
  // "kik me at JaneDoe", "session id 05abc..." — patterns where someone
  // is dropping an off-platform contact handle into open chat.
  // 'telegram' deliberately excluded (vouches commonly say
  // "DM @user on telegram"); same for "signal" + a phone number which
  // already trips the phone regex.
  {
    name: "comm_handle_share",
    re: /\b(?:snap|snapchat|kik|tox|matrix|session\s*id|threema)\s*(?:me\s*)?(?:[:=@]|\bat\b|\bid\b)\s*[A-Za-z0-9._-]{3,}/i,
  },
  // High-confidence solicitation quantifier: "anyone / any 1 / who's"
  // followed shortly by a buy/availability verb. Doesn't require a
  // drug name (unlike compound_buy_solicit) — these phrasings are
  // overwhelmingly commerce-shaped on their own.
  {
    name: "anyone_buyverb",
    re: /\b(?:anyone|any\s*1|any\s*one|who['']?s|whos|who\sgot)\s+(?:got|holding|selling|selling\s+any|with|copping|chasing|after)\b/i,
  },
  // "got any [drug-class noun]?" — availability question with a buy
  // intent inferred from the noun. Drug-name list overlaps with
  // BUY_STEM intentionally; legitimate uses ("got any vouches",
  // "got any food") don't share the noun set.
  {
    name: "got_any_supply",
    re: /\bgot\s+any\s+(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|meth|ice|crystal|dabs|edibles|rosin|shatter|blow|yay|yayo|heroin|smack|dope|speed|blues)\b/i,
  },
];

// Compound rule: variant B (KB:F2.18). A solicitation is when a buy/chasing
// stem appears in proximity to a drug-name AND a contact-CTA appears in the
// same message. Both must match to fire — that's the calibration that gives
// us 0 marginal FPs in TBC26 (KB:F2.19) and ~165 catches in QLD Chasing.
//
// Drug-name list: edit as new slang surfaces. Re-run
// `npm run measure:lexicon-fp` after every edit to confirm the FP gate
// still passes.
const BUY_STEM = /\b(?:anyone|any\s*1|who(?:'s|s)?|chasing|looking for|need|wtb|after\s*(?:some)?|cop(?:ping)?|score|scoring|sort\s+(?:me|out)?|where\s+(?:to|can\s+i)\s+(?:get|find|cop)|tryna\s+(?:get|cop|find))\b[^@\n]{0,50}\b(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|meth|ice|crystal|oz|qp|hp|gram|d9|dispo|dabs|edibles|rosin|shatter|blow|yay|yayo|heroin|smack|dope|speed|blues|moonrocks|hash|hashish|bricks|halves|quarters|eighths)\b/i;

const SOLICIT_CONTACT_CTA = /\b(?:pm|dm|hmu|hit me|inbox|message me)\b/i;

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
  // Compound pass: BUY_STEM + SOLICIT_CONTACT_CTA both present (KB:F2.18).
  if (BUY_STEM.test(text) && SOLICIT_CONTACT_CTA.test(text)) {
    return { matched: true, source: "compound_buy_solicit" };
  }
  return { matched: false };
}

