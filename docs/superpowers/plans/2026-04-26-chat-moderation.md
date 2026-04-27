# Chat Moderation v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-26-chat-moderation-design.md` (v4 — set-and-forget, audited, sim-tested edition).

**Goal:** Scan every member message in any allowed chat, delete on lexicon hit, escalate via per-chat strikes ladder (warn → 24h mute → ban). Strike count derives from `admin_audit_log` (30-day window). One new module + one test file. No new tables, no JSON, no new admin commands. Plus: extend the v1.1 username deny-list with chat-phrase tokens to close the username-layer evasion vector.

**Architecture:** `src/core/chatModeration.ts` carries lexicon, normaliser, scanner, ladder, audit-derived count, orchestration. `src/core/tools/telegramTools.ts` gains three wrappers. `src/telegramBot.ts` calls `runChatModeration` first in group + edited-message branches. `src/server.ts` triggers boot-time admin-rights logging fire-and-forget. `src/core/archive.ts` extends `MARKETPLACE_USERNAME_SUBSTRINGS` and updates welcome/pinned copy. V3-locked tests in `archiveUx.test.ts` updated to match.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node `node:test`, drizzle-orm, Postgres, pino, Telegram Bot API via `src/core/tools/telegramTools.ts`.

**Conventions (per CLAUDE.md):**
- Tests live alongside source: `src/core/<name>.ts` ↔ `src/core/<name>.test.ts`.
- New `*.test.ts` must be appended to `scripts.test` in `package.json`.
- Commits: `feat(scope): ...` / `fix(scope): ...` / `docs(scope): ...`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't push without explicit ask.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/core/chatModeration.ts` | **Create** | Lexicon, `normalize`, `findHits`, `decideStrikeAction`, `getRecentStrikeCount`, `runChatModeration`, `logBotAdminStatusForChats` |
| `src/core/chatModeration.test.ts` | **Create** | Unit tests for pure helpers; orchestration via manual e2e |
| `src/core/tools/telegramTools.ts` | Modify | Add `restrictChatMember`, `banChatMember`, `getChatMember` |
| `src/telegramBot.ts` | Modify | Wire `runChatModeration` into group + edited-message branches; pass bot id and isAdmin |
| `src/server.ts` | Modify | Call `logBotAdminStatusForChats` after webhook setup, fire-and-forget |
| `src/core/archive.ts` | Modify | Extend `MARKETPLACE_USERNAME_SUBSTRINGS` with chat-phrase tokens; update welcome/pinned copy with chat-moderation block |
| `src/core/archiveUx.test.ts` | Modify | V3-locked tests assert new welcome/pinned wording |
| `package.json` | Modify | Append `chatModeration.test.ts` |
| `docs/runbook/opsec.md` | Modify | New §6b admin reference |
| `DEPLOY.md` | Modify | New §14 enablement |

**No migration. No new schema. No JSON. No new admin command.**

---

## Task 1: Telegram tool wrappers

**Files:**
- Modify: `src/core/tools/telegramTools.ts`

- [ ] **Step 1: Append the wrappers**

After the existing `deleteTelegramMessage` function:

```ts
export async function restrictChatMember(
  input: {
    chatId: number;
    telegramId: number;
    untilDate?: number;
    canSendMessages?: boolean;
  },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "restrictChatMember",
      {
        chat_id: input.chatId,
        user_id: input.telegramId,
        permissions: {
          can_send_messages: input.canSendMessages ?? false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
        },
        until_date: input.untilDate,
      },
      logger,
      input.chatId,
    ),
  );
}

export async function banChatMember(
  input: { chatId: number; telegramId: number; untilDate?: number },
  logger?: any,
) {
  return withTelegramRetry(() =>
    callTelegramAPI(
      "banChatMember",
      {
        chat_id: input.chatId,
        user_id: input.telegramId,
        until_date: input.untilDate,
      },
      logger,
      input.chatId,
    ),
  );
}

export async function getChatMember(
  input: { chatId: number; telegramId: number },
  logger?: any,
) {
  return callTelegramAPI(
    "getChatMember",
    { chat_id: input.chatId, user_id: input.telegramId },
    logger,
    input.chatId,
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/core/tools/telegramTools.ts
git commit -m "$(cat <<'EOF'
feat(telegram): add restrictChatMember, banChatMember, getChatMember

Three wrappers mirroring deleteTelegramMessage. restrictChatMember
sets default mute (can_send_messages=false) with optional
until_date. banChatMember bans permanently when until_date is
omitted. getChatMember used by boot-time admin-rights check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `MARKETPLACE_USERNAME_SUBSTRINGS` for chat-phrase tokens

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/reservedTargets.test.ts`

