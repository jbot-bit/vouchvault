export const ENTRY_TYPES = ["service", "item", "product"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_RESULTS = ["positive", "mixed", "negative"] as const;
export type EntryResult = (typeof ENTRY_RESULTS)[number];

export const ENTRY_SOURCES = ["live", "legacy_import"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_STATUSES = ["pending", "publishing", "published", "removed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

// Admin-template freeze reasons. Free-text reasons are an unnecessary
// reportable surface — a reason like "scammer who took my $500" is a
// claim a hostile target's friend could escalate. The five options below
// cover the cases that come up; the rendered label drops underscores.
export const FREEZE_REASONS = [
  "unmet_commitments",
  "community_concerns",
  "policy_violation",
  "at_member_request",
  "under_review",
] as const;
export type FreezeReason = (typeof FREEZE_REASONS)[number];

export const FREEZE_REASON_LABELS: Record<FreezeReason, string> = {
  unmet_commitments: "unmet commitments",
  community_concerns: "community concerns",
  policy_violation: "policy violation",
  at_member_request: "at member's request",
  under_review: "under review",
};

export function isFreezeReason(value: string | null | undefined): value is FreezeReason {
  return typeof value === "string" && (FREEZE_REASONS as readonly string[]).includes(value);
}

export const TAG_OPTIONS_BY_RESULT = {
  positive: ["good_comms", "efficient", "on_time", "good_quality"],
  mixed: ["mixed_comms", "some_delays", "acceptable_quality", "minor_issue"],
  negative: ["poor_comms", "late", "quality_issue", "item_mismatch"],
} as const;

export type EntryTag = (typeof TAG_OPTIONS_BY_RESULT)[keyof typeof TAG_OPTIONS_BY_RESULT][number];

export const DRAFT_STEPS = [
  "awaiting_target",
  "selecting_result",
  "selecting_tags",
  "awaiting_admin_note",
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

export const MAX_PRIVATE_NOTE_CHARS = 240;

export type ValidatePrivateNoteResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "too_long" | "control_chars" };

// Validates the optional admin-only note attached to a private NEG draft.
// Reject empty / whitespace-only (use Skip instead), reject > 240 chars,
// reject ASCII control characters except newline (\n) and tab (\t).
// Returns the trimmed value on success — that's what should be stored.
export function validatePrivateNote(input: string): ValidatePrivateNoteResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_PRIVATE_NOTE_CHARS) return { ok: false, reason: "too_long" };
  // \x00-\x08 and \x0B-\x1F covers all C0 controls except \t (0x09) and \n (0x0A).
  // \x7F is DEL.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, reason: "control_chars" };
  }
  return { ok: true, value: trimmed };
}

export const DEFAULT_DUPLICATE_COOLDOWN_HOURS = 72;
export const DEFAULT_DRAFT_TIMEOUT_HOURS = 24;
export const MAX_LOOKUP_ENTRIES = 5;
export const MAX_RECENT_ENTRIES = 10;
export const STALE_UPDATE_PROCESSING_MINUTES = 10;
export const PROCESSED_UPDATE_RETENTION_DAYS = 14;
export const MAINTENANCE_EVERY_N_UPDATES = 200;

// Telegram-reserved or bot-impersonation handles. Vouching any of these is
// rejected so a member can't lend false legitimacy by pointing at an
// official-looking @username.
export const RESERVED_TARGET_USERNAMES: ReadonlySet<string> = new Set([
  "telegram",
  "spambot",
  "botfather",
  "notoscam",
  "replies",
  "gif",
]);

