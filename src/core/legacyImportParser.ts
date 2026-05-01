import { normalizeUsername, type EntryResult, type EntryTag, type EntryType } from "./archive.ts";

export type LegacyImportResult = Extract<EntryResult, "positive" | "negative">;
export type LegacyImportEntryType = Extract<EntryType, "service">;

export type LegacySkipReason =
  | "missing_reviewer"
  | "missing_target"
  | "multiple_targets"
  | "self_target"
  | "unclear_sentiment"
  | "missing_source_message_id"
  | "missing_timestamp"
  | "unsupported_message_type"
  | "bot_sender";

export type LegacySummaryBucket =
  | "missing_reviewer"
  | "missing_target"
  | "multiple_targets"
  | "unclear_sentiment"
  | "bot_sender"
  | "other";

type LegacyPattern = {
  label: string;
  regex: RegExp;
};

function buildLegacyKeywordPattern(keyword: string): RegExp {
  return new RegExp(`(?<!not\\s)\\b${keyword}\\b`);
}

export type LegacyImportCandidate = {
  sourceChatId: number;
  sourceMessageId: number;
  originalTimestamp: Date;
  reviewerUsername: string;
  reviewerTelegramId: number;
  targetUsername: string;
  entryType: LegacyImportEntryType;
  result: LegacyImportResult;
  selectedTags: EntryTag[];
  text: string;
};

export type LegacyReviewItem = {
  sourceMessageId: number | null;
  originalDate: string | null;
  reviewerUsername: string | null;
  targetUsernames: string[];
  reason: LegacySkipReason;
  detail: string;
  textExcerpt: string;
};

export type LegacyImportDecision =
  | { kind: "import"; candidate: LegacyImportCandidate }
  | {
      kind: "skip";
      bucket: LegacySummaryBucket;
      reviewItem: LegacyReviewItem;
    };

const LEGACY_ENTRY_TYPE: LegacyImportEntryType = "service";
const LEGACY_TAGS_BY_RESULT: Record<LegacyImportResult, readonly EntryTag[]> = {
  positive: ["good_comms"],
  negative: ["poor_comms"],
};