- [ ] **Step 1: Add new substrings**

In `src/core/archive.ts`, extend `MARKETPLACE_USERNAME_SUBSTRINGS` with the chat-moderation phrase tokens (closes the username-layer evasion vector — §4.9 of spec):

```ts
export const MARKETPLACE_USERNAME_SUBSTRINGS: ReadonlyArray<string> = [
  // ... existing entries unchanged ...
  "legit_seller", "vouched_vendor", "approved_seller",
  // Chat-moderation phrase tokens that could appear in usernames.
  // Closing the evasion vector where a vouch target like @pm_me_now
  // would otherwise pass the deny-list and get published in a vouch.
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
```

- [ ] **Step 2: Update `reservedTargets.test.ts`**

Append test cases:

```ts
test("chat-moderation phrase tokens are rejected in usernames", () => {
  for (const handle of [
    "pm_me_now",
    "best_selling",
    "selling_now",
    "buying_today",
    "wickr_user",
    "_threema",
    "ohwtb_today",
    "wts_now",
    "hmu_quick",
  ]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("chat-moderation tokens don't false-positive on benign overlaps", () => {
  // 'pm' alone (not bracketed) is allowed; 'selling' inside common words
  // doesn't appear in normal English (it's already a marketplace verb).
  for (const handle of [
    "alice",
    "calmness",
    "bobsmith",
  ]) {
    assert.equal(isReservedTarget(handle), false, handle);
  }
});
```

- [ ] **Step 3: Run tests + commit**

```bash
npx tsc --noEmit && npm test
git add src/core/archive.ts src/core/reservedTargets.test.ts
git commit -m "$(cat <<'EOF'
feat(deny-list): close username-layer chat-phrase evasion vector

Extends MARKETPLACE_USERNAME_SUBSTRINGS with the chat-moderation
phrase tokens that could plausibly appear in a vouch target's
@username (pm_, selling, wickr, wtb, wts, etc.). Without this,
a member could vouch @pm_me_now and the bot would publish a vouch
heading containing 'pm me now' which a hostile reporter could
screenshot and report.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `chatModeration.ts` — full module + tests

**Files:**
- Create: `src/core/chatModeration.ts`
- Create: `src/core/chatModeration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test file**

