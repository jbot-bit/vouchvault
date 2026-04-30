// Inline-cards phase 2: pure card renderer.
//
// Renders a compact "vouch card" for inline-mode insertion. The card's
// structural shape is defined by CARD_GLYPHS in `forgeryDetector.ts` —
// importing the constants here keeps the renderer and the detector
// from drifting (a glyph swap fails the detector's regex tests AND the
// renderer's byte-stable tests).
//
// Length budget: ≤ 800 chars (Telegram inline result body) and ≤ 3900
// chars hard cap (matches v9 lookup ceiling). Long histories truncate
// to the 3 most-recent excerpts; footer reads
// "…N more — DM /lookup @<target> for full audit".
//
// Footer rotation: deterministic on (targetId, dayBucket(now)) so that
// repeat queries within a day return a stable card body (Telegram
// caches inline results regardless; we want stability for the
// chosen_inline_results content_hash too).
//
// See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md §4.

import { CARD_GLYPHS, hashCardBody } from "./forgeryDetector.ts";

export const INLINE_CARD_BODY_CAP = 800;

const FOOTER_POOL = [
  "_via @VouchVaultBot · DM /lookup for full audit_",
  "_full audit: DM the bot · /lookup @<target>_",
  "_more in DM — /lookup @<target>_",
  "_via @VouchVaultBot_",
] as const;

function fmtDateUtc(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function dayBucket(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

function pickFooter(targetId: number, now: Date): string {
  // Stable hash: target id + day bucket → footer index.
  const seed = (targetId ^ dayBucket(now)) >>> 0;
  return FOOTER_POOL[seed % FOOTER_POOL.length]!;
}

function truncateExcerpt(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export type ArchiveRowForCard = {
  reviewerUsername: string;
  result: "POS" | "NEG" | "MIX";
  bodyText: string | null;
  createdAt: Date;
};

export type InlineCardInput = {
  targetUsername: string;
  targetId: number;
  archiveRows: Array<ArchiveRowForCard>;
  now: Date;
};

export type InlineCardResult = {
  text: string;
  contentHash: string;
};

// Returns null when the target has no archive rows (caller renders a
// "no record" hint instead of an insertable result).
export function renderInlineCard(input: InlineCardInput): InlineCardResult | null {
  if (input.archiveRows.length === 0) return null;

  const total = input.archiveRows.length;
  const pos = input.archiveRows.filter((r) => r.result === "POS").length;
  // POS / NEG / MIX — bucket NEG+MIX into the warn count for the
  // member-flavour card (private NEGs aren't surfaced; member view).
  const warn = total - pos;

  const span = computeSpan(input.archiveRows);
  const headerLine = `${CARD_GLYPHS.board} @${input.targetUsername} ${CARD_GLYPHS.emDash} ${pos} ${CARD_GLYPHS.pos} ${CARD_GLYPHS.middot} ${warn} ${CARD_GLYPHS.warn} (${total} over ${span})`;

  // Most-recent first. Show 3.
  const sorted = [...input.archiveRows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const shown = sorted.slice(0, 3);
  const hidden = total - shown.length;

  const bulletLines = shown.map((r) => {
    const date = fmtDateUtc(r.createdAt);
    const excerpt = truncateExcerpt(r.bodyText ?? "");
    const glyph = r.result === "POS" ? CARD_GLYPHS.pos : CARD_GLYPHS.warn;
    const body = excerpt.length > 0 ? `"${excerpt}"` : "(no comment)";
    return `${CARD_GLYPHS.middot} ${date} @${r.reviewerUsername} ${CARD_GLYPHS.emDash} ${body} ${glyph}`;
  });

  const footerTemplate = pickFooter(input.targetId, input.now);
  const footer = footerTemplate.replace("<target>", input.targetUsername);

  const moreLine =
    hidden > 0
      ? `…${hidden} more — DM /lookup @${input.targetUsername} for full audit`
      : null;

  const parts = [headerLine, "", ...bulletLines];
  if (moreLine) parts.push(moreLine);
  parts.push("", footer);

  let text = parts.join("\n");
  // Hard cap: trim from the bottom of the bullet list if we somehow
  // bust 800 (shouldn't happen for 3 excerpts of 80 chars each, but
  // safety belt).
  if (text.length > INLINE_CARD_BODY_CAP) {
    text = text.slice(0, INLINE_CARD_BODY_CAP - 1) + "…";
  }

  return { text, contentHash: hashCardBody(text) };
}

function computeSpan(rows: Array<ArchiveRowForCard>): string {
  if (rows.length === 0) return "0 days";
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const earliest = sorted[0]!.createdAt;
  const latest = sorted[sorted.length - 1]!.createdAt;
  const days = Math.max(
    1,
    Math.round((latest.getTime() - earliest.getTime()) / 86_400_000),
  );
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months`;
  const years = Math.round(days / 365);
  return `${years} years`;
}
