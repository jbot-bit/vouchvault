// Converts the Telegram HTML export of a forwarded-vouches archive into
// the standard Telegram-export JSON shape so it can be fed through
// `npm run replay:legacy`. The HTML format is a "Vouch Monitor" bot's
// forwarded archive — every message is wrapped as a forwarded body with:
//   <div class="from_name">DisplayName<span title="DD.MM.YYYY HH:MM:SS UTC+TZ"> ...</span></div>
//   <div class="text">POS vouch <a href="https://t.me/target">@target</a> body</div>
//
// Reviewer @username isn't directly recoverable from display name, so we
// synthesise a stable id: `fwd_<sha1(displayname)[:10]>`. The synthetic
// from_id is derived from the same hash (range 1_000_000_000_000+).
//
// Output JSON shape mirrors `imports/suncoast_v1.json` so the existing
// import pipeline parses it without modification.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ExportMessage = {
  id: number;
  type: "message";
  date: string;
  date_unixtime: string;
  from: string;
  from_id: string;
  text: string;
};

type ExportRoot = {
  name: string;
  type: "private_supergroup";
  id: number;
  messages: ExportMessage[];
};

const FROM_NAME_RE =
  /<div class="forwarded body">[\s\S]*?<div class="from_name">\s*([\s\S]*?)<span[^>]*title="([^"]+)"/;
const FROM_NAME_NO_DATE_RE =
  /<div class="forwarded body">[\s\S]*?<div class="from_name">\s*([^<]+?)\s*<\/div>/;
const TEXT_RE = /<div class="forwarded body">[\s\S]*?<div class="text">\s*([\s\S]*?)\s*<\/div>/;
const MESSAGE_BLOCK_RE =
  /<div class="message default clearfix"[^>]*id="message(\d+)"[^>]*>([\s\S]*?)(?=<div class="message default|<\/div>\s*<\/body>)/g;
const HREF_USERNAME_RE = /<a href="https?:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})">/g;
const A_TAG_RE = /<a [^>]*>([\s\S]*?)<\/a>/g;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(BR_RE, "\n")
      .replace(A_TAG_RE, (_, inner) => inner)
      .replace(TAG_RE, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim(),
  );
}

function parseAusDate(s: string): Date | null {
  // "18.01.2025 08:58:27 UTC+10:00"
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+\-]\d{2}):(\d{2})/.exec(
    s,
  );
  if (!m || m.length < 9) return null;
  const dd = m[1]!;
  const mm = m[2]!;
  const yy = m[3]!;
  const hh = m[4]!;
  const mi = m[5]!;
  const ss = m[6]!;
  const tzH = m[7]!;
  const tzM = m[8]!;
  const offsetSign = tzH.startsWith("-") ? -1 : 1;
  const offsetMin = offsetSign * (Math.abs(parseInt(tzH, 10)) * 60 + parseInt(tzM, 10));
  const utcMs =
    Date.UTC(
      parseInt(yy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      parseInt(hh, 10),
      parseInt(mi, 10),
      parseInt(ss, 10),
    ) -
    offsetMin * 60 * 1000;
  return new Date(utcMs);
}

// Strip community-tag suffixes that members append to their Telegram
// display names. Same operator may appear as "Bridee Peebles SC" in
// one period and "Bridee Peebles" in another; strip so the slug is
// stable across that drift.
function stripCommunitySuffix(displayName: string): string {
  return displayName
    .replace(/\s+(SC|SCnew|SC\d+|sc|scnew)\s*$/i, "")
    .trim();
}

function syntheticReviewer(displayName: string): { username: string; fromId: number } {
  const cleaned = stripCommunitySuffix(displayName.trim());
  const hash = createHash("sha1").update(cleaned, "utf8").digest("hex");
  // Stable 10-char suffix; lowercase to match normalizeUsername.
  const username = `fwd_${hash.slice(0, 10)}`;
  // Base 1e12 ensures no collision with real Telegram user_ids (which are
  // typically <1e10 currently). Use first 11 hex chars → fits in safe int.
  const fromId = 1_000_000_000_000 + parseInt(hash.slice(0, 10), 16) % 999_999_999_999;
  return { username, fromId };
}