Create `src/core/chatModeration.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalize,
  findHits,
  decideStrikeAction,
  MUTE_DURATION_HOURS,
  STRIKE_DECAY_DAYS,
  PHRASES,
} from "./chatModeration.ts";

// ---- Normaliser ----

test("normalize: lowercases", () => {
  assert.equal(normalize("PM Me"), "pm me");
});

test("normalize: decodes leet substitutions", () => {
  assert.equal(normalize("p1ck up"), "pick up");
  assert.equal(normalize("h1t m3 up"), "hit me up");
  assert.equal(normalize("$ell"), "sell");
});

test("normalize: collapses non-alphanumerics to space", () => {
  assert.equal(normalize("p.m. me"), "pm me");
  assert.equal(normalize("p_m_me"), "p m me");
  assert.equal(normalize("p-m-me"), "p m me");
});

test("normalize: collapses whitespace and trims", () => {
  assert.equal(normalize("   hit    me     up   "), "hit me up");
});

// ---- findHits ----

test("findHits: matches a literal phrase", () => {
  const r = findHits("hey pm me about that");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "phrase");
});

test("findHits: matches phrase after leet normalisation", () => {
  const r = findHits("p.m. m3 about that");
  assert.equal(r.matched, true);
});

test("findHits: rejects 'pm me' inside 'welcompm me' (word boundary)", () => {
  const r = findHits("welcompm me to the group");
  assert.equal(r.matched, false);
});

test("findHits: passes unrelated chat", () => {
  const r = findHits("the surf was good today");
  assert.equal(r.matched, false);
});

test("findHits: regex matches against original text", () => {
  const r = findHits("call me on +61 412 345 678");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_phone");
});

test("findHits: catches t.me/+ invite splatter", () => {
  const r = findHits("join at t.me/+abcDEF123");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_tme_invite");
});

test("findHits: catches a BTC address", () => {
  const r = findHits("send to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_crypto_wallet");
});

test("findHits: catches an email", () => {
  const r = findHits("contact me at foo@bar.com");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_email");
});

// ---- decideStrikeAction ----

test("decideStrikeAction: 1 → warn", () => {
  assert.deepEqual(decideStrikeAction(1), { kind: "warn" });
});

test("decideStrikeAction: 2 → 24h mute", () => {
  assert.deepEqual(decideStrikeAction(2), {
    kind: "mute",
    durationHours: MUTE_DURATION_HOURS,
  });
});

test("decideStrikeAction: 3+ → ban", () => {
  assert.deepEqual(decideStrikeAction(3), { kind: "ban" });
  assert.deepEqual(decideStrikeAction(99), { kind: "ban" });
});

test("decideStrikeAction: count < 1 throws", () => {
  assert.throws(() => decideStrikeAction(0));
});

// ---- PHRASES shape ----

test("PHRASES non-empty, lowercase, alphabetised", () => {
  assert.ok(PHRASES.length > 0);
  for (const p of PHRASES) {
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0);
    assert.equal(p, p.toLowerCase());
  }
  const sorted = [...PHRASES].sort();
  assert.deepEqual([...PHRASES], sorted, "PHRASES must be alphabetised for diff readability");
});

test("PHRASES contains no known false-positive vocabulary", () => {
  // Suncoast V3 uses these in normal social chat per the empirical scan.
  // If any of these ever leak into PHRASES, members will be falsely flagged.
  const FALSE_POSITIVE_GUARD = [
    "bud", "fire", "k", "mdma", "pingas", "caps",
    "weed", "kush", "molly", "xan", "tabs", "acid",
    "ket", "coke", "meth",
  ];
  for (const fp of FALSE_POSITIVE_GUARD) {
    assert.ok(
      !PHRASES.includes(fp),
      `PHRASES must not contain false-positive vocab '${fp}' — see spec §4.1`,
    );
  }
});

test("constants drift guard", () => {
  assert.equal(STRIKE_DECAY_DAYS, 30);
  assert.equal(MUTE_DURATION_HOURS, 24);
});
```

Append `src/core/chatModeration.test.ts` to `package.json`'s `scripts.test`.

- [ ] **Step 2: Run, expect failure**