// Marketplace-coded substrings derived from the QA-export lexicon scan
// (docs/runbook/opsec.md §6a). Any username containing one of these reads
// as marketplace-shaped to a Telegram T&S classifier and a hostile reporter.
// Substring match is case-insensitive. False-positive risk for legitimate
// usernames is essentially zero — none of these substrings are common in
// English handles.
export const MARKETPLACE_USERNAME_SUBSTRINGS: ReadonlyArray<string> = [
  "scammer", "scam_", "_scam",
  "vendor", "vendr",
  "_plug", "plug_",
  "_gear", "gear_", "supply", "supplier", "supplies",
  "seller", "_4sale", "4sale_", "for_sale",
  "dealer", "dealr",
  "trapper", "trapping", "trap_",
  "coke", "cocaine",
  "meth_", "_meth", "methhead",
  "weed", "kush", "bud_", "_bud",
  "oxy_", "_oxy", "perc_", "fent_", "_fent", "fentanyl",
  "xan_", "_xan", "xanax", "bars_",
  "mdma", "molly", "mandy", "pingers",
  "shrooms", "psilo",
  "lsd", "acid_", "_acid", "tabs_", "_tabs",
  "ket_", "ketamine",
  "legit_seller", "vouched_vendor", "approved_seller",
  // Chat-moderation phrase tokens that could appear in a vouch target's
  // username. Closes the evasion vector where @pm_me_now would otherwise
  // pass the deny-list and the bot would publish a vouch heading
  // containing 'pm me now' (chat-mod doesn't scan the bot's own posts;
  // this stops the artefact at the vouch-submission gate). See spec v4 §4.9.
  "pm_", "_pm",
  "selling", "_selling", "selling_",
  "buying", "_buying", "buying_",
  "wickr", "wickr_", "_wickr",
  "threema", "_threema",
  "wtb_", "_wtb",
  "wts_", "_wts",
  "wtt_", "_wtt",
  "hmu_", "_hmu",
];

