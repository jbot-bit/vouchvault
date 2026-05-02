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
  "asking price", "back of dm", "back of pm",
  "best price", "briar", "btc only", "buying",
  "cash app", "come thru", "crypto only",
  "delivery service", "dm me", "dms open", "drop loc", "drop off", "drop spot",
  "drop the loc", "drop ya loc", "drop your loc",
  "eth only", "f2f", "first one free", "free delivery", "free sample",
  "front", "front me", "fronting",
  "go halves", "going halves", "going rate", "got insta", "got kik",
  "got snap", "got some", "got the", "got wickr",
  "hit me up", "hmu", "holding", "how much",
  "in stock", "inbox me", "inbox open", "kik me",
  "lay it on tic", "lmk if anyone",
  "matrix me", "meet up", "menu attached", "menu drop", "menu in dm",
  "menu in pm", "monero only", "my rate",
  "open dms", "open for biz", "open for business", "owe me",
  "p2p", "paypal me", "pick up spot", "pickup", "pickup spot",
  "plug recs", "pm me", "price list", "price on", "prices in dm",
  "prices in pm",
  "selling", "session", "shoutout for plug", "signal me",
  "snap me", "snapchat me", "sold", "split a", "stock list",
  "stocked", "tab me", "tab up", "the plug",
  "threema", "tic", "tick", "tox me",
  "vendor recs", "venmo me",
  "what for", "what u sell", "what's the price",
  "wickr", "wickr me", "wtb", "wts", "wtt",
  "xmr only",
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
    re: /\bgot\s+any\s+(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|meth|ice|crystal|dabs|edibles|rosin|shatter|blow|yay|yayo|heroin|smack|dope|speed|blues|bars|kpins|rock|rocks|crack)\b/i,
  },
  // Numeric quantity request: "need 1g", "after 3.5g", "chasing 7g",
  // "wtb half oz", "cop a teener". Buy-verb + amount + drug-quantity
  // unit. Doesn't require the drug name itself — the unit set is
  // closed and rare in legit chat. Two paths:
  //   (a) numeric + unit ("3.5g", "1 oz", "5 tabs")
  //   (b) standalone slang quantity-word ("teener", "an eighth", "a half oz")
  {
    name: "buy_numeric_quantity",
    re: /\b(?:need|after|chasing|cop+(?:ing)?|score|sort|wtb|grab|grabbing)\s+(?:an?\s+|some\s+)?(?:\d+(?:\.\d+)?\s*(?:g|gs|grams?|ozs?|ounces?|qp|hp|teener|ball|ballz|caps?|tabs?|pills?|bars?)|(?:half|quarter|eighth|teen|teener|ball|ballz|hp|qp)(?:\s+(?:oz|ounce|ozs?))?)\b/i,
  },
  // Solicitation invitation: "DMs open", "inbox is open", "open for biz".
  // Even a polite "open for business" reads as a sales availability
  // signal in this group context.
  {
    name: "open_for_biz",
    re: /\b(?:dms?|dm\s?'s|inbox|pm\s?'s|pms)\s+(?:(?:are|is|now)\s+)?open\b|\bopen\s+for\s+(?:biz|business|orders|the\s+night)\b/i,
  },
  // Off-platform comm-handle request: "got insta?", "got snap?",
  // "got kik?". Question-form ask for a non-Telegram handle.
  // 'telegram' deliberately excluded — vouches normally reference @s.
  {
    name: "got_handle_request",
    re: /\bgot\s+(?:an?\s+|your\s+|ya\s+)?(?:insta|instagram|snap|snapchat|kik|wickr|tox|matrix|session|threema|signal)\b/i,
  },
  // Menu / price-list / stock-list shape: explicit sales catalogue
  // language. "menu in dm", "stock list available", "prices in pm",
  // "menu drops at 7". Each phrasing is in PHRASES too; the regex
  // catches conjugations + ordering variants the literal phrases miss.
  {
    name: "menu_shape",
    re: /\b(?:menu|stock\s*list|price\s*list|prices?)\s+(?:in\s+(?:dm|pm|inbox)|drops?|attached|available|on\s+request|coming|today)\b/i,
  },
  // Off-platform payment names. "cash app", "venmo", "paypal me",
  // "send via venmo". These appear as PHRASES too but the regex
  // catches "$X via venmo" and similar embedded shapes.
  {
    name: "offplatform_payment",
    re: /\b(?:cash\s*app|venmo|paypal|zelle|cashapp)\s+(?:me|only|to|payment|preferred)\b|\b(?:via|through|using)\s+(?:cash\s*app|venmo|paypal|zelle|cashapp)\b/i,
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
const BUY_STEM = /\b(?:anyone|any\s*1|who(?:'s|s)?|chasing|looking for|need|wtb|after\s*(?:some)?|cop(?:ping)?|score|scoring|sort\s+(?:me|out)?|where\s+(?:to|can\s+i)\s+(?:get|find|cop)|tryna\s+(?:get|cop|find)|lmk\s+(?:if|who|where))\b[^@\n]{0,50}\b(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|meth|ice|crystal|oz|qp|hp|gram|d9|dispo|dabs|edibles|rosin|shatter|blow|yay|yayo|heroin|smack|dope|speed|blues|moonrocks|hash|hashish|bricks|halves|quarters|eighths|bars|kpins|rock|rocks|crack|tar|boof|fent|fentanyl)\b/i;

const SOLICIT_CONTACT_CTA = /\b(?:pm|dm|hmu|hit me|inbox|message me|lmk|let me know|shoutout|shout out)\b/i;

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

// Validate + normalise a candidate learned phrase. Pure: kept here so
// tests (and the bot's command handlers) can call it without pulling in
// the DB layer.
//
// Rules — biased toward harder-to-FP shapes, since runtime-added phrases
// don't go through the empirical FP gate that the static PHRASES list
// did. The static set contains short tokens like "pm me", "wtb", "tic"
// because those were measured against a 24k-message corpus; user-added
// phrases haven't been, so we require more discriminative shapes.
//
//   - raw form > 120 chars                   → too_long  (likely pasted msg)
//   - normalised form < 4 chars              → too_short (over-match risk)
//   - normalised has zero letters            → no_letters (digits-only)
//   - no token ≥ 3 alphabetic chars          → too_broad (e.g. "a a", "ab cd")
const LEARNED_PHRASE_MIN_NORMALIZED_LEN = 4;
const LEARNED_PHRASE_MIN_TOKEN_LEN = 3;
const LEARNED_PHRASE_MAX_RAW_LEN = 120;

export function validateLearnedPhrase(raw: string):
  | { ok: true; normalized: string; raw: string }
  | {
      ok: false;
      reason: "too_short" | "no_letters" | "too_long" | "too_broad";
    } {
  const trimmed = raw.trim();
  if (trimmed.length > LEARNED_PHRASE_MAX_RAW_LEN) {
    return { ok: false, reason: "too_long" };
  }
  const norm = normalize(trimmed);
  if (norm.length < LEARNED_PHRASE_MIN_NORMALIZED_LEN) {
    return { ok: false, reason: "too_short" };
  }
  if (!/[a-z]/.test(norm)) {
    return { ok: false, reason: "no_letters" };
  }
  // Require at least one space-separated token with ≥3 alphabetic chars.
  // "a a", "ab cd", "1 2 3" all fail this — those would over-match in
  // ordinary chat. "snap me" passes (snap is 4 letters); "abcd" passes
  // (single token, 4 letters).
  const tokens = norm.split(" ");
  const hasDiscriminativeToken = tokens.some(
    (t) => (t.match(/[a-z]/g)?.length ?? 0) >= LEARNED_PHRASE_MIN_TOKEN_LEN,
  );
  if (!hasDiscriminativeToken) {
    return { ok: false, reason: "too_broad" };
  }
  return { ok: true, normalized: norm, raw: trimmed };
}

// Reusable phrase-pass against an arbitrary phrase list. Same normalisation
// + space-padded word-boundary check as the static PHRASES pass. Used by
// chatModeration to also check the live `learned_phrases` set.
// `phrases` should be pre-normalised by the caller (i.e. each entry has
// already been through `normalize`); this function does NOT renormalise
// per-message-per-phrase.
export function findHitInPhrases(
  text: string,
  phrases: ReadonlyArray<string>,
): { matched: true; phrase: string } | { matched: false } {
  if (phrases.length === 0) return { matched: false };
  const padded = ` ${normalize(text)} `;
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (padded.includes(` ${phrase} `)) {
      return { matched: true, phrase };
    }
  }
  return { matched: false };
}

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