```bash
npm test
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the module**

Create `src/core/chatModeration.ts`:

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { not, like, isNull, or } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";
import { recordAdminAction } from "./adminAuditStore.ts";
import {
  banChatMember,
  deleteTelegramMessage,
  getChatMember,
  restrictChatMember,
  sendTelegramMessage,
} from "./tools/telegramTools.ts";
import { escapeHtml } from "./archive.ts";

// ---- Constants ----

export const STRIKE_DECAY_DAYS = 30;
export const MUTE_DURATION_HOURS = 24;
export const MODERATION_COMMAND = "chat_moderation:delete";

// Empirically derived from four chat exports (~24k messages). Each phrase
// fired dozens of times in the abuse corpus and 0–4 times in the target
// community. Drug names are deliberately excluded — Suncoast V3 uses
// bud / fire / k / mdma / pingas / caps in normal chat. The high-precision
// discriminator is commerce-shape phrasing, not vocabulary.
export const PHRASES: ReadonlyArray<string> = [
  "briar", "buying", "come thru", "dm me", "drop off", "f2f",
  "front", "got some", "got the", "hit me up", "hmu", "holding",
  "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
  "pickup", "pm me", "selling", "session", "signal me", "sold",
  "stocked", "threema", "tic", "tick", "what for", "what's the price",
  "what u sell", "wickr", "wickr me", "wtb", "wts", "wtt",
];

// Format-perfect artefacts. Empirical scan: 0 wallets, 0 emails, ~10 phones,
// 41 off-platform-comm references, 136 t.me invite links across 24k messages.
const REGEX_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "tme_invite",    re: /t\.me\/\+|t\.me\/joinchat|telegram\.me\/\+/i },
  { name: "phone",         re: /\b\+?\d[\d\s\-]{7,}\d\b/ },
  { name: "crypto_wallet", re: /\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b/ },
  { name: "email",         re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
];

// ---- Normaliser ----

const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
  "7": "t", "8": "b", "@": "a", "$": "s",
};

export function normalize(text: string): string {
  let out = text.toLowerCase();
  out = out.split("").map((c) => LEET_MAP[c] ?? c).join("");
  out = out.replace(/[^a-z0-9]+/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// ---- findHits ----

export type HitResult =
  | { matched: true; source: string }
  | { matched: false };

const PHRASES_SET: ReadonlySet<string> = new Set(PHRASES.map((p) => p.toLowerCase()));

export function findHits(text: string): HitResult {
  const padded = ` ${normalize(text)} `;
  for (const phrase of PHRASES_SET) {
    if (padded.includes(` ${phrase} `)) {
      return { matched: true, source: "phrase" };
    }
  }
  for (const { name, re } of REGEX_PATTERNS) {
    if (re.test(text)) {
      return { matched: true, source: `regex_${name}` };
    }
  }
  return { matched: false };
}

// ---- Strikes ladder ----

export type StrikeAction =
  | { kind: "warn" }
  | { kind: "mute"; durationHours: number }
  | { kind: "ban" };

export function decideStrikeAction(strikeCount: number): StrikeAction {
  if (strikeCount < 1) {
    throw new Error(`decideStrikeAction: invalid strikeCount ${strikeCount}`);
  }
  if (strikeCount === 1) return { kind: "warn" };
  if (strikeCount === 2) return { kind: "mute", durationHours: MUTE_DURATION_HOURS };
  return { kind: "ban" };
}

// ---- Strike count from audit log ----

async function getRecentStrikeCount(
  chatId: number,
  telegramId: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminAuditLog)
    .where(
      and(
        eq(adminAuditLog.command, MODERATION_COMMAND),
        eq(adminAuditLog.targetChatId, chatId),
        eq(adminAuditLog.adminTelegramId, telegramId),
        gte(adminAuditLog.createdAt, cutoff),
        eq(adminAuditLog.denied, false),
        // Exclude admin-exempt rows from contributing to anyone's count.
        or(
          isNull(adminAuditLog.reason),
          not(like(adminAuditLog.reason, "%(admin_exempt)%")),
        ),
      ),
    );
  return rows[0]?.count ?? 0;
}

// ---- Logger interface ----

type Logger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

// ---- Orchestration ----

export type RunChatModerationInput = {
  message: any;
  isAdmin: (telegramId: number | null | undefined) => boolean;
  botTelegramId: number;
  logger?: Logger;
};

export async function runChatModeration(
  input: RunChatModerationInput,
): Promise<{ deleted: boolean }> {
  const { message, isAdmin, botTelegramId, logger } = input;

  const fromId: number | undefined = message.from?.id;
  if (typeof fromId !== "number") return { deleted: false };

  // Skip the bot itself (belt-and-braces: is_bot flag + id check).
  if (message.from?.is_bot === true) return { deleted: false };
  if (fromId === botTelegramId) return { deleted: false };
  // Skip messages relayed via inline bots.
  if (message.via_bot != null) return { deleted: false };

  const text = typeof message.text === "string" ? message.text : "";
  const caption = typeof message.caption === "string" ? message.caption : "";
  const combined = [text, caption].filter((s) => s.length > 0).join("\n");
  if (combined.length === 0) return { deleted: false };

  const hit = findHits(combined);
  if (!hit.matched) return { deleted: false };

  const adminSender = isAdmin(fromId);
  const username: string | null = message.from?.username ?? null;
  const groupName: string =
    typeof message.chat?.title === "string"
      ? message.chat.title
      : `chat ${message.chat.id}`;

  // Audit row first — record the hit even if subsequent steps fail.
  await recordAdminAction({
    adminTelegramId: fromId,
    adminUsername: username,
    command: MODERATION_COMMAND,
    targetChatId: message.chat.id,
    targetUsername: username,
    reason: adminSender ? `${hit.source} (admin_exempt)` : hit.source,
    denied: false,
  });

  if (adminSender) {
    return { deleted: false };
  }

  // Delete is the most important action; do it first and tolerate failure.
  try {
    await deleteTelegramMessage(
      { chatId: message.chat.id, messageId: message.message_id },
      logger,
    );
  } catch (error) {
    logger?.warn?.(
      { error, chatId: message.chat.id },
      "chatModeration: deleteMessage failed",
    );
  }

  // Strike count + ladder. If the count query fails, fail-safe: skip
  // enforcement (delete already happened, audit already recorded). The next
  // hit catches up.
  let count: number;
  try {
    count = await getRecentStrikeCount(message.chat.id, fromId);
  } catch (error) {
    logger?.warn?.(
      { error, fromId, chatId: message.chat.id },
      "chatModeration: getRecentStrikeCount failed; skipping enforcement",
    );
    return { deleted: true };
  }
  if (count < 1) {
    // Defensive: the audit row insert above guarantees count ≥ 1, but if
    // some race makes it 0, treat as warn rather than throwing.
    count = 1;
  }
  const action = decideStrikeAction(count);

  if (action.kind === "warn") {
    await safeSendDm(
      fromId,
      `Your message in <b>${escapeHtml(groupName)}</b> was removed. Two more removals in 30 days will mute you for 24 hours.`,
      logger,
    );
    return { deleted: true };
  }

  if (action.kind === "mute") {
    const untilDate = Math.floor(Date.now() / 1000) + action.durationHours * 60 * 60;
    try {
      await restrictChatMember(
        {
          chatId: message.chat.id,
          telegramId: fromId,
          untilDate,
          canSendMessages: false,
        },
        logger,
      );
    } catch (error) {
      logger?.warn?.({ error }, "chatModeration: restrictChatMember failed");
    }
    await safeSendDm(
      fromId,
      `Second removal in 30 days. You are muted in <b>${escapeHtml(groupName)}</b> for ${action.durationHours} hours.`,
      logger,
    );
    return { deleted: true };
  }

  // ban
  try {
    await banChatMember(
      { chatId: message.chat.id, telegramId: fromId },
      logger,
    );
  } catch (error) {
    logger?.warn?.({ error }, "chatModeration: banChatMember failed");
  }
  await safeSendDm(
    fromId,
    `Third removal in 30 days. You have been removed from <b>${escapeHtml(groupName)}</b>. Contact an admin if you believe this is an error.`,
    logger,
  );
  return { deleted: true };
}

async function safeSendDm(
  telegramId: number,
  htmlText: string,
  logger?: Logger,
): Promise<void> {
  try {
    await sendTelegramMessage({ chatId: telegramId, text: htmlText }, logger);
  } catch (error) {
    // User may have blocked the bot or never DM'd it. Best-effort.
    logger?.info?.(
      { error, telegramId },
      "chatModeration: DM delivery failed (non-fatal)",
    );
  }
}

// ---- Boot-time admin-rights visibility ----

export async function logBotAdminStatusForChats(
  chatIds: ReadonlyArray<number>,
  botTelegramId: number,
  logger: Logger,
): Promise<void> {
  for (const chatId of chatIds) {
    try {
      const member = await getChatMember({ chatId, telegramId: botTelegramId });
      const status = (member as { status?: string } | null)?.status ?? "unknown";
      logger.info?.(
        { chatId, status },
        `chatModeration: bot status in ${chatId}: ${status}`,
      );
      if (status !== "administrator" && status !== "creator") {
        logger.warn?.(
          { chatId, status },
          `chatModeration: bot is NOT admin in ${chatId} — moderation will silently fail there`,
        );
      }
    } catch (error) {
      logger.warn?.(
        { error, chatId },
        `chatModeration: getChatMember failed for ${chatId}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
