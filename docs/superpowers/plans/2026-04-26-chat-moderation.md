# Chat Moderation v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-26-chat-moderation-design.md` (v3 — set-and-forget edition).

**Goal:** Scan every member message in any allowed chat, delete on lexicon hit, escalate via per-chat strikes ladder (warn → 24h mute → ban). Strike count derives from `admin_audit_log` (30-day window) — no new table, no JSON file, no admin command. **One new module + one new test file. Two existing files modified.**

**Architecture:** `src/core/chatModeration.ts` carries the lexicon constants, normaliser, scanner, ladder decision, and `runChatModeration` orchestration. `src/core/tools/telegramTools.ts` gains `restrictChatMember`, `banChatMember`, `getChatMember` wrappers. `src/telegramBot.ts` calls `runChatModeration` once at the top of group-message and edited-message branches, and logs bot-admin status for each allowed chat at boot.

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
| `src/core/chatModeration.ts` | **Create** | Lexicon constants, `normalize`, `findHits`, `decideStrikeAction`, `getRecentStrikeCount`, `runChatModeration` |
| `src/core/chatModeration.test.ts` | **Create** | Unit tests for normaliser, scanner, ladder, runner (with injected fakes for DB + Telegram side-effects) |
| `src/core/tools/telegramTools.ts` | Modify | Add `restrictChatMember`, `banChatMember`, `getChatMember` wrappers |
| `src/telegramBot.ts` | Modify | Call `runChatModeration` first in group-message + edited-message branches; emit boot-time admin-rights log |
| `package.json` | Modify | Append `chatModeration.test.ts` to `scripts.test` |
| `docs/runbook/opsec.md` | Modify | New §6b chat-moderation admin reference |
| `DEPLOY.md` | Modify | New §14 chat moderation enablement |

**No migration. No JSON file. No new admin command. No new schema.**

---

## Task 1: Telegram tool wrappers

**Files:**
- Modify: `src/core/tools/telegramTools.ts`

- [ ] **Step 1: Append the wrappers**

After the existing `deleteTelegramMessage` function in `src/core/tools/telegramTools.ts`:

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/core/tools/telegramTools.ts
git commit -m "$(cat <<'EOF'
feat(telegram): add restrictChatMember, banChatMember, getChatMember

Three wrappers mirroring deleteTelegramMessage. restrictChatMember
sets a default mute (can_send_messages=false) with optional
until_date. banChatMember bans permanently when until_date is
omitted. getChatMember used by the boot-time admin-rights check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `chatModeration.ts` — full module

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

// ---- Lexicon shape ----

test("PHRASES is non-empty and all entries are non-empty lowercase strings", () => {
  assert.ok(PHRASES.length > 0);
  for (const p of PHRASES) {
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0);
    assert.equal(p, p.toLowerCase());
  }
});

test("STRIKE_DECAY_DAYS is 30", () => {
  assert.equal(STRIKE_DECAY_DAYS, 30);
});
```

- [ ] **Step 2: Append to `package.json`**

In `scripts.test`, append `src/core/chatModeration.test.ts`.

- [ ] **Step 3: Run, expect failure**

Run: `npm test`
Expected: FAIL — `chatModeration.ts` doesn't exist.

- [ ] **Step 4: Implement the module**

Create `src/core/chatModeration.ts`:

```ts
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";
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

// Empirically derived from the four chat exports: phrases that fired
// dozens of times in the abuse corpus and 0–4 times in the target community.
// Drug names are deliberately excluded — Suncoast V3 uses bud / fire / k /
// mdma / pingas / caps in normal chat, so blocking them creates false-positives.
// The high-precision discriminator is commerce-shape phrasing.
export const PHRASES: ReadonlyArray<string> = [
  "briar", "buying", "come thru", "dm me", "drop off", "f2f",
  "front", "got some", "got the", "hit me up", "hmu", "holding",
  "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
  "pickup", "pm me", "selling", "session", "signal me", "sold",
  "stocked", "threema", "tic", "tick", "what for", "what's the price",
  "what u sell", "wickr", "wickr me", "wtb", "wts", "wtt",
];

// Format-perfect artefacts. These never appear legitimately in the target
// community per the empirical scan (0 wallets, 0 emails, ~10 phones across
// 24k messages — all in the abuse corpus).
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
  // Phrase pass: normalise + word-boundary match via space-padded includes().
  const padded = ` ${normalize(text)} `;
  for (const phrase of PHRASES_SET) {
    if (padded.includes(` ${phrase} `)) {
      return { matched: true, source: "phrase" };
    }
  }
  // Regex pass: original (non-normalised) text. Format-perfect.
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

// ---- Strike count from audit log (no new table) ----

export async function getRecentStrikeCount(
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
      ),
    );
  return rows[0]?.count ?? 0;
}

// ---- Logger interface (compatible with the project's LoggerLike) ----

type Logger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

// ---- Audit row insertion ----

async function insertModerationAudit(input: {
  chatId: number;
  telegramId: number;
  username: string | null;
  reason: string;
}): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminTelegramId: input.telegramId,
    adminUsername: input.username,
    command: MODERATION_COMMAND,
    targetChatId: input.chatId,
    targetUsername: input.username,
    reason: input.reason,
    denied: false,
  });
}