export function isReservedTarget(username: string): boolean {
  const lower = username.trim().replace(/^@+/, "").toLowerCase();
  if (RESERVED_TARGET_USERNAMES.has(lower)) return true;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (botUsername && lower === botUsername) return true;
  for (const sub of MARKETPLACE_USERNAME_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}

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

// Returns true when this entry should be published to the host group as a
// visible message; false when the entry is recorded in the DB but no group
// post is sent. NEG entries are private — they contribute to /profile
// Caution status without producing a vendetta-fuel feed artefact.
export function shouldPublishToGroup(result: EntryResult): boolean {
  return result !== "negative";
}

export function isEntrySource(value: string | null | undefined): value is EntrySource {
  return value != null && ENTRY_SOURCES.includes(value as EntrySource);
}

export function isEntryTag(value: unknown): value is EntryTag {
  return (
    typeof value === "string" &&
    Object.values(TAG_OPTIONS_BY_RESULT).some((tags) => (tags as readonly string[]).includes(value))
  );
}

export function getAllowedTagsForResult(result: EntryResult): readonly EntryTag[] {
  return TAG_OPTIONS_BY_RESULT[result];
}

export function toggleTag(tags: EntryTag[], tag: EntryTag): EntryTag[] {
  return tags.includes(tag) ? tags.filter((value) => value !== tag) : [...tags, tag];
}

export function formatTagList(tags: EntryTag[]): string {
  if (tags.length === 0) {
    return "None";
  }

  return tags.map((tag) => TAG_LABELS[tag]).join(", ");
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtUser(username: string): string {
  return `<b>${escapeHtml(formatUsername(username))}</b>`;
}

function fmtResult(result: EntryResult): string {
  return `<b>${escapeHtml(RESULT_LABELS[result])}</b>`;
}

const RESULT_PREFIX: Record<EntryResult, string> = {
  positive: "POS",
  mixed: "MIX",
  negative: "NEG",
};

function fmtVouchHeading(result: EntryResult, targetUsername: string): string {
  return `<b>${RESULT_PREFIX[result]} Vouch &gt; ${escapeHtml(formatUsername(targetUsername))}</b>`;
}

function fmtTags(tags: EntryTag[]): string {
  return escapeHtml(formatTagList(tags));
}

export function fmtDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return escapeHtml(`${day}/${month}/${year}`);
}

export function fmtDateTime(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return escapeHtml(`${day}/${month}/${year} ${hours}:${minutes}`);
}

function fmtStatusLine(
  isFrozen: boolean,
  freezeReason: string | null,
  hasCaution: boolean = false,
): string {
  if (isFrozen) {
    // Frozen wins over Caution. If the stored reason matches a current enum
    // key, render the human label; legacy free-text rows (pre-enum) render
    // verbatim until cleared by /unfreeze. Either path is HTML-escaped.
    const label =
      freezeReason && isFreezeReason(freezeReason)
        ? FREEZE_REASON_LABELS[freezeReason]
        : (freezeReason ?? "no reason given");
    return `Status: Frozen — <i>${escapeHtml(label)}</i>`;
  }
  if (hasCaution) return "Status: Caution";
  return "Status: Active";
}

function rulesLine(): string {
  // Multi-bullet rules block. Used by welcome and pinned guide. Documents
  // the scope a Telegram T&S reviewer would see if they arrive at the chat
  // profile from a hostile report.
  return [
    "<b>Rules</b>",
    "• Follow Telegram's Terms of Service. No illegal activity, no scams.",
    "• Vouch only for members you actually know personally.",
    "• No personal opinions about people, no rating individuals, no vouching minors.",
    "• You are responsible for the accuracy of your own vouches.",
  ].join("\n");
}

// Compact single-line variant for bot description, which has a 512-char
// Telegram limit and can't carry the multi-bullet block. The pinned guide
// + chat description carry the full rules.
function rulesLineShort(): string {
  return "Follow Telegram's Terms of Service. Vouch only members you know personally. You are responsible for your vouches.";
}

function aboutLine(): string {
  return "A community vouch hub for members who personally know each other.";
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

  const lines: string[] = [
    fmtVouchHeading(input.result, input.targetUsername),
    `<b>From:</b> ${fmtUser(input.reviewerUsername)}`,
    `<b>Tags:</b> ${fmtTags(input.tags)}`,
  ];

  if (isLegacy && input.legacySourceTimestamp) {
    lines.push(`<b>Date:</b> ${fmtDate(input.legacySourceTimestamp)}`);
  }

  // Tap-to-copy reference token. Lets a community member long-press the
  // ID on iOS / tap on desktop to grab it for an admin DM, without having
  // to forward the post (group has restrict-saving / protect_content on).
  lines.push(`<code>#${input.entryId}</code>`);

  return lines.join("\n");
}

export function buildPreviewText(input: {
  reviewerUsername: string;
  targetUsername: string;
  result: EntryResult;
  tags: EntryTag[];
  privateNote?: string | null;
}): string {
  const lines = [
    "<b><u>Preview</u></b>",
    "",
    fmtVouchHeading(input.result, input.targetUsername),
    `<b>From:</b> ${fmtUser(input.reviewerUsername)}`,
    `<b>Tags:</b> ${fmtTags(input.tags)}`,
  ];
  if (input.privateNote && input.privateNote.length > 0) {
    lines.push("");
    lines.push(
      `<i>Admin-only note (not published):</i> ${escapeHtml(input.privateNote)}`,
    );
  }
  lines.push("");
  lines.push(
    "<i>By confirming, you declare you personally know this member and stand behind this vouch. You are responsible for what you submit.</i>",
  );
  return lines.join("\n");
}

export function buildWelcomeText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    "Vouch for members you personally know. The community helps each other find trustworthy people to deal with.",
    "",
    "<b><u>How to vouch</u></b>",
    "1. Tap <b>Submit Vouch</b> in the group.",
    "2. Send the target @username here.",
    "3. Choose result and tags.",
    "4. I post the entry back to the group.",
    "",
    "<b><u>Check before you deal</u></b>",
    "Type <code>/profile @username</code> in the group to see anyone's vouch history and current status.",
    "",
    "<b><u>Chat moderation</u></b>",
    "Posts that look like buy/sell arrangements are auto-removed and the poster is removed from the group. Contact an admin if you think this happened in error.",
    "Send <code>/start</code> to me once so I can DM you if a post of yours is removed.",
    "",
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
  return [`<b>Target saved:</b> ${fmtUser(targetUsername)}`, "", "What are you vouching for?"].join(
    "\n",
  );
}