npx tsc --noEmit && npm test
git add src/core/chatModeration.ts src/core/chatModeration.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(moderation): chat moderation module — lexicon, scanner, ladder

Single module: PHRASES + REGEX_PATTERNS, normaliser, findHits,
decideStrikeAction, getRecentStrikeCount (derived from
admin_audit_log 30-day window), runChatModeration orchestration,
logBotAdminStatusForChats boot helper.

No new tables, no new admin commands, no JSON. Strike state IS the
count of audit rows in the decay window — automatic decay, no
maintenance.

Bot self-skip: is_bot OR id-equals-bot OR via_bot. Admin-exempt
rows tagged in reason and excluded from count via SQL filter.
DB count-query failure fail-safe to delete-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire moderation into `telegramBot.ts` + boot helper into `server.ts`

**Files:**
- Modify: `src/telegramBot.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports + bot-id capture in `telegramBot.ts`**

In the import block at the top of `src/telegramBot.ts`:

```ts
import {
  logBotAdminStatusForChats,
  runChatModeration,
} from "./core/chatModeration.ts";
import { getTelegramBotUsername } from "./core/tools/telegramTools.ts";
```

(`getTelegramBotUsername` already exists in `telegramTools.ts` and caches the bot's `getMe` result. We need the bot's `id`, not username; if `getTelegramBotUsername` doesn't expose the id, add a sibling `getTelegramBotId` to `telegramTools.ts`. Implement this as part of this task — read the existing `getTelegramBotUsername` to mirror its pattern.)

In `telegramTools.ts`, add alongside `getTelegramBotUsername`:

```ts
let cachedBotId: number | null = null;