// ---- Orchestration ----

export type RunChatModerationInput = {
  message: any; // Telegram Message shape
  isAdmin: (telegramId: number) => boolean;
  logger?: Logger;
};

export async function runChatModeration(
  input: RunChatModerationInput,
): Promise<{ deleted: boolean }> {
  const { message, isAdmin, logger } = input;

  const fromId = message.from?.id;
  if (!fromId) return { deleted: false };

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

  // Audit row first — record the hit even if the enforcement steps fail.
  await insertModerationAudit({
    chatId: message.chat.id,
    telegramId: fromId,
    username,
    reason: adminSender ? `${hit.source} (admin_exempt)` : hit.source,
  });

  if (adminSender) {
    return { deleted: false };
  }

  // Best-effort delete. If the bot lacks rights this fails; the strike
  // still applies and the audit row is already recorded.
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

  // Count includes the row we just inserted (the audit row IS this strike).
  const count = await getRecentStrikeCount(message.chat.id, fromId);
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
    // User may have blocked the bot or never DM'd it. The moderation action
    // stands regardless — DM is best-effort.
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

- [ ] **Step 5: Run, expect pass**

Run: `npx tsc --noEmit && npm test`
Expected: clean + all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/chatModeration.ts src/core/chatModeration.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(moderation): chat moderation module — lexicon, scanner, ladder

Single module containing the empirically-derived lexicon constants
(PHRASES + REGEX_PATTERNS), the leet/punctuation normaliser,
findHits scanner, decideStrikeAction ladder decision,
getRecentStrikeCount (derived from admin_audit_log 30-day window),
and runChatModeration orchestration. Boot-time helper
logBotAdminStatusForChats logs admin status per allowed chat so
operators see at a glance if the bot lacks admin rights anywhere.

No new tables, no new admin commands, no JSON files. Strike state
is the count of moderation rows in admin_audit_log within the decay
window — automatic decay, no maintenance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire moderation into `telegramBot.ts`

**Files:**
- Modify: `src/telegramBot.ts`

- [ ] **Step 1: Add imports**

In the import block at the top of `src/telegramBot.ts`:

```ts
import {
  logBotAdminStatusForChats,
  runChatModeration,
} from "./core/chatModeration.ts";
```

- [ ] **Step 2: Hook moderation into `handleGroupMessage`**

Find `handleGroupMessage` (search for `async function handleGroupMessage`). Right after the migration-handling early returns and before the command-parse logic, insert:

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
  const mod = await runChatModeration({
    message,
    isAdmin,
    logger,
  });
  if (mod.deleted) return;

  // ... existing command parsing continues ...
}
```

- [ ] **Step 3: Hook moderation into edited messages**

Find the dispatcher in `processTelegramUpdate` (search for `payload.message`). Add an `edited_message` branch alongside the existing message branch:

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
    await runChatModeration({
      message: edited,
      isAdmin,
      logger,
    });
  }
}
```

(Place this branch wherever `payload.message` is dispatched; mirror the same allowlist + non-private guard.)

- [ ] **Step 4: Add boot-time admin-rights log**

Find the place where the bot announces it has booted (search for `getMe`, or for the `cachedBotUsername` initialisation, or for the application startup function). After the bot's own `telegram_id` is known, call:

```ts
const botMe = await callTelegramAPI("getMe", {}, logger);
const botTelegramId = (botMe as { id?: number } | null)?.id;
if (typeof botTelegramId === "number") {
  await logBotAdminStatusForChats(
    Array.from(allowedTelegramChatIds),
    botTelegramId,
    logger,
  );
}
```

