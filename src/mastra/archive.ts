export const ENTRY_TYPES = ["service", "item", "product"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_RESULTS = ["positive", "mixed", "negative"] as const;
export type EntryResult = (typeof ENTRY_RESULTS)[number];

export const ENTRY_SOURCES = ["live", "legacy_import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const TAG_OPTIONS_BY_RESULT = {
  positive: [
    "good_comms",
    "efficient",
    "on_time",
    "good_quality",
  ],
  mixed: [
    "mixed_comms",
    "some_delays",
    "acceptable_quality",
    "minor_issue",
  ],
  negative: [
    "poor_comms",
    "late",
    "quality_issue",
    "item_mismatch",
  ],
} as const;

export type EntryTag =
  (typeof TAG_OPTIONS_BY_RESULT)[keyof typeof TAG_OPTIONS_BY_RESULT][number];

export const DRAFT_STEPS = [
  "awaiting_target",
  "selecting_result",
  "selecting_tags",
  "preview",
  "idle",
] as const;

export type DraftStep = (typeof DRAFT_STEPS)[number];

export const TYPE_LABELS: Record<EntryType, string> = {
  service: "Service",
  item: "Item",
  product: "Product",
};

export const RESULT_LABELS: Record<EntryResult, string> = {
  positive: "Positive",
  mixed: "Mixed",
  negative: "Negative",
};

export const SOURCE_LABELS: Record<EntrySource, string> = {
  live: "Live",
  legacy_import: "Legacy",
};

export const TAG_LABELS: Record<EntryTag, string> = {
  good_comms: "Good Comms",
  efficient: "Efficient",
  on_time: "On Time",
  good_quality: "Good Quality",
  mixed_comms: "Mixed Comms",
  some_delays: "Some Delays",
  acceptable_quality: "Acceptable Quality",
  minor_issue: "Minor Issue",
  poor_comms: "Poor Comms",
  late: "Late",
  quality_issue: "Quality Issue",
  item_mismatch: "Item Mismatch",
};

export const DEFAULT_DUPLICATE_COOLDOWN_HOURS = 72;
export const DEFAULT_DRAFT_TIMEOUT_HOURS = 24;
export const MAX_LOOKUP_ENTRIES = 5;
export const MAX_RECENT_ENTRIES = 5;
export const STALE_UPDATE_PROCESSING_MINUTES = 10;
export const PROCESSED_UPDATE_RETENTION_DAYS = 14;
export const MAINTENANCE_EVERY_N_UPDATES = 200;

export function normalizeUsername(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim().replace(/^@+/, "");
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function formatUsername(username: string): string {
  return `@${username}`;
}

export function parseSelectedTags(raw: string | null | undefined): EntryTag[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isEntryTag);
  } catch {
    return [];
  }
}

export function serializeSelectedTags(tags: EntryTag[]): string {
  return JSON.stringify([...new Set(tags)]);
}

export function isEntryType(value: string | null | undefined): value is EntryType {
  return value != null && ENTRY_TYPES.includes(value as EntryType);
}

export function isEntryResult(value: string | null | undefined): value is EntryResult {
  return value != null && ENTRY_RESULTS.includes(value as EntryResult);
}

export function isEntrySource(value: string | null | undefined): value is EntrySource {
  return value != null && ENTRY_SOURCES.includes(value as EntrySource);
}

export function isEntryTag(value: unknown): value is EntryTag {
  return typeof value === "string" && Object.values(TAG_OPTIONS_BY_RESULT).some((tags) => (tags as readonly string[]).includes(value));
}

export function getAllowedTagsForResult(result: EntryResult): readonly EntryTag[] {
  return TAG_OPTIONS_BY_RESULT[result];
}

export function toggleTag(tags: EntryTag[], tag: EntryTag): EntryTag[] {
  return tags.includes(tag)
    ? tags.filter((value) => value !== tag)
    : [...tags, tag];
}

export function formatTagList(tags: EntryTag[]): string {
  if (tags.length === 0) {
    return "None";
  }

  return tags.map((tag) => TAG_LABELS[tag]).join(", ");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtUser(username: string): string {
  return `<b>${escapeHtml(formatUsername(username))}</b>`;
}

function fmtResult(result: EntryResult): string {
  return `<b>${escapeHtml(RESULT_LABELS[result])}</b>`;
}

function fmtTags(tags: EntryTag[]): string {
  return escapeHtml(formatTagList(tags));
}

function fmtDate(date: Date): string {
  return escapeHtml(date.toISOString().slice(0, 10));
}

function rulesLine(): string {
  return "Follow Telegram's Terms of Service. No illegal activity, no scams.";
}

function aboutLine(): string {
  return "A business hub for local businesses to share and verify service experiences.";
}

export function buildArchiveEntryText(input: {
  entryId: number;
  reviewerUsername: string;
  targetUsername: string;
  entryType: EntryType;
  result: EntryResult;
  tags: EntryTag[];
  createdAt: Date;
  source?: EntrySource;
  legacySourceTimestamp?: Date | null;
}): string {
  const isLegacy = input.source === "legacy_import";
  const heading = isLegacy
    ? "<b>Legacy Entry</b>"
    : "<b>Entry</b>";

  const lines = [
    heading,
    "",
    `OP: ${fmtUser(input.reviewerUsername)}`,
    `Target: ${fmtUser(input.targetUsername)}`,
    `Result: ${fmtResult(input.result)}`,
    `Tags: ${fmtTags(input.tags)}`,
  ];

  if (isLegacy && input.legacySourceTimestamp) {
    lines.push(`Original: ${fmtDate(input.legacySourceTimestamp)}`);
  }

  return lines.join("\n");
}

export function buildPreviewText(input: {
  reviewerUsername: string;
  targetUsername: string;
  result: EntryResult;
  tags: EntryTag[];
}): string {
  return [
    "<b><u>Preview</u></b>",
    "",
    `OP: ${fmtUser(input.reviewerUsername)}`,
    `Target: ${fmtUser(input.targetUsername)}`,
    `Result: ${fmtResult(input.result)}`,
    `Tags: ${fmtTags(input.tags)}`,
  ].join("\n");
}

export function buildWelcomeText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    aboutLine(),
    "",
    "<b><u>How to Vouch</u></b>",
    "",
    "1. Tap <b>Submit Vouch</b> in the group.",
    "2. Send only the target @username here.",
    "3. Choose the result and tags.",
    "4. I post the final entry back to the group.",
    "",
    "<b>Rules</b>",
    rulesLine(),
  ].join("\n");
}