export async function getTelegramBotId(logger?: any): Promise<number | null> {
  if (cachedBotId != null) return cachedBotId;
  const result = await callTelegramAPI("getMe", {}, logger);
  const id = (result as { id?: number } | null)?.id;
  if (typeof id === "number") {
    cachedBotId = id;
  }
  return cachedBotId;
}
```

- [ ] **Step 2: Hook `runChatModeration` into `handleGroupMessage`**

Find `async function handleGroupMessage`. Right after the migration handling and before command parsing:

```ts
async function handleGroupMessage(message: any, logger?: LoggerLike) {
  const migration = parseChatMigration(message);
  if (migration) {
    // ... existing migration handling unchanged ...
  }
  if (message?.migrate_to_chat_id != null) {
    return;
  }

  // ── Chat moderation runs first; a delete short-circuits all other handling.
  const botId = await getTelegramBotId(logger);
  if (typeof botId === "number") {
    const mod = await runChatModeration({
      message,
      isAdmin,
      botTelegramId: botId,
      logger,
    });
    if (mod.deleted) return;
  }

  // ... existing command parsing continues ...
}
```

- [ ] **Step 3: Hook into edited messages**

Find `processTelegramUpdate` (search for `payload.message`). Add an `edited_message` branch alongside the existing message dispatch:

```ts
if (payload.edited_message) {
  const edited = payload.edited_message;
  const editedChatType = edited.chat?.type;
  const editedChatId = edited.chat?.id;
  if (
    editedChatType !== "private" &&
    typeof editedChatId === "number" &&
    allowedTelegramChatIds.has(editedChatId)
  ) {
    const botId = await getTelegramBotId(logger);
    if (typeof botId === "number") {
      await runChatModeration({
        message: edited,
        isAdmin,
        botTelegramId: botId,
        logger,
      });
    }
  }
}
```

- [ ] **Step 4: Boot-time admin-rights log in `server.ts`**

In `src/server.ts`, after the webhook is registered (or after the bot starts listening — wherever is the latest point in startup before the server begins serving), add:

```ts
import {
  logBotAdminStatusForChats,
} from "./core/chatModeration.ts";
import { getTelegramBotId } from "./core/tools/telegramTools.ts";

// ... existing startup code ...

// Fire-and-forget: log the bot's admin status in every allowed chat so
// operators see at-a-glance if the bot lacks admin rights anywhere
// (silent-failure mode otherwise). Errors are logged warn; the function
// must not block boot.
void (async () => {
  const botId = await getTelegramBotId(logger);
  if (typeof botId !== "number") {
    logger.warn("chatModeration: could not determine bot id at boot; admin-rights check skipped");
    return;
  }
  await logBotAdminStatusForChats(
    Array.from(allowedTelegramChatIds),
    botId,
    logger,
  );
})();
```

(Imports for `allowedTelegramChatIds` already exist in `server.ts` if it's the entry point; if not, expose them from `telegramChatConfig.ts`.)

- [ ] **Step 5: Type-check + run tests + commit**

```bash
npx tsc --noEmit && npm test
git add src/telegramBot.ts src/server.ts src/core/tools/telegramTools.ts
git commit -m "$(cat <<'EOF'
feat(moderation): wire chat moderation into group + edited-message paths

runChatModeration runs first in handleGroupMessage; on hit it
deletes and applies the strike action, short-circuiting subsequent
command handling. edited_message updates from any allowed
non-private chat are routed through the same handler.

