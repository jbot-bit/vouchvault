import { BOT_COPY } from "./botCopy.ts";

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

function formatLabeledLine(label: string, value: string): string {
  return `${label}: ${value}`;
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
  return [
    input.source === "legacy_import"
      ? `🧾 Legacy Entry #${input.entryId}`
      : `🧾 Entry #${input.entryId}`,
    "",
    formatLabeledLine("OP", formatUsername(input.reviewerUsername)),
    formatLabeledLine("Target", formatUsername(input.targetUsername)),
    formatLabeledLine("Result", RESULT_LABELS[input.result]),
    ...(input.source === "legacy_import" && input.legacySourceTimestamp
      ? [formatLabeledLine("Original", input.legacySourceTimestamp.toISOString().slice(0, 10))]
      : []),
  ].join("\n");
}

export function buildPreviewText(input: {
  reviewerUsername: string;
  targetUsername: string;
  result: EntryResult;
  tags: EntryTag[];
}): string {
  return [
    "Preview",
    "",
    formatLabeledLine("OP", formatUsername(input.reviewerUsername)),
    formatLabeledLine("Target", formatUsername(input.targetUsername)),
    formatLabeledLine("Result", RESULT_LABELS[input.result]),
    formatLabeledLine("Tags", formatTagList(input.tags)),
  ].join("\n");
}

export function buildWelcomeText(): string {
  return BOT_COPY.welcome;
}

export function buildTargetPromptText(): string {
  return [
    "Send the target @username.",
    "",
    "You can also tap Choose Target below.",
  ].join("\n");
}

export function buildTypePromptText(targetUsername: string): string {
  return [
    `Target saved: ${formatUsername(targetUsername)}`,
    "",
    "What are you vouching for?",
  ].join("\n");
}

export function buildResultPromptText(targetUsername: string): string {
  return [
    formatLabeledLine("Target", formatUsername(targetUsername)),
    "",
    "Choose the result.",
  ].join("\n");
}

export function buildTagPromptText(targetUsername: string, result: EntryResult, tags: EntryTag[]): string {
  return [
    formatLabeledLine("Target", formatUsername(targetUsername)),
    formatLabeledLine("Result", RESULT_LABELS[result]),
    formatLabeledLine("Tags", formatTagList(tags)),
    "",
    "Choose one or more tags, then tap Done.",
  ].join("\n");
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countByResult<T extends { result: EntryResult }>(entries: T[]) {
  return {
    positive: entries.filter((e) => e.result === "positive").length,
    mixed: entries.filter((e) => e.result === "mixed").length,
    negative: entries.filter((e) => e.result === "negative").length,
  };
}

function formatSummaryRow(counts: { positive: number; mixed: number; negative: number }): string {
  const e = BOT_COPY.resultEmoji;
  return `${e.positive} ${counts.positive}   ${e.mixed} ${counts.mixed}   ${e.negative} ${counts.negative}`;
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
    return `No vouches found for ${formatUsername(input.targetUsername)}.`;
  }

  const counts = countByResult(input.entries);
  const lines: string[] = [
    formatUsername(input.targetUsername),
    formatSummaryRow(counts),
    "",
  ];

  for (const entry of input.entries) {
    const emoji = BOT_COPY.resultEmoji[entry.result];
    const legacy = entry.source === "legacy_import" ? "  ·  Legacy" : "";
    lines.push(`${emoji}  ${RESULT_LABELS[entry.result]}  ·  ${formatDate(entry.createdAt)}${legacy}`);
    lines.push(`   ${formatUsername(entry.reviewerUsername)}`);
    lines.push(`   ${formatTagList(entry.tags)}`);
    lines.push(`   #${entry.id}`);
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
    return "No vouches yet.";
  }

  const counts = countByResult(entries);
  const lines: string[] = [
    "Recent vouches",
    formatSummaryRow(counts),
    "",
  ];

  for (const entry of entries) {
    const emoji = BOT_COPY.resultEmoji[entry.result];
    const legacy = entry.source === "legacy_import" ? "  ·  Legacy" : "";
    lines.push(`${emoji}  ${RESULT_LABELS[entry.result]}  ·  ${formatDate(entry.createdAt)}${legacy}`);
    lines.push(`   ${formatUsername(entry.reviewerUsername)}  →  ${formatUsername(entry.targetUsername)}`);
    lines.push(`   #${entry.id}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildLauncherText(): string {
  return BOT_COPY.launcher;
}

export function buildPinnedGuideText(): string {
  return BOT_COPY.pinnedGuide;
}

export function buildGroupLauncherReplyText(): string {
  return BOT_COPY.groupLauncherReply;
}

export function buildPublishedDraftText(targetUsername: string, result: EntryResult): string {
  return [
    "Posted to the group.",
    "",
    formatLabeledLine("Target", formatUsername(targetUsername)),
    formatLabeledLine("Result", RESULT_LABELS[result]),
  ].join("\n");
}

export function buildBotDescriptionText(): string {
  return BOT_COPY.description;
}

export function buildBotShortDescription(): string {
  return BOT_COPY.shortDescription;
}

export function buildAdminOnlyText(): string {
  return BOT_COPY.adminOnly;
}