// Question-shape detector. Messages like "anyone vouch @x?", "can anyone
// vouch for @y", "any vouches @z" are REQUESTS, not vouches. They tag
// an @ but the writer is asking the group to vouch — not vouching
// themselves. If a message matches any of these, it's classified as
// unclear regardless of other matches, even if it accidentally trips a
// positive keyword. Empirically (V1+V3 review) these dominate the false-
// positive risk for any expanded POS lexicon.
const QUERY_PATTERNS: readonly RegExp[] = [
  /\bany(?:one|1|body)\s+vouch(?:ed)?\b/, // "anyone vouch", "any1 vouch", "anybody vouch"
  /\bany\s+vouch(?:es)?\b\s*\??/, // "any vouches?", "any vouches"
  /\bcan\s+(?:any(?:one|1|body)|some(?:one|1|body)|you|u|i|we|y'?all)\s+vouch\b/, // "can anyone vouch", "can you vouch", "can u vouch me"
  /\bwho\s+(?:can\s+)?vouch(?:es|ed)?\b/, // "who can vouch", "who vouched"
  /\bvouch(?:es)?\s*\?\s*$/, // "@user vouches?" — bare query at end
  /\bis\s+@?\w+\s+vouched\b/, // "is @user vouched"
  /\bvouch\s+me\b/, // "vouch me bro" — asking to be vouched
  /\bgot\s+(?:any\s+)?vouch(?:es)?\b\s*\??/, // "got any vouches?"
];

// "Plain @user" with no further content — treat as unclear (could be
// reply, mention, ping, not a vouch). This catches very short messages
// that are just an @ tag.
const BARE_MENTION_REGEX = /^@\w+\s*[!?.,]*\s*$/;

const POSITIVE_PATTERNS: readonly LegacyPattern[] = [
  // ---- Existing markers ----
  { label: "+rep", regex: /(^|[^a-z0-9_])\+\s*rep(?=$|[^a-z0-9_])/ },
  { label: "+vouch", regex: /(^|[^a-z0-9_])\+\s*vouch(?=$|[^a-z0-9_])/ },
  { label: "legit", regex: buildLegacyKeywordPattern("legit") },
  { label: "trusted", regex: buildLegacyKeywordPattern("trusted") },
  { label: "good", regex: buildLegacyKeywordPattern("good") },
  { label: "recommend", regex: /(?<!not\s)\brecommend(?:ed|s|ing)?\b/ },
  { label: "pos vouch", regex: /(?<!not\s)\bpos\s+vouch\b/ },
  { label: "huge vouch", regex: /(?<!not\s)\bhuge\s+vouch\b/ },
  { label: "big vouch", regex: /(?<!not\s)\bbig\s+vouch\b/ },
  { label: "mad vouch", regex: /(?<!not\s)\bmad\s+vouch\b/ },
  { label: "high vouch", regex: /(?<!not\s)\bhigh(?:ly)?\s+vouch\b/ },
  { label: "solid vouch", regex: /(?<!not\s)\bsolid\s+vouch\b/ },

  // ---- Vouch-keyword expansion (synonyms + typos seen in corpus) ----
  { label: "positive vouch", regex: /(?<!not\s)\bpositive\s+vouch\b/ },
  { label: "massive vouch", regex: /(?<!not\s)\bmassive\s+vouch\b/ },
  { label: "heavy vouch", regex: /(?<!not\s)\bheavy\s+vouch\b/ },
  { label: "poss vouch (typo)", regex: /(?<!not\s)\bposs\s+vouch\b/ },
  { label: "pov vouch (typo)", regex: /(?<!not\s)\bpov\s+vouch\b/ },
  { label: "vouch the bro", regex: /\bvouch(?:ing)?\s+(?:the|this|that|my|our)\s+(?:bro|guy|lad|cunt|dude|bloke|geezer|legend|man|king)\b/ },

  // ---- Quality-marker phrases (slang for "this person was good") ----
  { label: "easy to deal with", regex: /\beasy\s+(?:to\s+)?deal(?:ing)?\s+(?:with|w\/)?\b/ },
  { label: "would deal again", regex: /\bwould\s+(?:deal|buy|use|recommend|interact|engage)\s+(?:with\s+)?(?:them|him|her|again)\b/ },
  { label: "no drama", regex: /\bno\s+(?:drama|issues|problems|hassle|fuss|bs)\b/ },
  { label: "easy comms", regex: /\b(?:easy|smooth|good|great|fast|quick|prompt|solid)\s+comm(?:s|unication)?\b/ },
  { label: "smashed it", regex: /\bsmashed\s+(?:it|that|out)\b/ },
  { label: "came through", regex: /\bcame\s+(?:through|thru|in\s+clutch|correct)\b/ },
  { label: "top job/bloke", regex: /\btop\s+(?:bloke|guy|lad|geezer|cunt|man|king|legend|dude|job|effort|notch|tier|shelf)\b/ },
  { label: "solid bloke", regex: /\bsolid\s+(?:bloke|guy|lad|geezer|cunt|man|king|legend|dude|seller|buyer)\b/ },
  { label: "good bloke", regex: /\bgood\s+(?:bloke|guy|lad|geezer|cunt|man|king|legend|dude|seller|buyer)\b/ },
  { label: "nice bloke", regex: /\bnice(?:st)?\s+(?:bloke|guy|lad|geezer|cunt|man|king|legend|dude|gentleman|gent)\b/ },
  { label: "proper bloke", regex: /\bproper\s+(?:bloke|guy|lad|geezer|cunt|man|king|legend|dude|gentleman|gent)\b/ },
  { label: "champion", regex: /\bchamp(?:ion|y|sta)?\b/ },
  { label: "legend", regex: /\bleg(?:end|enda?ry)\b/ },
  { label: "smooth transaction", regex: /\b(?:smooth|easy|quick|prompt|fast)\s+(?:transaction|deal|interaction|exchange|sale|purchase|trade|trans)\b/ },
  { label: "straight to the point", regex: /\bstraight\s+to\s+the\s+point\b/ },
  { label: "paid upfront", regex: /\bpaid\s+(?:upfront|on\s+time|prompt(?:ly)?|quick(?:ly)?|in\s+full)\b/ },
  { label: "on time", regex: /\b(?:on|right\s+on)\s+time\b/ },
  { label: "respectful", regex: /\brespect(?:ful|ed|s)\b/ },
  { label: "certi (slang)", regex: /\b(?:certi(?:fied|fy|fies)?|certy)\b/ },
  { label: "🔥/💯 markers", regex: /(?:🔥{1,}|💯{1,}|⭐{2,}|✅(?=[^a-z]))/u },
  { label: "10/10", regex: /\b10\s*\/\s*10\b/ },
  { label: "a1", regex: /\ba\s*1\s+(?:biz|business|seller|buyer|service|guy|bloke|lad)\b/ },
  { label: "5 stars", regex: /\b(?:5|five)\s*(?:\/\s*5\s*)?stars?\b/ },
  { label: "all good/sweet", regex: /\ball\s+(?:good|sweet|gucci|g)\b/ },
  { label: "hooked up", regex: /\bhook(?:ed|s|ing)?\s+(?:me\s+)?up\b/ },
  { label: "saved my", regex: /\bsav(?:ed|ing|es)\s+(?:my|the|our)\s+(?:day|life|ass|skin|night)\b/ },
  { label: "great bro/cunt/lad", regex: /\b(?:great|sound|sick|wicked|mad|massive|cracking)\s+(?:bro|bloke|guy|lad|geezer|cunt|dude|gentleman|legend|man|king|bro|cuz)\b/ },
];

const NEGATIVE_PATTERNS: readonly LegacyPattern[] = [
  // ---- Existing markers ----
  { label: "-rep", regex: /(^|[^a-z0-9_])-\s*rep(?=$|[^a-z0-9_])/ },
  { label: "-vouch", regex: /(^|[^a-z0-9_])-\s*vouch(?=$|[^a-z0-9_])/ },
  { label: "avoid", regex: buildLegacyKeywordPattern("avoid") },
  { label: "bad", regex: buildLegacyKeywordPattern("bad") },
  { label: "warning", regex: buildLegacyKeywordPattern("warning") },
  { label: "not legit", regex: /\bnot\s+legit\b/ },
  { label: "neg vouch", regex: /(?<!not\s)\bneg\s+vouch\b/ },
  { label: "scam", regex: /(?<!not\s)\bscam(?:mer|med|ming|s)?\b/ },
  { label: "ripped", regex: /(?<!not\s)\bripped\b/ },
  { label: "dodgy", regex: /(?<!not\s)\bdodgy\b/ },
  { label: "sketchy", regex: /(?<!not\s)\bsketchy\b/ },
  { label: "shady", regex: /(?<!not\s)\bshady\b/ },
  { label: "ghost", regex: /(?<!not\s)\bghost(?:ed|ing)?\b/ },
  { label: "steer clear", regex: /(?<!not\s)\bsteer\s+clear\b/ },
  { label: "dont trust", regex: /(?<!not\s)\bdon'?t\s+trust\b/ },

  // ---- Negative-vouch keyword expansion ----
  { label: "negative vouch", regex: /\bnegative\s+vouch\b/ },
  { label: "warned of/about", regex: /\bwarn(?:ed|ing)\s+(?:of|about|against)\b/ },

  // ---- Behaviour markers (clear patterns of bad acts) ----
  { label: "owes (money)", regex: /\bowes\s+(?:me|us|him|her|them|money|cash|multiple|several|the)\b/ },
  { label: "took my money", regex: /\b(?:took|stole|kept)\s+(?:my|our|the)\s+(?:money|cash|coin|funds|payment|deposit)\b/ },
  { label: "ripped me off", regex: /\b(?:ripped|rip(?:ping)?)\s+(?:me|us|him|her|them|people|ppl|multiple)\s+off\b/ },
  { label: "never sent/delivered", regex: /\bnever\s+(?:sent|delivered|received|got|came|shipped|posted|arrived)\b/ },
  { label: "blocked me/us", regex: /\bblock(?:ed|s)?\s+(?:me|us|him|her|them)\b/ },
  { label: "dont deal with", regex: /\bdon'?t\s+deal\s+(?:with\b|w\/)/ },
  { label: "fake/fraud", regex: /\b(?:fraud(?:ster|s|ulent)?|fake\s+(?:bro|guy|seller|buyer|profile|account|vouch|scammer))\b/ },
  { label: "missing in action/funds", regex: /\bm\.?\s*i\.?\s*a\.?\b/ }, // "MIA"
  { label: "middle man (verb)", regex: /\bmiddle\s*man(?:ned|ning|s)?\b/ },
];

// Manual-repost wrapper used when an admin pasted historical vouches into a
// new group instead of using the bot. Format is exactly:
//   FROM: @username / 1234567890
//   DATE: dd/mm/yyyy
//   <blank line>
//   <original body>
// The username may also be the literal "DELETED ACCOUNT" — in which case we
// fall back to a synthetic placeholder built from the numeric id so the row
// can still flow through validation.
const REPOST_HEADER_REGEX =
  /^FROM:\s*(?:@\s*([A-Za-z0-9_]+)|(DELETED\s+ACCOUNT))\s*\/\s*(\d+)\s*\r?\n+DATE:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*\r?\n/i;

function legacyUsernameForDeletedAccount(numericId: number): string {
  return `legacy_${numericId}`;
}

function tryUnwrapManualRepostHeader(text: string): {
  body: string;
  reviewerUsername: string;
  originalTimestamp: Date;
} | null {
  const match = REPOST_HEADER_REGEX.exec(text);
  if (!match) {
    return null;
  }

  const [, namedUsername, deletedMarker, idStr, dayStr, monthStr, yearStr] = match;
  const numericId = Number(idStr);
  if (!Number.isSafeInteger(numericId)) {
    return null;
  }

  const reviewerUsername = deletedMarker
    ? legacyUsernameForDeletedAccount(numericId)
    : (normalizeUsername(namedUsername ?? null) ?? null);
  if (!reviewerUsername) {
    return null;
  }

  const day = Number(dayStr);
  const month = Number(monthStr);
  let year = Number(yearStr);
  if (year < 100) year += 2000;
  if (
    !Number.isInteger(day) || day < 1 || day > 31 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(year) || year < 2000 || year > 2100
  ) {
    return null;
  }
  // Anchor to noon UTC so the dd/mm/yyyy render is stable across timezones.
  const originalTimestamp = new Date(Date.UTC(year, month - 1, day, 12));

  const body = text.slice(match[0].length).replace(/^\s*\n+/, "");
  return { body, reviewerUsername, originalTimestamp };
}

const TELEGRAM_USERNAME_REGEX = /@([A-Za-z][A-Za-z0-9_]{4,31})\b/g;
const FROM_ID_USER_PREFIX = /^user(\d+)$/;
const FROM_ID_CHAT_OR_CHANNEL_PREFIX = /^(chat|channel)\d+$/;
const REVIEWER_FIELD_NAMES = [
  "username",
  "from_username",
  "fromUsername",
  "author_username",
  "authorUsername",
  "actor_username",
  "actorUsername",
  "sender_username",
  "senderUsername",
  "sender_name",
  "senderName",
  "from",
  "author",
  "actor",
  "sender",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toSafeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildTextExcerpt(text: string): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= 200) {
    return collapsed;
  }

  return `${collapsed.slice(0, 197)}...`;
}

function addUniqueUsername(usernames: string[], rawUsername: string | null) {
  if (!rawUsername || usernames.includes(rawUsername)) {
    return;
  }

  usernames.push(rawUsername);
}

function extractUsernameFromUnknown(value: unknown, depth = 0): string | null {
  if (depth > 2) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeUsername(value);
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of REVIEWER_FIELD_NAMES) {
    const nested = extractUsernameFromUnknown(value[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function resolveTopLevelChatId(value: unknown): number | null {
  const direct = toSafeInteger(value);
  if (direct != null) {
    return direct;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["chat_id", "chatId", "channel_id", "channelId", "id"] as const) {
    const nested = toSafeInteger(value[key]);
    if (nested != null) {
      return nested;
    }
  }

  return null;
}

export function flattenLegacyMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((part) => flattenLegacyMessageText(part)).join("");
  }

  if (isRecord(value) && value.text !== undefined) {
    return flattenLegacyMessageText(value.text);
  }

  return "";
}

export function extractLegacyReviewerUsername(message: unknown): string | null {
  if (!isRecord(message)) {
    return null;
  }

  for (const fieldName of REVIEWER_FIELD_NAMES) {
    const username = extractUsernameFromUnknown(message[fieldName]);
    if (username) {
      return username;
    }
  }

  return null;
}

export function extractLegacyTargetUsernames(text: string): string[] {
  const usernames: string[] = [];

  for (const match of text.matchAll(TELEGRAM_USERNAME_REGEX)) {
    addUniqueUsername(usernames, normalizeUsername(match[1] ?? null));
  }

  return usernames;
}

export function classifyLegacyResult(text: string): {
  result: LegacyImportResult | null;
  matchedPositive: string[];
  matchedNegative: string[];
} {
  const normalizedText = collapseWhitespace(text.toLowerCase());

  // Query-shape override: if the message is a request for vouches
  // ("anyone vouch?", "can anyone vouch for @x") it's NOT a vouch
  // itself even if it accidentally trips a positive keyword. Same for
  // bare-mention messages with no body. Skip → unclear.
  if (QUERY_PATTERNS.some((re) => re.test(normalizedText))) {
    return { result: null, matchedPositive: [], matchedNegative: [] };
  }
  if (BARE_MENTION_REGEX.test(normalizedText)) {
    return { result: null, matchedPositive: [], matchedNegative: [] };
  }

  const matchedPositive = POSITIVE_PATTERNS.filter((pattern) =>
    pattern.regex.test(normalizedText),
  ).map((pattern) => pattern.label);
  const matchedNegative = NEGATIVE_PATTERNS.filter((pattern) =>
    pattern.regex.test(normalizedText),
  ).map((pattern) => pattern.label);

  if (matchedPositive.length > 0 && matchedNegative.length > 0) {
    return {
      result: null,
      matchedPositive,
      matchedNegative,
    };
  }

  if (matchedPositive.length > 0) {
    return {
      result: "positive",
      matchedPositive,
      matchedNegative,
    };
  }

  if (matchedNegative.length > 0) {
    return {
      result: "negative",
      matchedPositive,
      matchedNegative,
    };
  }

  return {
    result: null,
    matchedPositive,
    matchedNegative,
  };
}

function getLegacyMessageId(message: unknown): number | null {
  if (!isRecord(message)) {
    return null;
  }

  return toSafeInteger(message.id);
}

function getLegacyMessageTimestamp(message: unknown): Date | null {
  if (!isRecord(message)) {
    return null;
  }

  const unixTime = toSafeInteger(message.date_unixtime);
  if (unixTime != null && unixTime > 0) {
    return new Date(unixTime * 1000);
  }

  if (typeof message.date === "string") {
    const parsed = new Date(message.date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function getSyntheticLegacyReviewerTelegramId(username: string): number {
  let hash = 2166136261;
  for (const character of username) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return -(1_000_000_000 + (hash >>> 0));
}

function buildSkipDecision(input: {
  message: unknown;
  sourceMessageId: number | null;
  originalTimestamp: Date | null;
  reviewerUsername: string | null;
  targetUsernames?: string[];
  reason: LegacySkipReason;
  detail: string;
  bucket: LegacySummaryBucket;
}): LegacyImportDecision {
  const text = isRecord(input.message) ? flattenLegacyMessageText(input.message.text).trim() : "";

  return {
    kind: "skip",
    bucket: input.bucket,
    reviewItem: {
      sourceMessageId: input.sourceMessageId,
      originalDate: input.originalTimestamp?.toISOString().slice(0, 10) ?? null,
      reviewerUsername: input.reviewerUsername,
      targetUsernames: input.targetUsernames ?? [],
      reason: input.reason,
      detail: input.detail,
      textExcerpt: buildTextExcerpt(text),
    },
  };
}

function extractFromIdNumeric(message: unknown): { kind: "user"; numericId: number } | { kind: "non_user" } | null {
  if (!isRecord(message)) return null;
  const fromId = message.from_id;
  if (typeof fromId !== "string") return null;
  const userMatch = FROM_ID_USER_PREFIX.exec(fromId);
  if (userMatch) {
    const numericId = Number(userMatch[1]);
    return Number.isSafeInteger(numericId) ? { kind: "user", numericId } : null;
  }
  if (FROM_ID_CHAT_OR_CHANNEL_PREFIX.test(fromId)) return { kind: "non_user" };
  return null;
}

export function parseLegacyExportMessage(input: {
  message: unknown;
  sourceChatId: number;
  botSenders?: Set<string>;
}): LegacyImportDecision {
  if (!isRecord(input.message)) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId: null,
      originalTimestamp: null,
      reviewerUsername: null,
      reason: "unsupported_message_type",
      detail: "Export record is not an object.",
      bucket: "other",
    });
  }

  const messageType = typeof input.message.type === "string" ? input.message.type : "message";
  const sourceMessageId = getLegacyMessageId(input.message);
  let originalTimestamp = getLegacyMessageTimestamp(input.message);
  let reviewerUsername = extractLegacyReviewerUsername(input.message);
  let reviewerNumericId: number | null = null;

  if (messageType !== "message") {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "unsupported_message_type",
      detail: `Skipping export record with type "${messageType}".`,
      bucket: "other",
    });
  }

  if (sourceMessageId == null) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "missing_source_message_id",
      detail: "Message record has no safe integer id.",
      bucket: "other",
    });
  }

  if (!originalTimestamp) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "missing_timestamp",
      detail: "Message record has no parseable original timestamp.",
      bucket: "other",
    });
  }

  if (reviewerUsername && input.botSenders?.has(reviewerUsername)) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "bot_sender",
      detail: `Skipping known bot sender ${reviewerUsername}.`,
      bucket: "bot_sender",
    });
  }

  // Resolve the body text first (with caption fallback) so we can detect a
  // manual-repost wrapper before falling back to from_id or skipping for
  // missing reviewer. The wrapper's FROM/DATE fields override the export-level
  // sender + timestamp; the body becomes the text we run target/sentiment
  // extraction on.
  const rawText = (() => {
    const main = flattenLegacyMessageText((input.message as Record<string, unknown>).text).trim();
    if (main) return main;
    return flattenLegacyMessageText((input.message as Record<string, unknown>).caption).trim();
  })();

  // The bot_sender skip above gates on the export-level @username only —
  // by the time we reach the unwrap, that check has already let the message
  // through. We deliberately do not re-check the unwrapped reviewer against
  // botSenders: by construction the wrapped reviewer is the original human
  // sender quoted by the import bot, so re-checking would just risk false
  // positives on unrelated similarly-named accounts.
  const unwrap = tryUnwrapManualRepostHeader(rawText);
  const text = unwrap ? unwrap.body.trim() : rawText;
  if (unwrap) {
    reviewerUsername = unwrap.reviewerUsername;
    originalTimestamp = unwrap.originalTimestamp;
  }

  if (!reviewerUsername) {
    const fromId = extractFromIdNumeric(input.message);
    if (fromId?.kind === "non_user") {
      return buildSkipDecision({
        message: input.message,
        sourceMessageId,
        originalTimestamp,
        reviewerUsername: null,
        reason: "bot_sender",
        detail: "Sender is a chat/channel, not a user.",
        bucket: "bot_sender",
      });
    }
    if (fromId?.kind === "user") {
      reviewerUsername = `user${fromId.numericId}`;
      reviewerNumericId = fromId.numericId;
    }
  }

  if (!reviewerUsername) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "missing_reviewer",
      detail: "Could not derive a public reviewer @username from the export sender fields.",
      bucket: "missing_reviewer",
    });
  }

  const targetUsernames = extractLegacyTargetUsernames(text);

  if (targetUsernames.length === 0) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      targetUsernames,
      reason: "missing_target",
      detail: "No Telegram @username target was found in the message text.",
      bucket: "missing_target",
    });
  }

  if (targetUsernames.length > 1) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      targetUsernames,
      reason: "multiple_targets",
      detail: "More than one Telegram @username target was found in the message text.",
      bucket: "multiple_targets",
    });
  }

  // length is exactly 1 here (checked above), so index 0 is guaranteed
  const targetUsername = targetUsernames[0]!;
  if (targetUsername === reviewerUsername) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      targetUsernames,
      reason: "self_target",
      detail:
        "Legacy replay skips self-targeted messages to stay aligned with the live vouch rules.",
      bucket: "missing_target",
    });
  }

  const sentiment = classifyLegacyResult(text);
  if (!sentiment.result) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      targetUsernames,
      reason: "unclear_sentiment",
      detail:
        sentiment.matchedPositive.length > 0 || sentiment.matchedNegative.length > 0
          ? `Conflicting legacy sentiment markers found. Positive: ${sentiment.matchedPositive.join(", ") || "none"}; Negative: ${sentiment.matchedNegative.join(", ") || "none"}.`
          : "No approved positive or negative legacy sentiment marker was found.",
      bucket: "unclear_sentiment",
    });
  }

  return {
    kind: "import",
    candidate: {
      sourceChatId: input.sourceChatId,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reviewerTelegramId: reviewerNumericId ?? getSyntheticLegacyReviewerTelegramId(reviewerUsername),
      targetUsername,
      entryType: LEGACY_ENTRY_TYPE,
      result: sentiment.result,
      selectedTags: [...LEGACY_TAGS_BY_RESULT[sentiment.result]],
      text,
    },
  };
}

