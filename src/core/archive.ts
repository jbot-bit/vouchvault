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

export const MAX_LOOKUP_ENTRIES = 15;
export const LOOKUP_PREVIEW_ENTRIES = 5;

// callback_data format for "expand to all" button.
// "lk:a:<lower-username>" — "a" = all. Username is the canonical lowercase
// stripped form (max 32 chars + "lk:a:" 5 chars = 37 bytes < 64).
export function buildLookupExpandCallback(username: string): string {
  return `lk:a:${username.replace(/^@+/, "").toLowerCase().slice(0, 32)}`;
}

export function parseLookupExpandCallback(data: string): string | null {
  if (!data.startsWith("lk:a:")) return null;
  const u = data.slice("lk:a:".length);
  return /^[a-z0-9_]{5,32}$/.test(u) ? u : null;
}
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

const DEFAULT_RULES_TEXT = [
  "<b>Rules</b>",
  "• Telegram ToS — no illegal, no scams",
  "• Vouch only people you know personally",
  "• No personal opinions, no rating, no minors",
  "• Report ToS violations to @notoscam",
].join("\n");

function rulesLine(): string {
  // Welcome and pinned guide both embed this. Override via BOT_RULES_TEXT
  // env. Documents the scope a Telegram T&S reviewer would see if they
  // arrive at the chat profile from a hostile report.
  return envOverride("BOT_RULES_TEXT") ?? DEFAULT_RULES_TEXT;
}

// v9 locked-text. Members post vouches as normal group messages; the bot
// is a search + moderation tool, not a publisher. DM /lookup @user
// searches the legacy archive. Native in-group search covers new posts.

// Policy text. Self-contained — no external URL, no public hosting,
// no third-party indexing surface. Delivered via DM /policy and
// pinnable as a group message. Owner directive: "isn't a public link
// risky? we can upload in the group ffs" — the in-Telegram surface
// is the only surface.
export function buildPolicyText(): string {
  return [
    "<b>Policy + data handling</b>",
    "",
    "I'm an automated read-only lookup tool. Members post vouches in the group; I don't write or solicit any.",
    "",
    "<b>What I store:</b> Telegram <code>user_id</code> + @username for members who interact, plus the vouch entries posted in the group (timestamp, reviewer, target, body, tags).",
    "",
    "<b>Deletion:</b> DM <code>/forgetme</code> to delete vouches you authored + your account record. Vouches other members wrote about you stay — that's their words, not your data.",
    "",
    "<b>Telegram's policies apply too:</b>",
    "• Terms of Service — https://telegram.org/tos",
    "• Privacy Policy — https://telegram.org/privacy",
    "• Bot Terms — https://telegram.org/tos/bots",
    "",
    "<b>Report abuse:</b> Telegram ToS violations → @notoscam (the official channel).",
  ].join("\n");
}

// Env override pattern. Same as BOT_DESCRIPTION / BOT_SHORT_DESCRIPTION.
// Set BOT_WELCOME_TEXT / BOT_PINNED_GUIDE_TEXT in Railway to override
// without touching code. HTML supported (<b>, <code>, <i>, <u>, <a>).
// Use \n for line breaks. Empty / unset → falls back to the spec-locked
// default below.
function envOverride(key: string): string | null {
  const v = process.env[key];
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed.replace(/\\n/g, "\n") : null;
}

const DEFAULT_WELCOME_TEXT = [
  "<b>SC45</b>",
  "",
  "🔍 Search vouches → <code>/search @username</code>",
  "🗑 Delete yours → <code>/forgetme</code>",
  "📄 Data + policy → <code>/policy</code>",
  "",
  "<b>How to vouch</b>",
  "Post in the group. Tag the @, say what happened. Keep it factual.",
  "",
  "<b>Moderation</b>",
  "Commercial-shaped posts auto-delete. Hit <code>/start</code> once so I can ping you if yours gets removed.",
].join("\n");