export function buildResultPromptText(targetUsername: string): string {
  return [
    "<b>Step 2 of 3 — Result</b>",
    "",
    `<b>For:</b> ${fmtUser(targetUsername)}`,
    "",
    "Choose the result.",
  ].join("\n");
}

export function buildTagPromptText(
  targetUsername: string,
  result: EntryResult,
  tags: EntryTag[],
): string {
  return [
    "<b>Step 3 of 3 — Tags</b>",
    "",
    `<b>For:</b> ${fmtUser(targetUsername)}`,
    `<b>Vouch:</b> ${fmtResult(result)}`,
    `<b>Tags:</b> ${fmtTags(tags)}`,
    "",
    "Choose one or more tags, then tap <b>Done</b>.",
  ].join("\n");
}

const SAFE_LIMIT = 3900;

function withCeiling(lines: string[], more: number): string {
  let total = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (total + line.length + 1 > SAFE_LIMIT) {
      out.push(`…and ${lines.length - out.length + more} more.`);
      break;
    }
    out.push(line);
    total += line.length + 1;
  }
  return out.join("\n").trimEnd();
}

export function buildLookupText(input: {
  targetUsername: string;
  isFrozen: boolean;
  freezeReason: string | null;
  entries: Array<{
    id: number;
    reviewerUsername: string;
    result: EntryResult;
    tags: EntryTag[];
    createdAt: Date;
    source?: EntrySource;
    privateNote?: string | null;
  }>;
}): string {
  // /lookup is admin-only. Renders the per-entry audit list including the
  // private_note for NEG entries. Note text is HTML-escaped at the boundary.
  const heading = `<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`;
  const statusLine = fmtStatusLine(input.isFrozen, input.freezeReason);

  if (input.entries.length === 0) {
    return [heading, statusLine, "", `No entries for ${fmtUser(input.targetUsername)}.`].join("\n");
  }

  const lines = [heading, statusLine, ""];
  for (const entry of input.entries) {
    const sourceTag = entry.source === "legacy_import" ? " [Legacy]" : "";
    lines.push(`<b>#${entry.id}</b>${escapeHtml(sourceTag)} — ${fmtResult(entry.result)}`);
    lines.push(`By ${fmtUser(entry.reviewerUsername)} • ${fmtDate(entry.createdAt)}`);
    lines.push(`<b>Tags:</b> ${fmtTags(entry.tags)}`);
    if (entry.privateNote && entry.privateNote.length > 0) {
      lines.push(`<i>Note:</i> ${escapeHtml(entry.privateNote)}`);
    }
    lines.push("");
  }

  return withCeiling(lines, 0);
}

export function buildRecentEntriesText(
  entries: Array<{
    id: number;
    reviewerUsername: string;
    targetUsername: string;
    entryType: EntryType;
    result: EntryResult;
    createdAt: Date;
    source?: EntrySource;
  }>,
): string {
  if (entries.length === 0) {
    return "No entries yet.";
  }

  const lines = ["<b><u>Recent entries</u></b>", ""];
  for (const entry of entries) {
    const sourceTag = entry.source === "legacy_import" ? " [Legacy]" : "";
    lines.push(`<b>#${entry.id}</b>${escapeHtml(sourceTag)} — ${fmtResult(entry.result)}`);
    lines.push(
      `${fmtUser(entry.reviewerUsername)} → ${fmtUser(entry.targetUsername)} • ${fmtDate(entry.createdAt)}`,
    );
    lines.push("");
  }

  return withCeiling(lines, 0);
}

export function buildLauncherText(): string {
  return ["<b>Submit a vouch</b>", "Tap below to open the short DM form."].join("\n");
}