export function getLegacyExportMessages(exportData: unknown): unknown[] {
  if (Array.isArray(exportData)) {
    return exportData;
  }

  if (isRecord(exportData) && Array.isArray(exportData.messages)) {
    return exportData.messages;
  }

  throw new Error("Telegram export JSON must be an array or an object with a messages array.");
}

export function resolveLegacySourceChatId(
  exportData: unknown,
  overrideChatId?: number | null,
): number {
  if (overrideChatId != null) {
    return overrideChatId;
  }

  if (!isRecord(exportData)) {
    throw new Error(
      "Could not resolve the legacy source chat id from the export. Pass --source-chat-id <id>.",
    );
  }

  for (const key of ["id", "chat_id", "chatId", "peer_id", "peerId"] as const) {
    const resolved = resolveTopLevelChatId(exportData[key]);
    if (resolved != null) {
      return resolved;
    }
  }

  throw new Error(
    "Could not resolve the legacy source chat id from the export. Pass --source-chat-id <id>.",
  );
}

export function sortLegacyMessages(messages: unknown[]): unknown[] {
  return [...messages].sort((left, right) => {
    const leftTimestamp = getLegacyMessageTimestamp(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTimestamp = getLegacyMessageTimestamp(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    const leftMessageId = getLegacyMessageId(left) ?? Number.MAX_SAFE_INTEGER;
    const rightMessageId = getLegacyMessageId(right) ?? Number.MAX_SAFE_INTEGER;
    return leftMessageId - rightMessageId;
  });
}
