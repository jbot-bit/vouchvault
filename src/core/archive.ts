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
  // V3.5.2 / v6 §4.3: free-form prose body collection. Inserted
  // between tags (or admin_note for NEG) and preview when the
  // multi-bot/channel-relay flow is active. When VV_RELAY_ENABLED is
  // false the wizard skips this step and goes straight to preview.
  "awaiting_prose",
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

// V3.5.2 / v6 §4.3 — free-form vouch prose body. After HTML-escape
// worst case (~5×) 800 chars lands at ~4000 chars + footer ~10, well
// under the 4096 ceiling and the 3900 safety margin in withCeiling.
export const MAX_VOUCH_PROSE_CHARS = 800;

export type ValidateVouchProseResult =
  | { ok: true; value: string }
  | {
      ok: false;
      reason:
        | "empty"
        | "too_long"
        | "control_chars"
        | "non_text"
        | "has_entities";
    };

// Validates the free-form prose body for a V3.5 vouch.
// - Reject empty / whitespace-only.
// - Reject > MAX_VOUCH_PROSE_CHARS.
// - Reject ASCII control chars except newline (\n) and tab (\t).
//
// Caller is responsible for the non-text + has-entities checks
// against the Telegram Message envelope (`message.entities` present,
// `message.photo`/`message.sticker`/`message.voice` etc.) since those
// require the full message object, not just text.
export function validateVouchProse(input: string): ValidateVouchProseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_VOUCH_PROSE_CHARS) return { ok: false, reason: "too_long" };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, reason: "control_chars" };
  }
  return { ok: true, value: trimmed };
}

// Pure helper — inspects a Telegram Message and decides whether it's
// a valid plain-text input for the prose step. Caller still passes
// the text through validateVouchProse for length/content checks.
export function classifyVouchProseMessage(message: {
  text?: unknown;
  entities?: ReadonlyArray<unknown> | null;
  caption?: unknown;
  photo?: unknown;
  document?: unknown;
  voice?: unknown;
  video?: unknown;
  video_note?: unknown;
  sticker?: unknown;
  animation?: unknown;
  audio?: unknown;
  contact?: unknown;
  location?: unknown;
  poll?: unknown;
}):
  | { kind: "text"; text: string }
  | { kind: "non_text" }
  | { kind: "has_entities" } {
  // Any non-text body type means the user sent media / sticker / etc.
  if (
    message.photo != null ||
    message.document != null ||
    message.voice != null ||
    message.video != null ||
    message.video_note != null ||
    message.sticker != null ||
    message.animation != null ||
    message.audio != null ||
    message.contact != null ||
    message.location != null ||
    message.poll != null ||
    typeof message.caption === "string"
  ) {
    return { kind: "non_text" };
  }
  if (typeof message.text !== "string") {
    return { kind: "non_text" };
  }
  // Reject any formatting entity (bold, italic, link, etc.). The
  // published surface stays unstyled prose, matching TBC26's actual
  // vouch shape (KB:F2.10–F2.11).
  if (Array.isArray(message.entities) && message.entities.length > 0) {
    return { kind: "has_entities" };
  }
  return { kind: "text", text: message.text };
}

// Locked V3.5 wizard rejection messages for the prose step.
export function buildVouchProseRejectionText(
  reason:
    | "empty"
    | "too_long"
    | "control_chars"
    | "non_text"
    | "has_entities",
): string {
  switch (reason) {
    case "empty":
      return "Send a short message describing the vouch — please don't leave it blank.";
    case "too_long":
      return `Keep it under <b>${MAX_VOUCH_PROSE_CHARS} characters</b> please — say less.`;
    case "control_chars":
      return "Plain text only — control characters not allowed.";
    case "non_text":
      return "Plain text only please. No photos, stickers, voice, or media.";
    case "has_entities":
      return "Plain text — no formatting, links, or mentions please.";
  }
}

export const DEFAULT_DUPLICATE_COOLDOWN_HOURS = 72;
export const DEFAULT_DRAFT_TIMEOUT_HOURS = 24;
export const MAX_LOOKUP_ENTRIES = 5;
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
// post is sent. NEG entries are private — they contribute to /search
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
    "Use the search bar at the top of the group to look up anyone's @username. Every published vouch is searchable in the group.",
    "",
    "<b><u>Chat moderation</u></b>",
    "Posts that look like buy/sell arrangements, or that try to publish a vouch outside the bot, are auto-removed. Contact an admin if you think this happened in error.",
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
    "Use the search bar at the top of this group to look up anyone's @username. Every published vouch is searchable here.",
    "",
    "<b><u>Chat moderation</u></b>",
    "Posts that look like buy/sell arrangements, or that try to publish a vouch outside the bot, are auto-removed. Contact an admin if you think this happened in error.",
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