export function buildPinnedGuideText(): string {
  return [
    "<b>Welcome to the Vouch Hub</b>",
    "",
    "Vouch for members you personally know. The community helps each other find trustworthy people to deal with.",
    "",
    "<b><u>How to vouch</u></b>",
    "1. Tap <b>Submit Vouch</b> below.",
    "2. In DM, send only the target @username, then use the buttons.",
    "3. I post the final entry back here.",
    "",
    "<b><u>Check before you deal</u></b>",
    "Type <code>/profile @username</code> here to see anyone's vouch history and current status.",
    "",
    "<b><u>Chat moderation</u></b>",
    "Posts that look like buy/sell arrangements are auto-removed and the poster is removed from the group. Contact an admin if you think this happened in error.",
    "Send <code>/start</code> to me once so I can DM you if a post of yours is removed.",
    "",
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
    fmtVouchHeading(result, targetUsername),
  ].join("\n");
}

export function buildBotDescriptionText(): string {
  return [
    "A community vouch hub for members who personally know each other. Log honest vouches; help others find trustworthy people to deal with.",
    "",
    "How it works: Tap Submit Vouch in the group, DM the bot one @username, choose result + tags, I post a clean entry back to the group.",
    "",
    rulesLineShort(),
  ].join("\n");
}

export function buildBotShortDescription(): string {
  return "Vouch Hub — community vouches between members who know each other. Open from the group launcher.";
}

export function buildAdminOnlyText(): string {
  return "<b>Admin only.</b>";
}

export function buildAdminHelpText(): string {
  return [
    "<b><u>Admin commands</u></b>",
    "",
    "/freeze @x [reason] — block new entries",
    "/unfreeze @x — allow entries again",
    "/frozen_list — show frozen profiles",
    "/remove_entry &lt;id&gt; — delete an entry",
    "/recover_entry &lt;id&gt; — clear stuck publishing",
    "/profile @x — entry totals",
    "/lookup @x — full audit list",
    "/pause — pause new vouches",
    "/unpause — resume vouches",
  ].join("\n");
}

export function buildProfileText(input: {
  targetUsername: string;
  totals: { positive: number; mixed: number; negative: number };
  isFrozen: boolean;
  freezeReason: string | null;
  recent: Array<{ id: number; result: EntryResult; createdAt: Date }>;
  hasCaution: boolean;
}): string {
  // Member-visible profile. The Negative count is hidden — admins still see
  // it via /lookup, which renders the full per-entry audit list including
  // the private_note column. NEG entries in `recent` are also filtered so a
  // member can't infer the count by listing.
  const lines = [
    `<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`,
    `Positive: ${input.totals.positive} • Mixed: ${input.totals.mixed}`,
    fmtStatusLine(input.isFrozen, input.freezeReason, input.hasCaution),
  ];
  const visible = input.recent.filter((r) => r.result !== "negative");
  if (visible.length > 0) {
    lines.push("");
    lines.push("<b>Last 5 entries</b>");
    for (const r of visible) {
      lines.push(`<b>#${r.id}</b> — ${fmtResult(r.result)} • ${fmtDate(r.createdAt)}`);
    }
  }
  return withCeiling(lines, 0);
}

export function buildFrozenListText(
  rows: Array<{ username: string; freezeReason: string | null; frozenAt: Date | null }>,
): string {
  if (rows.length === 0) {
    return "No frozen profiles.";
  }
  const visibleRows = rows.slice(0, 10);
  const lines = ["<b><u>Frozen profiles</u></b>", ""];
  for (const row of visibleRows) {
    const date = row.frozenAt ? fmtDate(row.frozenAt) : "unknown";
    const reason = row.freezeReason
      ? `<i>${escapeHtml(row.freezeReason)}</i>`
      : "<i>no reason given</i>";
    lines.push(`${fmtUser(row.username)} — frozen ${date} — ${reason}`);
  }
  if (rows.length > 10) {
    lines.push("");
    lines.push(`…and ${rows.length - 10} more — refine with /lookup @x`);
  }
  // Defensive char-ceiling pass — caps at 4096 even if pathological reasons
  // push the visible 10-row block over budget (10 × ~200-char reason ≈ 2500
  // chars in practice, but the wrapper protects future label changes).
  return withCeiling(lines, 0);
}