server.ts launches logBotAdminStatusForChats fire-and-forget after
boot so operators see the bot's admin status in each allowed chat
in Railway logs (silent-fail mode is otherwise invisible).

getTelegramBotId added to telegramTools.ts mirroring the existing
getTelegramBotUsername — caches the bot's getMe id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Welcome / pinned chat-moderation block + V3-locked test sync

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Add the chat-moderation block to welcome / pinned guide**

In `src/core/archive.ts`, find `buildWelcomeText` and `buildPinnedGuideText`. Add a new block after the existing `<u>Check before you deal</u>` section and before `rulesLine()`:

For `buildWelcomeText`:

```ts
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
    "Posts that look like buy/sell arrangements are auto-removed. Three removals in 30 days = ban.",
    "Send <code>/start</code> to me once so I can DM you when one of your messages is auto-removed.",
    "",
    rulesLine(),
  ].join("\n");
}
```

For `buildPinnedGuideText`, mirror the same chat-moderation block in the analogous position.

- [ ] **Step 2: Update V3-locked tests**

In `src/core/archiveUx.test.ts`, extend the welcome-text and pinned-guide-text tests:

```ts
test("welcome text uses locked v3.1 wording (community-framing) and points at /profile and chat-moderation", () => {
  const text = buildWelcomeText();
  // ... existing assertions ...
  assert.match(text, /Check before you deal/);
  assert.match(text, /\/profile @username/);
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /auto-removed. Three removals in 30 days = ban/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
  // ... existing negative assertions for commerce vocab ...
});

test("pinned guide text uses locked v3.1 wording (community-framing) and points at /profile and chat-moderation", () => {
  const text = buildPinnedGuideText();
  // ... existing assertions ...
  assert.match(text, /<b><u>Chat moderation<\/u><\/b>/);
  assert.match(text, /Send <code>\/start<\/code> to me once/);
});
```

- [ ] **Step 3: Run + commit**

```bash
npx tsc --noEmit && npm test
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
docs(copy): welcome + pinned guide announce chat moderation

New 'Chat moderation' block under the existing 'Check before you
deal' section: posts that look like buy/sell arrangements are
auto-removed, three removals in 30 days = ban, and members are
asked to /start the bot once so warnings can be DM'd. The
/start instruction closes the gap where Telegram blocks
bot-initiated DMs to users who haven't opened a conversation.

V3-locked tests in archiveUx.test.ts updated in the same commit
per CLAUDE.md V3-lock policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: OPSEC runbook §6b

**Files:**
- Modify: `docs/runbook/opsec.md`

- [ ] **Step 1: Append §6b**

Insert after §6a and before §7:

```markdown
---

## 6b. Chat moderation — admin reference

The bot moderates every member message in any allowed chat using the lexicon and ladder defined in `src/core/chatModeration.ts`. Strikes ladder, per-chat:

| Strike | Action | Reversible by |
|---|---|---|
| 1 | Delete + warn DM (silent if user never /start-ed the bot) | 30-day decay |
| 2 | Delete + 24h mute | Mute auto-expires; 30-day decay restores count |
| 3 | Delete + permanent ban | Telegram-native unban (group settings) |

Strike count is derived from `admin_audit_log` at decision time — no separate strikes store. Each hit writes one row with `command='chat_moderation:delete'`. The 30-day decay is the SQL window in the count query.

**Inspect recent moderation events:**

