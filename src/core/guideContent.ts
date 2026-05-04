// /guide — bot-internal how-to surface.
//
// 4 categories × 4 leaves = 16 leaf pages, plus 4 category indexes and a
// root menu. One inline-keyboard message edits in place as the user
// navigates. Pure data + render — no DB, no Telegram I/O, no clocks.
//
// Page ids match `[a-z0-9_]{1,24}` so the same id works as both a
// callback_data fragment (`gd:p:<id>`) and a /start payload
// (`/start guide_<id>`). Worst-case callback_data is `gd:p:` (5) + 24 =
// 29 bytes — well under Telegram's 64-byte cap.

import { escapeHtml } from "./archive.ts";

export type GuidePage = {
  id: string;
  parent: "root" | string;
  title: string;
  body: string;
  cite?: string;
};

export type GuideButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type RenderedPage = {
  text: string;
  replyMarkup: { inline_keyboard: GuideButton[][] };
};

const GUIDE_ID_RE = /^[a-z0-9_]{1,24}$/;

// Single source of truth. Order matters: category leaves render in array
// order under their parent.
export const GUIDE_PAGES: readonly GuidePage[] = [
  // ── Category indexes ─────────────────────────────────────────────────
  {
    id: "acc",
    parent: "root",
    title: "🔒 Account",
    body: "Locking your Telegram account down so a stolen code or leaked SMS doesn't end you. Covers 2FA, session audit, what gets accounts frozen, and the official appeal path if it happens to you.",
  },
  {
    id: "grp",
    parent: "root",
    title: "👥 Group",
    body: "How moderation works, what the bot reads, why we run private + Request to Join.",
  },
  {
    id: "new",
    parent: "root",
    title: "🆕 New here",
    body: "Quick orientation for first-timers: muting notifications, finding a vouch, posting your own, and how to report problems.",
  },
  {
    id: "fact",
    parent: "root",
    title: "📜 Telegram facts",
    body: "Sourced facts about how Telegram actually works — encryption, what they moderate, what bot privacy mode means, and where official appeals go. Source links on each page.",
  },

  // ── Account leaves ───────────────────────────────────────────────────
  // Every leaf separates Telegram-confirmed facts from operator-observed
  // inference, and ends with a [🔗 Source] button so the member can verify
  // the claim themselves. Where Telegram doesn't publish thresholds
  // (e.g. exactly what triggers a freeze), the page says so.
  {
    id: "acc_2fa",
    parent: "acc",
    title: "Turn on 2FA",
    body:
      "If someone gets your login code (SIM swap, leaked SMS), they're in your account unless there's a password too.\n\n" +
      "<b>Settings → Privacy &amp; Security → Two-Step Verification → Set Password.</b>\n\n" +
      "Add a recovery email at the same step. Without one, forgetting your password locks you out permanently — Telegram won't reset it.",
    cite: "https://telegram.org/faq#q-what-is-two-step-verification",
  },
  {
    id: "acc_sessions",
    parent: "acc",
    title: "Active sessions audit",
    body:
      "Telegram lets you see every device logged into your account.\n\n" +
      "<b>Settings → Devices</b> (Android) or <b>Settings → Privacy &amp; Security → Active Sessions</b> (iOS).\n\n" +
      "Check the list. Anything you don't recognise — different city, unknown device — tap it and Terminate. Then change your 2FA password as a precaution.",
    cite: "https://telegram.org/faq#q-i-have-lost-my-phone",
  },
  {
    id: "acc_freeze",
    parent: "acc",
    title: "What gets accounts frozen",
    body:
      "<b>Telegram-confirmed:</b> accounts that violate the Terms of Service get restricted. Telegram does not publish the trigger thresholds.\n\n" +
      "<b>Operator-observed triggers</b> (no public Telegram source — patterns from frozen-account post-mortems): bulk-DMing strangers, fast group joins, third-party clients that look like bots, content that draws mass user reports.\n\n" +
      "<b>Effect:</b> a frozen account still receives messages but can't post in groups, write to non-contacts, or join new chats. Severity varies — some lift after days, some are permanent.",
    cite: "https://telegram.org/tos",
  },
  {
    id: "acc_appeal",
    parent: "acc",
    title: "If your account freezes",
    body:
      "<b>Open Telegram → tap the warning banner</b> at the top of any chat. That's the official appeal entry point.\n\n" +
      "Be brief, polite, factual. Say what you were doing and what you weren't.\n\n" +
      "Don't open multiple appeals — duplicates slow review. Wait at least 48h before any follow-up.\n\n" +
      "Reports from third-party tools or community moderators (us included) can't reverse a freeze. Telegram's team is the only path.",
    cite: "https://telegram.org/moderation",
  },

  // ── Group leaves ─────────────────────────────────────────────────────
  {
    id: "grp_join",
    parent: "grp",
    title: "Why \"Request to Join\"",
    body:
      "<b>Telegram feature:</b> Request to Join means an admin must approve every entry — documented in Telegram's group settings.\n\n" +
      "<b>Why we use it:</b> open groups get joined by spam accounts, scrapers, and report-trolls within minutes of going public. Approval gate filters them out.\n\n" +
      "<b>Operator-observed bonus:</b> closed-membership groups draw less classifier attention than open ones. No published Telegram threshold for this — it's pattern from comparison communities.\n\n" +
      "If your request takes a while, that's normal. Admins approve in batches.",
    cite: "https://telegram.org/faq#groups",
  },
  {
    id: "grp_posts",
    parent: "grp",
    title: "Why some posts auto-delete",
    body:
      "<b>How it works:</b> I scan every group message against a list of marketplace and scam phrases. Hits get deleted; you get a DM saying what tripped.\n\n" +
      "<b>Common triggers:</b> marketplace claims, off-platform contact prompts (\"dm me on wickr\"), payment-method shorthand (\"cash app me\"), explicit drug supply asks.\n\n" +
      "<b>Not a strike system:</b> no bans, no mutes. Repost in normal language. Disagree with a delete? Message an admin.\n\n" +
      "Full data + moderation policy: DM <code>/policy</code>.",
    cite: "https://telegram.org/tos",
  },
  {
    id: "grp_bot",
    parent: "grp",
    title: "What I read and store",
    body:
      "<b>I read every message</b> in the group. Telegram bots have a privacy-mode setting: ON (default — bot sees only commands, replies, mentions) or OFF (bot reads every message in chats it's in). I run with privacy mode OFF — required for moderation to scan posts.\n\n" +
      "<b>What I store:</b> your @username + Telegram ID after you interact, vouches you write, audit + operational logs.\n\n" +
      "<b>What I don't:</b> media files, full message history, anything from outside this group.\n\n" +
      "DM <code>/policy</code> for the full list. <code>/forgetme</code> wipes what you wrote.",
    cite: "https://core.telegram.org/bots/features#privacy-mode",
  },
  {
    id: "grp_takedown",
    parent: "grp",
    title: "Why groups get taken down",
    body:
      "<b>Telegram-confirmed:</b> groups that violate ToS get restricted. Restrictions are usually report-driven + automation-flagged. Thresholds not published.\n\n" +
      "<b>Operator-observed patterns</b> (from comparing dead vs alive groups in this space): bulk-templated bot output, names that read marketplace (\"vouches\", \"plug\", \"vendor\"), public visibility + scam reports stacking.\n\n" +
      "<b>Our defences:</b> private group + Request-to-Join, neutral name, member-written vouches (no bot-templated posts), silent moderation. Each choice is to stay clear of those patterns.",
    cite: "https://telegram.org/moderation",
  },

  // ── New here leaves ──────────────────────────────────────────────────
  {
    id: "new_mute",
    parent: "new",
    title: "Mute notifications",
    body:
      "<b>Tap the group name at the top → bell icon → choose how long.</b>\n\n" +
      "Options: 1 hour, 8 hours, 2 days, forever.\n\n" +
      "Telegram still shows unread counts in the group list — you just stop getting pings. Tap the bell again any time to turn them back on.",
    cite: "https://telegram.org/faq#q-how-do-i-mute-or-block-someone",
  },
  {
    id: "new_search",
    parent: "new",
    title: "Find a vouch",
    body:
      "<b>DM me</b> with <code>/search @username</code> — works for any member.\n\n" +
      "You'll get a summary card: total vouches, breakdown (POS / MIX / NEG), last activity. Tap \"See all\" for the full list.\n\n" +
      "<b>For new vouches</b> (after I joined the group), use Telegram's native search bar at the top of the group — that catches member-written posts the archive doesn't index yet.",
  },
  {
    id: "new_vouch",
    parent: "new",
    title: "How to vouch",
    body:
      "<b>Post a normal message in the group.</b> Tag the @, say what happened in your own words, mark it <b>pos / neg / neutral</b>.\n\n" +
      "Free text — no template, no bot wizard. The clearer you write, the more useful it is for the next person searching them.\n\n" +
      "<b>Vouch back is expected</b> — if someone vouches you, return the favour after your next deal.",
  },
  {
    id: "new_report",
    parent: "new",
    title: "Reporting issues",
    body:
      "<b>Genuine scammer / threats / weird DMs from a member:</b> forward the evidence to an admin and explain what happened.\n\n" +
      "<b>Bot bug or weird behaviour:</b> same — admin DM with what you saw.\n\n" +
      "<b>Don't mass-report inside Telegram</b> (the in-app Report button) unless it's truly serious. Mass reports against community members hurt the group, not the bad actor — Telegram's restriction system is report-weighted (no public threshold).",
    cite: "https://telegram.org/moderation",
  },

  // ── Telegram facts leaves ────────────────────────────────────────────
  {
    id: "fact_encryption",
    parent: "fact",
    title: "Cloud chats vs Secret chats",
    body:
      "<b>Cloud chats</b> (the default — DMs, groups, channels) are encrypted between you and Telegram's servers. Telegram can read them if compelled to.\n\n" +
      "<b>Secret chats</b> are end-to-end encrypted, device-to-device. Telegram can't read them. They're 1:1 only, don't sync across devices, and have to be started manually (tap user → New Secret Chat).\n\n" +
      "<b>Groups are never end-to-end.</b> Anything you post here is readable by Telegram.",
    cite: "https://telegram.org/faq#q-how-secure-is-telegram",
  },
  {
    id: "fact_moderation",
    parent: "fact",
    title: "What Telegram moderates",
    body:
      "<b>Telegram's stated policy:</b> they remove illegal pornographic content (especially involving minors), copyright violations on public sticker sets, and content that triggers mass user reports.\n\n" +
      "They generally don't pre-emptively scan private chats or small groups. Public channels and large public groups get more attention.\n\n" +
      "<b>Restrictions are user-report-driven</b>, not proactive in most cases.",
    cite: "https://telegram.org/faq#q-there-39s-illegal-content-on-telegram",
  },
  {
    id: "fact_privacy_mode",
    parent: "fact",
    title: "Bot privacy mode explained",
    body:
      "<b>Telegram bots</b> can be set to <b>privacy mode ON</b> (default — only see commands directed at them, replies, mentions) or <b>OFF</b> (read every message in chat).\n\n" +
      "<b>I run with privacy mode OFF</b> — required for the moderation lexicon to scan posts.\n\n" +
      "Reading isn't storing. <code>/policy</code> lists what I keep.",
    cite: "https://core.telegram.org/bots/features#privacy-mode",
  },
  {
    id: "fact_appeals",
    parent: "fact",
    title: "Official appeal channels",
    body:
      "<b>Account restricted:</b> tap the warning banner inside Telegram. That's the only official channel.\n\n" +
      "<b>Group taken down:</b> no formal appeal channel — admins can DM <code>@abuse</code>, but responses are rare.\n\n" +
      "<b>Don't trust @-handles claiming to be \"Telegram support\" or \"official appeals\".</b> Telegram never DMs first.",
    cite: "https://telegram.org/moderation",
  },
];