function main() {
  const baseDir =
    process.argv[2] ||
    `C:\\Users\\joshd\\Downloads\\Telegram Desktop\\ChatExport_2025-11-23`;
  const outPath = process.argv[3] || "imports/suncoast_forwards.json";

  if (!statSync(baseDir).isDirectory()) {
    throw new Error(`Not a directory: ${baseDir}`);
  }

  const htmlFiles = readdirSync(baseDir)
    .filter((f) => f.endsWith(".html"))
    .sort();

  if (htmlFiles.length === 0) {
    throw new Error(`No .html files in ${baseDir}`);
  }

  console.info(`[forwards-convert] Reading ${htmlFiles.length} HTML files from ${baseDir}`);

  const messages: ExportMessage[] = [];
  let stats = {
    total: 0,
    noFwd: 0,
    noText: 0,
    noDate: 0,
    parsed: 0,
  };

  for (const hf of htmlFiles) {
    const html = readFileSync(join(baseDir, hf), { encoding: "utf-8" });
    for (const m of html.matchAll(MESSAGE_BLOCK_RE)) {
      stats.total += 1;
      const id = parseInt(m[1]!, 10);
      const block = m[2]!;

      // Need a forwarded body — this is what makes it a vouch (vs a service message).
      const fromNameMatch = FROM_NAME_RE.exec(block) || FROM_NAME_NO_DATE_RE.exec(block);
      if (!fromNameMatch) {
        stats.noFwd += 1;
        continue;
      }
      const displayNameRaw = decodeEntities(fromNameMatch[1]!).trim();
      const dateRaw = fromNameMatch[2] ?? "";
      const date = parseAusDate(dateRaw);
      if (!date) {
        stats.noDate += 1;
        continue;
      }

      const textMatch = TEXT_RE.exec(block);
      if (!textMatch) {
        stats.noText += 1;
        continue;
      }
      const text = htmlToText(textMatch[1]!);
      if (!text) {
        stats.noText += 1;
        continue;
      }

      const { username, fromId } = syntheticReviewer(displayNameRaw);
      // Slugify the display name into a Telegram @-shape so the legacy
      // import uses it as reviewer_username. SC/SCnew suffix stripped
      // first (see stripCommunitySuffix). Falls back to the synthetic
      // fwd_<hash> when the display name has no usable letters.
      const slug = stripCommunitySuffix(displayNameRaw)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 32);
      const fromForExport = /^[a-z][a-z0-9_]{4,31}$/.test(slug) ? slug : username;

      messages.push({
        id,
        type: "message",
        date: date.toISOString().slice(0, 19),
        date_unixtime: String(Math.floor(date.getTime() / 1000)),
        from: fromForExport,
        from_id: `user${fromId}`,
        text,
      });
      stats.parsed += 1;
    }
  }

  console.info(
    `[forwards-convert] stats: total=${stats.total}, parsed=${stats.parsed}, noFwd=${stats.noFwd}, noText=${stats.noText}, noDate=${stats.noDate}`,
  );

  // Source chat id: pick a unique-but-stable negative integer outside
  // the existing V1/V3/V4 source ids and outside Telegram's actual chat
  // id space. Using -2 marks "forwarded archive, no real source chat".
  const root: ExportRoot = {
    name: "Suncoast Vouches (Forwards 2025-01 to 2025-11)",
    type: "private_supergroup",
    id: 999_999_999, // synthetic; documented in imports/README if needed
    messages,
  };

  const outDir = outPath.split(/[\\/]/).slice(0, -1).join("/");
  if (outDir) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(root, null, 2), "utf-8");
  console.info(`[forwards-convert] wrote ${messages.length} messages to ${outPath}`);
  console.info(
    `[forwards-convert] reviewer @ shape: synthetic 'fwd_<sha1[:10]>' (display name not parseable as @)`,
  );
}

main();