const DEFAULT_PINNED_GUIDE_TEXT = [
  "<b>SC45</b>",
  "",
  "🔍 Search vouches → DM me <code>/search @username</code>",
  "🗑 Delete yours → DM <code>/forgetme</code>",
  "📄 Data + policy → DM <code>/policy</code>",
  "",
  "<b>How to vouch</b>",
  "Post in this group. Tag the @, say what happened. Keep it factual.",
  "",
  "<b>Moderation</b>",
  "Commercial-shaped posts auto-delete. DM me <code>/start</code> once so I can ping you if yours gets removed.",
].join("\n");

export function buildWelcomeText(): string {
  const body = envOverride("BOT_WELCOME_TEXT") ?? DEFAULT_WELCOME_TEXT;
  return `${body}\n\n${rulesLine()}`;
}

export function buildPinnedGuideText(): string {
  const body = envOverride("BOT_PINNED_GUIDE_TEXT") ?? DEFAULT_PINNED_GUIDE_TEXT;
  return `${body}\n\n${rulesLine()}`;
}

export function buildBotDescriptionText(): string {
  return [
    "SC45 vouch lookup.",
    "",
    "DM /search @username — search community vouches.",
    "DM /policy — what's stored, how to delete.",
    "DM /forgetme — delete vouches you've written.",
    "",
    "Read-only. Members post vouches in the group; the bot doesn't write or DM on its own.",
  ].join("\n");
}

export function buildBotShortDescription(): string {
  return "SC45 — DM /search @username to search community vouches.";
}

const SAFE_LIMIT = 3900;
const BODY_PREVIEW_CHARS = 200;

// Truncate vouch body for inline display in /search results. Collapses
// internal whitespace, takes first N chars, appends ellipsis if cut.
function truncateBody(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (cleaned.length <= BODY_PREVIEW_CHARS) return cleaned;
  return cleaned.slice(0, BODY_PREVIEW_CHARS).trimEnd() + "…";
}

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
  // Summary counts (already filtered to whatever the viewer is allowed to
  // see — admins get full counts, members get POS+MIX only). Caller is
  // responsible for the filtering math.
  counts: {
    total: number;
    positive: number;
    mixed: number;
    negative: number;
    firstAt?: Date | null;
    lastAt?: Date | null;
    recentCount?: number;
    distinctReviewers?: number;
    // Vouches AUTHORED by this user (where they're the reviewer of
    // someone else). Lets the reader see how active they've been
    // reviewing others.
    authoredCount?: number;
  };
  entries: Array<{
    id: number;
    reviewerUsername: string;
    result: EntryResult;
    tags: EntryTag[];
    createdAt: Date;
    source?: EntrySource;
    privateNote?: string | null;
    bodyText?: string | null;
  }>;
  // "preview" → show first LOOKUP_PREVIEW_ENTRIES + "see all" hint trailer
  // "all" → show all entries (capped by Telegram char ceiling)
  mode?: "preview" | "all";
}): string {
  const heading = `<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`;
  const statusLine = fmtStatusLine(input.isFrozen, input.freezeReason);
  const mode = input.mode ?? "preview";

  if (input.counts.total === 0) {
    const lines = [heading, statusLine, "", `No vouches for ${fmtUser(input.targetUsername)}.`];
    if (
      typeof input.counts.authoredCount === "number" &&
      input.counts.authoredCount > 0
    ) {
      const noun = input.counts.authoredCount === 1 ? "vouch" : "vouches";
      lines.push(
        `<i>Authored: ${input.counts.authoredCount} ${noun} by ${fmtUser(
          input.targetUsername,
        )} about other members</i>`,
      );
    }
    return lines.join("\n");
  }

  // Summary lines.
  // Line 1: total count + result breakdown.
  // Line 2: freshness — last vouch date, recent-window count,
  //         distinct-reviewer count. Lets the reader judge whether the
  //         account is currently active or just historically vouched.
  //         A profile with 50 lifetime vouches but zero in the last
  //         year is not the same as one with 12 in the last 6 months.
  const breakdown: string[] = [];
  if (input.counts.positive > 0) breakdown.push(`✅ ${input.counts.positive} POS`);
  if (input.counts.mixed > 0) breakdown.push(`⚖️ ${input.counts.mixed} MIX`);
  if (input.counts.negative > 0) breakdown.push(`⚠️ ${input.counts.negative} NEG`);
  const totalNoun = input.counts.total === 1 ? "vouch" : "vouches";
  const summaryLine = `<b>${input.counts.total} ${totalNoun}</b>${
    breakdown.length > 0 ? ` — ${breakdown.join(" · ")}` : ""
  }`;

  const freshnessParts: string[] = [];
  if (input.counts.lastAt) {
    freshnessParts.push(`Last: ${fmtDate(input.counts.lastAt)}`);
  }
  if (
    typeof input.counts.recentCount === "number" &&
    input.counts.total > 0
  ) {
    const r = input.counts.recentCount;
    freshnessParts.push(`Recent (12mo): ${r}`);
  }
  if (
    typeof input.counts.distinctReviewers === "number" &&
    input.counts.distinctReviewers > 0
  ) {
    const d = input.counts.distinctReviewers;
    freshnessParts.push(`${d} distinct reviewer${d === 1 ? "" : "s"}`);
  }
  const freshnessLine = freshnessParts.length > 0 ? freshnessParts.join(" · ") : null;

  // Authored line: separate from "vouches FOR them" so the trust signal
  // stays the headline. Only shown when non-zero so members with no
  // outgoing vouches don't get a confusing "Authored: 0".
  const authoredLine =
    typeof input.counts.authoredCount === "number" && input.counts.authoredCount > 0
      ? `<i>Authored: ${input.counts.authoredCount} vouch${
          input.counts.authoredCount === 1 ? "" : "es"
        } by ${fmtUser(input.targetUsername)} about other members</i>`
      : null;

  const visibleEntries =
    mode === "preview" ? input.entries.slice(0, LOOKUP_PREVIEW_ENTRIES) : input.entries;
  const lines = [heading, statusLine, summaryLine];
  if (freshnessLine) lines.push(freshnessLine);
  if (authoredLine) lines.push(authoredLine);
  lines.push("");
  for (const entry of visibleEntries) {
    const sourceTag = entry.source === "legacy_import" ? " [Legacy]" : "";
    lines.push(`<b>#${entry.id}</b>${escapeHtml(sourceTag)} — ${fmtResult(entry.result)}`);
    lines.push(`By ${fmtUser(entry.reviewerUsername)} • ${fmtDate(entry.createdAt)}`);
    if (entry.bodyText && entry.bodyText.trim().length > 0) {
      lines.push(`<i>${escapeHtml(truncateBody(entry.bodyText))}</i>`);
    }
    if (entry.tags.length > 0) {
      lines.push(`<b>Tags:</b> ${fmtTags(entry.tags)}`);
    }
    if (entry.privateNote && entry.privateNote.length > 0) {
      lines.push(`<i>Note:</i> ${escapeHtml(entry.privateNote)}`);
    }
    lines.push("");
  }

  return withCeiling(lines, 0);
}