export function buildTargetPromptText(): string {
  return [
    "<b>Step 1 of 3 — Choose target</b>",
    "",
    "Send the target @username here.",
    "You can also tap <b>Choose Target</b> below.",
  ].join("\n");
}

export function buildTypePromptText(targetUsername: string): string {
  return [
    `Target saved: ${fmtUser(targetUsername)}`,
    "",
    "What are you vouching for?",
  ].join("\n");
}

export function buildResultPromptText(targetUsername: string): string {
  return [
    "<b>Step 2 of 3 — Result</b>",
    "",
    `Target: ${fmtUser(targetUsername)}`,
    "",
    "Choose the result.",
  ].join("\n");
}

export function buildTagPromptText(targetUsername: string, result: EntryResult, tags: EntryTag[]): string {
  return [
    "<b>Step 3 of 3 — Tags</b>",
    "",
    `Target: ${fmtUser(targetUsername)}`,
    `Result: ${fmtResult(result)}`,
    `Tags: ${fmtTags(tags)}`,
    "",
    "Choose one or more tags, then tap <b>Done</b>.",
  ].join("\n");
}

export function buildLookupText(input: {
  targetUsername: string;
  entries: Array<{
    id: number;
    reviewerUsername: string;
    result: EntryResult;
    tags: EntryTag[];
    createdAt: Date;
    source?: EntrySource;
  }>;
}): string {
  if (input.entries.length === 0) {
    return `No entries for ${fmtUser(input.targetUsername)}.`;
  }

  const lines = [`<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`, ""];
  for (const entry of input.entries) {
    const sourceTag = entry.source === "legacy_import" ? " [Legacy]" : "";
    lines.push(`<b>#${entry.id}</b>${escapeHtml(sourceTag)} — ${fmtResult(entry.result)}`);
    lines.push(`By ${fmtUser(entry.reviewerUsername)} • ${fmtDate(entry.createdAt)}`);
    lines.push(`Tags: ${fmtTags(entry.tags)}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildRecentEntriesText(entries: Array<{
  id: number;
  reviewerUsername: string;
  targetUsername: string;
  entryType: EntryType;
  result: EntryResult;
  createdAt: Date;
  source?: EntrySource;
}>): string {
  if (entries.length === 0) {
    return "No entries yet.";
  }

  const lines = ["<b><u>Recent entries</u></b>", ""];
  for (const entry of entries) {
    const sourceTag = entry.source === "legacy_import" ? " [Legacy]" : "";
    lines.push(`<b>#${entry.id}</b>${escapeHtml(sourceTag)} — ${fmtResult(entry.result)}`);
    lines.push(`${fmtUser(entry.reviewerUsername)} → ${fmtUser(entry.targetUsername)} • ${fmtDate(entry.createdAt)}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildLauncherText(): string {
  return [
    "<b>Submit a vouch</b>",
    "Tap below to open the short DM form.",
  ].join("\n");
}

export function buildPinnedGuideText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    aboutLine(),
    "",
    "<b><u>How to Vouch</u></b>",
    "",
    "1. Tap <b>Submit Vouch</b> below.",
    "2. In DM, send only the target @username, then use the buttons.",
    "3. I post the final entry back here.",
    "",
    "<b>Rules</b>",
    rulesLine(),
  ].join("\n");
}

export function buildGroupLauncherReplyText(): string {
  return "Tap below to submit your vouch in DM.";
}

export function buildPublishedDraftText(targetUsername: string, result: EntryResult): string {
  return [
    "<b>✓ Posted to the group</b>",
    "",
    `Target: ${fmtUser(targetUsername)}`,
    `Result: ${fmtResult(result)}`,
  ].join("\n");
}

export function buildBotDescriptionText(): string {
  return "The vouch hub for our business community — a place where local businesses log and verify service experiences. Open from the group launcher, complete the short DM form, and I post a clean entry back to the group. Lawful use only — follow Telegram's Terms of Service. No illegal activity.";
}

export function buildBotShortDescription(): string {
  return "Vouch hub for local businesses. Submit in DM from the group launcher. Lawful use only.";
}

export function buildAdminOnlyText(): string {
  return "<b>Admin only.</b>";
}