// Hard cap per body — see plan. The category-index "body" lines are the
// short blurb shown above the leaf-buttons; the leaves carry the actual
// how-to content. Both share the same cap.
const MAX_BODY_CHARS = 700;
const MAX_TITLE_CHARS = 40;

const PAGES_BY_ID = new Map(GUIDE_PAGES.map((p) => [p.id, p] as const));
const CHILDREN_BY_PARENT = (() => {
  const m = new Map<string, GuidePage[]>();
  for (const p of GUIDE_PAGES) {
    if (!m.has(p.parent)) m.set(p.parent, []);
    m.get(p.parent)!.push(p);
  }
  return m;
})();

export function isValidGuidePageId(id: string): boolean {
  return GUIDE_ID_RE.test(id);
}

export function getGuidePage(id: string): GuidePage | null {
  return PAGES_BY_ID.get(id) ?? null;
}

export function getGuideChildren(parentId: string): readonly GuidePage[] {
  return CHILDREN_BY_PARENT.get(parentId) ?? [];
}

// callback_data: "gd:p:<id>" — `id` matches GUIDE_ID_RE. Worst case 29
// bytes (5 + 24).
const GD_PREFIX = "gd:p:";

export function buildGuidePageCallback(id: string): string {
  return `${GD_PREFIX}${id}`;
}