// Returns the inline-keyboard for /search responses, or null if no
// expand button should be shown (preview mode + total fits in preview,
// or already in all mode).
export function buildLookupReplyMarkup(input: {
  targetUsername: string;
  totalShown: number;
  totalAvailable: number;
  mode: "preview" | "all";
}): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | null {
  if (input.mode === "all") return null;
  if (input.totalAvailable <= input.totalShown) return null;
  return {
    inline_keyboard: [
      [
        {
          text: `📋 See all ${input.totalAvailable} vouches`,
          callback_data: buildLookupExpandCallback(input.targetUsername),
        },
      ],
    ],
  };
}

export function buildAdminOnlyText(): string {
  return "<b>Admin only.</b>";
}

// Lookup-bot @BotFather profile copy. Read-only; never posts.
export function buildLookupBotShortDescription(): string {
  return "SC45 — read-only search. DM /search @username.";
}

export function buildLookupBotDescription(): string {
  return [
    "SC45 read-only search.",
    "",
    "DM /search @username to search community vouches. The bot doesn't write or DM on its own.",
  ].join("\n");
}

// Admin-bot @BotFather profile copy.
export function buildAdminBotShortDescription(): string {
  return "SC45 admin tooling. Restricted — operator commands only.";
}

export function buildAdminBotDescription(): string {
  return [
    "SC45 operator-only admin bot.",
    "",
    "Freeze/unfreeze/audit + chat moderation. Non-admin commands are no-ops by design.",
  ].join("\n");
}