(If the existing boot path doesn't have a clean place to add this, add it once the webhook is registered or when the first allowed-chats list is parsed. The exact placement is implementation-detail; the requirement is that this runs once per process at startup.)

- [ ] **Step 5: Type-check + run tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean + all 156+ tests still green (the new module's tests don't touch the DB; existing tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/telegramBot.ts
git commit -m "$(cat <<'EOF'
feat(moderation): wire chat moderation into group + edited-message paths

runChatModeration runs first in handleGroupMessage; on hit it deletes
the message and applies the strike action, short-circuiting all
subsequent command handling. edited_message updates from any allowed
non-private chat are routed through the same handler so edited-into-
dirty content is caught. Boot-time logBotAdminStatusForChats logs
the bot's status in each allowed chat so operators see at-a-glance if
the bot lacks admin rights anywhere (silent failure mode otherwise).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: OPSEC runbook §6b

**Files:**
- Modify: `docs/runbook/opsec.md`

- [ ] **Step 1: Append §6b**

Insert after §6a (the lexicon reference) and before §7 (appeals contacts):

```markdown
---

## 6b. Chat moderation — admin reference

The bot moderates every member message in any allowed chat using the lexicon and ladder defined in `src/core/chatModeration.ts`. Strikes ladder, per-chat:

| Strike | Action | Reversible by |
|---|---|---|
| 1 | Delete + warn DM | 30-day decay |
| 2 | Delete + 24h mute | Mute auto-expires; 30-day decay restores count |
| 3 | Delete + permanent ban | Telegram-native unban (group settings) |

Strike count is derived from the existing `admin_audit_log` table at decision time — no separate strikes store. Each hit writes one row with `command='chat_moderation:delete'`. The 30-day decay is the SQL window in the count query; nothing to maintain.

**Inspect recent moderation events:**

\`\`\`
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, target_username, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND created_at > now() - interval '7 days' ORDER BY created_at DESC"
\`\`\`

**Inspect a specific user's strike history (across all chats):**

\`\`\`
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND admin_telegram_id=<id> AND created_at > now() - interval '30 days' ORDER BY created_at DESC"
\`\`\`

**Manually clear strikes for a user in a specific chat (rare; usually unnecessary):**

\`\`\`
psql "$DATABASE_URL" -c "DELETE FROM admin_audit_log WHERE command='chat_moderation:delete' AND admin_telegram_id=<id> AND target_chat_id=<chat>"
\`\`\`

**Update the lexicon:** edit `PHRASES` (or `REGEX_PATTERNS`) in `src/core/chatModeration.ts`, commit, push. Railway redeploys; the next-started container has the new lexicon.

**Bot admin-rights check:** the bot logs its admin status in every allowed chat at boot. Check Railway logs for messages of the form `chatModeration: bot status in <id>: <status>`. If status is anything other than `administrator` or `creator`, moderation will silently fail in that chat — fix the permissions in Telegram.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/opsec.md
git commit -m "$(cat <<'EOF'
docs(opsec): chat moderation §6b — strikes ladder + audit queries

Admin reference for the v3 chat moderation: ladder summary, SQL
queries for recent events / per-user history / manual strike clear,
lexicon update procedure (edit TS constant + push), bot admin-rights
check at boot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: DEPLOY.md §14

**Files:**
- Modify: `DEPLOY.md`

- [ ] **Step 1: Append §14**

After the existing `## Step 13 — Vendetta-resistant posture: legacy NEG cleanup`, add:

```markdown
## Step 14 — Chat moderation enablement (after deploy)

After the chat-moderation v3 deploy (no migration required — derives state from existing tables), enable member chat in any group you want moderated:

1. In Telegram → group settings → Permissions → enable "Send messages" for members.
2. Recommended: also enable Slow Mode (30 seconds), and disable "Send media", "Send links", and "Send polls" so members can only send text. Telegram's native restrictions reduce attack surface; the bot lexicon catches the rest.
3. The bot starts moderating automatically on the next member message in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`. No bot-side config.
4. Verify admin rights: check Railway logs for `chatModeration: bot status in <id>: administrator` — one line per chat at boot.
5. Watch `admin_audit_log` for `command='chat_moderation:delete'` rows for the first week. If a phrase is over-firing, edit `src/core/chatModeration.ts` `PHRASES` and push — Railway auto-deploys.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(deploy): chat moderation v3 enablement step

After the v3 deploy (no migration needed), enable member chat in
Telegram group settings; bot moderation starts automatically.
Recommends Telegram-native slow mode + media restriction as
complementary defences. Boot logs reveal admin-rights state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green; 156+ existing tests + ~16 new tests in `chatModeration.test.ts`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify the commits**

Run: `git log --oneline -8`
Expected: 5 new commits + the v3 spec/plan revision commits, each scoped + with the Co-Authored-By trailer.

- [ ] **Step 4: Report to user**

Brief summary: tasks done, commits hash range, lexicon size (`PHRASES.length` + 4 regex patterns), no migration required, boot admin-rights log message to look for in Railway.

Do **not** push.

---

## Self-review checklist

**Spec coverage (each numbered §):**

- §4.1 Lexicon as TS constants → Task 2 (PHRASES + REGEX_PATTERNS in chatModeration.ts)
- §4.2 Normaliser → Task 2 (`normalize`)
- §4.3 Strike count from audit log → Task 2 (`getRecentStrikeCount`)
- §4.4 Strikes ladder → Task 2 (`decideStrikeAction`)
- §4.5 What gets scanned → Task 3 (handleGroupMessage hook + edited_message hook; `runChatModeration` reads text + caption)
- §4.6 Multi-group behaviour → Task 3 (uses `allowedTelegramChatIds` allowlist)
- §4.7 Boot-time admin-rights visibility → Task 2 (`logBotAdminStatusForChats`) + Task 3 (call site)
- §5 Architecture → Tasks 1-3
- §6 Verification → Final verification
- §7 Risks → captured in spec; no code task
- §8 Out of scope → no code task
- §9 Forward compatibility → no code task

**Placeholders:** none.

**Type / symbol consistency:**
- `runChatModeration` defined in Task 2, consumed in Task 3 ✓
- `logBotAdminStatusForChats` defined in Task 2, consumed in Task 3 ✓
- `restrictChatMember` / `banChatMember` / `getChatMember` defined in Task 1, consumed in Task 2 ✓
- `MODERATION_COMMAND` constant used both for inserting audit rows (Task 2) and OPSEC SQL queries (Task 4) — keep aligned

All consistent. No spec requirement without a task.