// ---- V3.5 (impenetrable architecture v6) locked-text additions ----
//
// These are tested via archiveUx.test.ts for byte-stable output. Any
// drift requires a V3.5 spec amendment first. See
// docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md
// V3.5 amendment.

// Wizard prompt for the free-form prose body (V3.5.2). Inserted after
// tags, before preview, when the multi-bot/relay flow is active.
export function buildVouchProsePromptText(): string {
  return [
    "<b>Last step — write the vouch</b>",
    "",
    "Send a short message describing the vouch in your own words. Plain text only — no formatting, no links, no media.",
    "",
    "<b>Keep it under 800 characters.</b>",
  ].join("\n");
}

// V3.5 preview shape (V3.5.2 / v6 §4.4). The published surface drops
// the V3 templated heading; structured fields render only via /search.
// Heading is <i>Preview</i> per spec (distinct from V3's <b><u>Preview</u></b>
// so the wizard's prose-mode preview is visually distinguishable from
// the V3 structured-mode preview during the rollout window).
export function buildPreviewTextV35(input: {
  bodyTextEscaped: string;
  entryId: number;
}): string {
  return [
    "<i>Preview</i>",
    "",
    input.bodyTextEscaped,
    "",
    `<code>#${input.entryId}</code>`,
  ].join("\n");
}

// V3.5 published-draft confirmation including channel post URL.
export function buildPublishedDraftTextWithUrl(input: {
  entryId: number;
  channelPostUrl: string;
}): string {
  return [
    "<b>✓ Posted to the group</b>",
    "",
    `<code>#${input.entryId}</code>`,
    "",
    `<a href="${input.channelPostUrl}">View in channel</a>`,
  ].join("\n");
}

// V3.5 lookup bot @BotFather profile copy.
export function buildLookupBotShortDescription(): string {
  return "Search vouches by @username. Read-only lookup bot for the Vouch Hub community.";
}

export function buildLookupBotDescription(): string {
  return [
    "Read-only lookup for the Vouch Hub community.",
    "",
    "Use the search bar at the top of the group to look up anyone's @username — every published vouch is searchable there.",
    "",
    "I never post vouches and never DM members on my own.",
  ].join("\n");
}

// V3.5 admin bot @BotFather profile copy.
export function buildAdminBotShortDescription(): string {
  return "Admin tooling for the Vouch Hub. Restricted access — operator commands only.";
}

export function buildAdminBotDescription(): string {
  return [
    "Operator-only admin bot for the Vouch Hub.",
    "",
    "Handles freeze/unfreeze/audit commands and chat-moderation in the supergroup. If you are not an admin, none of my commands will work — that's intentional.",
  ].join("\n");
}

// V3.5 account-age guard rejection (V3.5.3).
export function buildAccountTooNewText(hoursRemaining: number): string {
  const noun = hoursRemaining === 1 ? "hour" : "hours";
  return [
    "<b>Please come back later</b>",
    "",
    `We wait for new accounts to establish before allowing vouches. Try again in <b>${hoursRemaining} ${noun}</b>.`,
  ].join("\n");
}

// V3.5 chat-moderation DM warning (V3.5 §8.4). Refactor of inline
// strings previously hardcoded in chatModeration.ts. Locked-text
// discipline lets us assert these via archiveUx.test.ts.
export function buildModerationWarnText(input: {
  groupName: string;
  hitSource: string; // e.g. "phrase", "regex_buy_shape", "regex_vouch_for_username", "compound_buy_solicit"
  adminBotUsername?: string | null;
}): string {
  const escapedGroup = escapeHtml(input.groupName);
  if (input.hitSource.startsWith("regex_vouch_")) {
    return `Your message in <b>${escapedGroup}</b> was removed. Vouches must go through the bot — tap <b>Submit Vouch</b> in the group to start the DM flow. Posting vouch-shaped text in chat is auto-removed.`;
  }
  const adminPointer =
    input.adminBotUsername && input.adminBotUsername.length > 0
      ? `DM <code>@${escapeHtml(input.adminBotUsername)}</code>`
      : "contact an admin";
  return `Your message in <b>${escapedGroup}</b> was removed. Posts that look like buy/sell arrangements are auto-removed. If you believe this was a mistake, ${adminPointer}.`;
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
    "/search @x — entry totals + recent vouches",
    "/lookup @x — full audit list",
    "/pause — pause new vouches",
    "/unpause — resume vouches",
  ].join("\n");
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