export function parseGuidePageCallback(data: string): string | null {
  if (!data.startsWith(GD_PREFIX)) return null;
  const id = data.slice(GD_PREFIX.length);
  if (!GUIDE_ID_RE.test(id)) return null;
  // Length cap: prefix + max id = 29 bytes. Reject anything longer
  // (attacker-supplied callback_data could be longer than the matching
  // regex would allow if the bytes contain garbage prefixed by valid).
  if (data.length > GD_PREFIX.length + 24) return null;
  return id;
}

function renderBody(page: GuidePage): string {
  const parts = [`<b>${escapeHtml(page.title)}</b>`, "", page.body];
  if (page.cite) {
    // Render the source as a plain text line so members who can't see
    // the inline button (older clients, screenshots, copy-paste) still
    // get the URL. The [🔗 Source] button below is the one-tap path.
    const display = page.cite.replace(/^https?:\/\//, "");
    parts.push("", `<i>Source: ${escapeHtml(display)}</i>`);
  }
  return parts.join("\n");
}

function isFullUrl(s: string | undefined): s is string {
  return typeof s === "string" && /^https?:\/\//.test(s);
}

const BACK_LABEL = "← Back";
const MENU_LABEL = "🏠 Bot menu";
const ROOT_TITLE = "How can we help?";
const ROOT_BODY = "Tap a topic.";

export function buildGuideRoot(): RenderedPage {
  const categories = getGuideChildren("root");
  // 2×2 grid — pair categories by index.
  const rows: GuideButton[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    const row: GuideButton[] = [];
    const a = categories[i]!;
    row.push({ text: a.title, callback_data: buildGuidePageCallback(a.id) });
    if (i + 1 < categories.length) {
      const b = categories[i + 1]!;
      row.push({ text: b.title, callback_data: buildGuidePageCallback(b.id) });
    }
    rows.push(row);
  }
  // Bottom row: route out of /guide back to the bot's main welcome
  // menu. Reachable from any /guide entry point (typed /guide, welcome
  // "How it works" tap, or deep-link /start guide).
  rows.push([{ text: "← Bot menu", callback_data: "wc:back" }]);
  return {
    text: `<b>${escapeHtml(ROOT_TITLE)}</b>\n\n${ROOT_BODY}`,
    replyMarkup: { inline_keyboard: rows },
  };
}

export function buildGuidePage(id: string): RenderedPage | null {
  if (id === "root") return buildGuideRoot();
  const page = getGuidePage(id);
  if (!page) return null;

  const children = getGuideChildren(id);
  const isCategory = children.length > 0;
  const rows: GuideButton[][] = [];

  if (isCategory) {
    // 1-per-row leaf buttons, then [← Back] (to guide root, where
    // the user can pick a different category) and [🏠 Bot menu] for
    // a one-tap escape all the way home.
    for (const child of children) {
      rows.push([
        { text: child.title, callback_data: buildGuidePageCallback(child.id) },
      ]);
    }
    rows.push([
      { text: BACK_LABEL, callback_data: buildGuidePageCallback("root") },
      { text: MENU_LABEL, callback_data: "wc:back" },
    ]);
  } else {
    // Leaf:
    //   [🔗 Source] (when cite is a full URL — opens browser to verify)
    //   [← Back] (parent category) [🏠 Bot menu] (welcome)
    // Source button lets the member confirm any factual claim themselves
    // — un-rebuttable. Escape is always one tap regardless of how the
    // leaf was reached.
    if (isFullUrl(page.cite)) {
      rows.push([{ text: "🔗 Source", url: page.cite }]);
    }
    rows.push([
      { text: BACK_LABEL, callback_data: buildGuidePageCallback(page.parent) },
      { text: MENU_LABEL, callback_data: "wc:back" },
    ]);
  }

  return {
    text: renderBody(page),
    replyMarkup: { inline_keyboard: rows },
  };
}

// Validation hooks for tests. Throws if any invariant is violated; pure.
export function validateGuideContent(): void {
  for (const p of GUIDE_PAGES) {
    if (!GUIDE_ID_RE.test(p.id)) {
      throw new Error(`bad id: ${p.id}`);
    }
    if (p.title.length === 0 || p.title.length > MAX_TITLE_CHARS) {
      throw new Error(`title length out of range: ${p.id} (${p.title.length})`);
    }
    if (p.body.length === 0 || p.body.length > MAX_BODY_CHARS) {
      throw new Error(`body length out of range: ${p.id} (${p.body.length})`);
    }
    if (p.parent !== "root" && !PAGES_BY_ID.has(p.parent)) {
      throw new Error(`bad parent: ${p.id} -> ${p.parent}`);
    }
  }
}

// /start payload — verifies + extracts a guide page id from a /start
// payload. Accepts:
//   "guide"          → root render
//   "guide_<id>"     → that page (if known)
// Returns "root" for both the bare and unknown-id cases (per plan: on
// miss, render root).
export function parseGuideStartPayload(payload: string): string | null {
  if (payload === "guide") return "root";
  if (!payload.startsWith("guide_")) return null;
  const id = payload.slice("guide_".length);
  if (!GUIDE_ID_RE.test(id)) return "root";
  if (id === "root") return "root";
  return PAGES_BY_ID.has(id) ? id : "root";
}