// Account-age guard rejection — kept for the moderation/welcome path even
// after wizard removal, in case future surfaces re-enable an age check.
export function buildAccountTooNewText(hoursRemaining: number): string {
  const noun = hoursRemaining === 1 ? "hour" : "hours";
  return [
    "<b>Please come back later</b>",
    "",
    `We wait for new accounts to establish before allowing posts. Try again in <b>${hoursRemaining} ${noun}</b>.`,
  ].join("\n");
}

// Chat-moderation DM warning. v9: there is no "Submit Vouch" launcher
// anymore; vouches are normal group messages. The vouch-shape branch
// still refers a member back into the group rather than into a wizard.
export function buildModerationWarnText(input: {
  groupName: string;
  hitSource: string; // e.g. "phrase", "regex_buy_shape", "regex_vouch_for_username", "compound_buy_solicit"
  adminBotUsername?: string | null;
}): string {
  const escapedGroup = escapeHtml(input.groupName);
  if (input.hitSource.startsWith("regex_vouch_")) {
    return `Your message in <b>${escapedGroup}</b> was removed. Post your vouch as a normal message in the group — keep it factual and mention the @username plainly.`;
  }
  const adminPointer =
    input.adminBotUsername && input.adminBotUsername.length > 0
      ? `DM <code>@${escapeHtml(input.adminBotUsername)}</code>`
      : "contact an admin";
  return `Your message in <b>${escapedGroup}</b> was removed by automated moderation. To appeal, ${adminPointer}.`;
}

export function buildDbStatsText(input: {
  statusCounts: Array<{ status: string; count: number }>;
  profileCount: number;
  sampleTargets: string[];
  sampleProfiles: string[];
  nonLowercaseTargets: number;
  atPrefixedTargets: number;
}): string {
  const totalEntries = input.statusCounts.reduce((sum, row) => sum + row.count, 0);
  const lines: string[] = ["<b>DB stats</b>", ""];
  lines.push(`<b>vouch_entries:</b> ${totalEntries} total`);
  if (input.statusCounts.length === 0) {
    lines.push("  (no rows)");
  } else {
    for (const row of input.statusCounts) {
      lines.push(`  • ${escapeHtml(row.status)}: ${row.count}`);
    }
  }
  lines.push("");
  lines.push(`<b>business_profiles:</b> ${input.profileCount}`);
  lines.push("");
  if (input.sampleTargets.length > 0) {
    lines.push("<b>sample target_username (first 5):</b>");
    for (const t of input.sampleTargets) {
      lines.push(`  • <code>${escapeHtml(t)}</code>`);
    }
    lines.push("");
  }
  if (input.sampleProfiles.length > 0) {
    lines.push("<b>sample profile.username (first 5):</b>");
    for (const u of input.sampleProfiles) {
      lines.push(`  • <code>${escapeHtml(u)}</code>`);
    }
    lines.push("");
  }
  if (input.nonLowercaseTargets > 0) {
    lines.push(
      `⚠ ${input.nonLowercaseTargets} entries have non-lowercase target_username (LOWER() match still works).`,
    );
  }
  if (input.atPrefixedTargets > 0) {
    lines.push(
      `⚠ ${input.atPrefixedTargets} entries have target_username starting with '@' (LTRIM match still works).`,
    );
  }
  if (totalEntries === 0) {
    lines.push("");
    lines.push(
      "❗ No vouch_entries rows. Either DATABASE_URL points at a fresh DB, or legacy import never ran. Check Railway env + run <code>npm run replay:legacy</code>.",
    );
  }
  return lines.join("\n");
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
    "/search @x — full audit list (alias: /lookup)",
    "/pause — pause new vouches",
    "/unpause — resume vouches",
    "/dbstats — DB diagnostics (entry counts, status breakdown)",
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
    lines.push(`…and ${rows.length - 10} more — refine with /search @x`);
  }
  // Defensive char-ceiling pass — caps at 4096 even if pathological reasons
  // push the visible 10-row block over budget (10 × ~200-char reason ≈ 2500
  // chars in practice, but the wrapper protects future label changes).
  return withCeiling(lines, 0);
}
