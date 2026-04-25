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

const POSITIVE_PATTERNS: readonly LegacyPattern[] = [
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
];

const NEGATIVE_PATTERNS: readonly LegacyPattern[] = [
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