\`\`\`
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, target_username, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND created_at > now() - interval '7 days' ORDER BY created_at DESC"
\`\`\`

**Inspect a specific user's strike history (across all chats):**

\`\`\`
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND admin_telegram_id=<id> AND created_at > now() - interval '30 days' ORDER BY created_at DESC"
\`\`\`

**Manually clear strikes for a user in a specific chat (rare):**

\`\`\`
psql "$DATABASE_URL" -c "DELETE FROM admin_audit_log WHERE command='chat_moderation:delete' AND admin_telegram_id=<id> AND target_chat_id=<chat>"
\`\`\`

**Bot exemptions:** the bot's own messages are skipped (is_bot flag + id check). Inline-bot relays (`via_bot` set) are skipped. Admins are audit-logged but enforcement is skipped — admin-exempt audit rows do not contribute to anyone's strike count.

**Update the lexicon:** edit `PHRASES` (or `REGEX_PATTERNS`) in `src/core/chatModeration.ts`, commit, push. Railway redeploys.

**Bot admin-rights check:** the bot logs its admin status in every allowed chat at boot. Check Railway logs for messages of the form `chatModeration: bot status in <id>: <status>`. If status is anything other than `administrator` or `creator`, moderation will silently fail in that chat — fix the permissions in Telegram.

**First-warning DM gap:** members who have never `/start`-ed the bot receive no warning DM on their first strike (Telegram blocks bot-initiated DMs). Their message is still deleted and the strike still counts. The welcome and pinned guide instruct members to `/start` once; members who ignore that may be confused on first strike. Acceptable.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/opsec.md
git commit -m "$(cat <<'EOF'
docs(opsec): chat moderation §6b — strikes ladder + admin queries

Admin reference: ladder summary, SQL queries (recent events,
per-user history, manual clear), exemption rules (bot self,
inline-bot relays, admins), lexicon update procedure, boot
admin-rights check, and the first-warning DM gap caveat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: DEPLOY.md §14

**Files:**
- Modify: `DEPLOY.md`

- [ ] **Step 1: Append §14**

After the existing §13:

```markdown
## Step 14 — Chat moderation enablement (after deploy)

After the chat-moderation v4 deploy (no migration required), enable member chat in any group you want moderated:

1. In Telegram → group settings → Permissions → enable "Send messages" for members.
2. Recommended: also enable Slow Mode (30 seconds), and disable "Send media", "Send links", and "Send polls" so members can only send text.
3. The bot starts moderating automatically on the next member message in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`. No bot-side config.
4. Verify admin rights: check Railway logs for `chatModeration: bot status in <id>: administrator` — one line per chat at boot.
5. Watch `admin_audit_log` for `command='chat_moderation:delete'` rows for the first week. If a phrase is over-firing, edit `src/core/chatModeration.ts` `PHRASES` and push.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(deploy): chat moderation v4 enablement step

After the v4 deploy (no migration needed), enable member chat in
Telegram group settings; bot moderation starts automatically.
Railway logs show bot admin status per allowed chat at boot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Full test suite + type-check**

```bash
npx tsc --noEmit && npm test
```
Expected: clean + all green.

- [ ] **Step 2: Verify commits**

```bash
git log --oneline -10
```
Expected: 7 new commits, scoped + Co-Authored-By trailer.

- [ ] **Step 3: Report**

Brief summary: tasks done, commits hash range, lexicon size, no migration required, boot admin-rights log message to look for.

Do **not** push.

---

## Self-review

**Spec coverage:**

| Spec § | Task |
|---|---|
| 4.1 PHRASES + REGEX_PATTERNS | Task 3 |
| 4.2 normalize | Task 3 |
| 4.3 getRecentStrikeCount + DB error handling + admin-exempt SQL filter | Task 3 |
| 4.4 ladder + bot-self-skip + admin-exempt | Task 3 |
| 4.5 message + caption + edited_message scanning | Tasks 3, 4 |
| 4.6 multi-group | Task 4 (uses allowedTelegramChatIds) |
| 4.7 boot admin-rights log fire-and-forget | Tasks 3, 4 |
| 4.8 welcome/pinned chat-moderation block + /start instruction | Task 5 |
| 4.9 username-layer evasion: extend MARKETPLACE_USERNAME_SUBSTRINGS | Task 2 |
| 4.10 bot-id belt-and-braces | Tasks 3, 4 (botTelegramId param) |
| 5 architecture | Tasks 1–5 |
| 6 verification | Final verification |

**Placeholders:** none.

**Type / symbol consistency:**
- `runChatModeration` defined in Task 3, consumed in Task 4 ✓
- `logBotAdminStatusForChats` defined in Task 3, consumed in Task 4 ✓
- `restrictChatMember` / `banChatMember` / `getChatMember` defined in Task 1, consumed in Task 3 ✓
- `getTelegramBotId` defined in Task 4 (telegramTools.ts), consumed in Task 4 ✓
- `MODERATION_COMMAND` consistent between Task 3 (insert) and OPSEC SQL queries (Task 6) ✓
- Extended `MARKETPLACE_USERNAME_SUBSTRINGS` defined in Task 2, used by existing `isReservedTarget` ✓

All consistent. No spec requirement without a task.
