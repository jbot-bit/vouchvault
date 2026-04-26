# Chat Moderation v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-26-chat-moderation-design.md` (commit `03ca1af`).

**Goal:** Scan every member message in any allowed chat, delete on lexicon hit, escalate via per-chat strikes ladder (warn → 24h mute → ban) with 30-day decay. One new module, one new tiny table, one JSON data file. ~150 LoC.

**Architecture:** Lexicon ships in `data/moderation_lexicon.json` (loaded at boot). `chatModeration.ts` exposes `findHits(text)`. `chatStrikesStore.ts` is the DB round-trip. Telegram tools gain `restrictChatMember` and `banChatMember`. The group-message handler in `telegramBot.ts` runs `findHits` first; on hit, deletes + applies strike action + writes one audit row.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node `node:test`, drizzle-orm, Postgres, pino logger, Telegram Bot API via `src/core/tools/telegramTools.ts`.

**Conventions (per CLAUDE.md):**
- Tests live alongside source: `src/core/<name>.ts` ↔ `src/core/<name>.test.ts`.
- New `*.test.ts` files **must be appended to the `test` script in `package.json`**.
- Commits: `feat(scope): ...` / `fix(scope): ...` / `docs(scope): ...`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't push without an explicit ask.
- New callback strings (none in this plan, but if any are added) must be added to `callbackData.test.ts` per the existing convention.

---

## File Structure (changes)

| File | Status | Responsibility |
|---|---|---|
| `data/moderation_lexicon.json` | **Create** | Phrase Set + regex array — empirically derived from 4 chat exports |
| `migrations/0009_chat_strikes.sql` | **Create** | `chat_strikes` table with `(chat_id, telegram_id)` unique constraint |
| `src/core/storage/schema.ts` | Modify | Mirror the migration in drizzle |
| `src/core/chatModeration.ts` | **Create** | Loads lexicon at boot; `normalize(text)`; `findHits(text)` |
| `src/core/chatStrikesStore.ts` | **Create** | `recordStrike()` with 30-day decay; `clearStrikes()` |
| `src/core/tools/telegramTools.ts` | Modify | Add `restrictChatMember` and `banChatMember` wrappers |
| `src/telegramBot.ts` | Modify | Add `runChatModeration()` step at the top of group-message and edited-message branches; wire `/clear_strikes` admin command |
| `src/core/chatModerationNormaliser.test.ts` | **Create** | Unit-test normaliser |
| `src/core/chatModerationFindHits.test.ts` | **Create** | Unit-test phrase + regex matching |
| `src/core/chatStrikesStore.test.ts` | **Create** | DB-free state-machine tests with a mock |
| `src/core/chatModerationLadder.test.ts` | **Create** | Count→action mapping; admin-exempt |
| `package.json` | Modify | Append every new `*.test.ts` to `scripts.test` |

---

## Task 1: `chat_strikes` schema migration

**Files:**
- Create: `migrations/0009_chat_strikes.sql`
- Modify: `src/core/storage/schema.ts`

- [ ] **Step 1: Write the schema-shape assertion**

Append to `src/core/archiveUx.test.ts` (re-using the file briefly to assert the table is in scope):

```ts
import { chatStrikes } from "../core/storage/schema.ts";

test("chat_strikes table is exported from schema", () => {
  assert.ok((chatStrikes as any).chatId, "chat_strikes.chatId missing");
  assert.ok((chatStrikes as any).telegramId, "chat_strikes.telegramId missing");
  assert.ok((chatStrikes as any).count, "chat_strikes.count missing");
  assert.ok((chatStrikes as any).lastStrikeAt, "chat_strikes.lastStrikeAt missing");
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `chatStrikes` not exported.

- [ ] **Step 3: Write the migration**

Create `migrations/0009_chat_strikes.sql`:

```sql
CREATE TABLE chat_strikes (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  telegram_id BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_strike_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reason TEXT,
  CONSTRAINT chat_strikes_unique UNIQUE (chat_id, telegram_id)
);

CREATE INDEX chat_strikes_telegram_id_idx ON chat_strikes (telegram_id);
```

- [ ] **Step 4: Mirror in drizzle**

In `src/core/storage/schema.ts`, append:

```ts
export const chatStrikes = pgTable(
  "chat_strikes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
    lastStrikeAt: timestamp("last_strike_at").notNull().defaultNow(),
    lastReason: text("last_reason"),
  },
  (table) => {
    return {
      chatStrikesUnique: unique("chat_strikes_unique").on(table.chatId, table.telegramId),
      telegramIdIdx: index("chat_strikes_telegram_id_idx").on(table.telegramId),
    };
  },
);
```

- [ ] **Step 5: Run, expect pass**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/0009_chat_strikes.sql src/core/storage/schema.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): add chat_strikes table for moderation strikes ladder

One row per (chat_id, telegram_id) pair tracking strike count and
last_strike_at timestamp. Unique constraint prevents duplicates.
Index on telegram_id for cross-chat lookups.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Lexicon JSON + boot-time loader

**Files:**
- Create: `data/moderation_lexicon.json`
- Create: `src/core/chatModeration.ts` (initial — just loader + types)

- [ ] **Step 1: Create the lexicon JSON**

Create `data/moderation_lexicon.json`:

```json
{
  "version": "1",
  "phrases": [
    "pm me",
    "hit me up",
    "hmu",
    "dm me",
    "inbox me",
    "wickr me",
    "signal me",
    "selling",
    "buying",
    "sold",
    "wts",
    "wtb",
    "wtt",
    "how much",
    "what for",
    "what's the price",
    "what u sell",
    "pickup",
    "drop off",
    "meet up",
    "f2f",
    "p2p",
    "come thru",
    "got the",
    "got some",
    "stocked",
    "in stock",
    "holding",
    "tic",
    "tick",
    "front",
    "owe me",
    "wickr",
    "threema",
    "session",
    "briar"
  ],
  "regex": [
    {
      "name": "tme_invite",
      "pattern": "t\\.me/\\+|t\\.me/joinchat|telegram\\.me/\\+"
    },
    {
      "name": "phone",
      "pattern": "\\b\\+?\\d[\\d\\s\\-]{7,}\\d\\b"
    },
    {
      "name": "crypto_wallet",
      "pattern": "\\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\\b"
    },
    {
      "name": "email",
      "pattern": "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b"
    }
  ]
}
```

- [ ] **Step 2: Create the loader skeleton**

Create `src/core/chatModeration.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type LexiconRegex = { name: string; pattern: string };
export type Lexicon = { version: string; phrases: string[]; regex: LexiconRegex[] };

export type HitResult =
  | { matched: true; source: string }
  | { matched: false };

let cached: { phrases: ReadonlySet<string>; regex: ReadonlyArray<{ name: string; re: RegExp }> } | null = null;

function lexiconPath(): string {
  // data/moderation_lexicon.json relative to repo root.
  // src/core/chatModeration.ts -> ../../data/moderation_lexicon.json
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "data", "moderation_lexicon.json");
}

export function loadLexicon(path: string = lexiconPath()): Lexicon {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Lexicon;
  if (!Array.isArray(parsed.phrases) || !Array.isArray(parsed.regex)) {
    throw new Error(`Invalid moderation lexicon at ${path}`);
  }
  return parsed;
}

function compile(lex: Lexicon) {
  const phrases = new Set(lex.phrases.map((p) => p.toLowerCase()));
  const regex = lex.regex.map((r) => ({ name: r.name, re: new RegExp(r.pattern, "i") }));
  return { phrases, regex };
}

export function getCompiledLexicon() {
  if (cached) return cached;
  cached = compile(loadLexicon());
  return cached;
}

// For tests — inject a custom lexicon without touching the JSON file.
export function setCompiledLexiconForTesting(lex: Lexicon | null) {
  cached = lex == null ? null : compile(lex);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add data/moderation_lexicon.json src/core/chatModeration.ts
git commit -m "$(cat <<'EOF'
feat(moderation): empirically-derived lexicon JSON + boot loader

Lexicon at data/moderation_lexicon.json: ~36 phrases + 4 regex,
derived from comparing Queensland Approved (peer-group abuse corpus)
to Suncoast V3 (target community) — phrases that fire heavily in
the abuse corpus and not at all in the target community.

chatModeration.ts loads + compiles at first use; cache shared across
calls. setCompiledLexiconForTesting allows tests to inject without
touching the JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Normaliser + `findHits`

**Files:**
- Modify: `src/core/chatModeration.ts`
- Create: `src/core/chatModerationNormaliser.test.ts`
- Create: `src/core/chatModerationFindHits.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `src/core/chatModerationNormaliser.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { normalize } from "./chatModeration.ts";

test("lowercases", () => {
  assert.equal(normalize("PM Me"), "pm me");
});

test("decodes leet substitutions", () => {
  assert.equal(normalize("p1ck up"), "pick up");
  assert.equal(normalize("h1t m3 up"), "hit me up");
  assert.equal(normalize("c0k3"), "coke");
  assert.equal(normalize("@cid"), "acid");
  assert.equal(normalize("$ell"), "sell");
});

test("collapses non-alphanumerics to single space", () => {
  assert.equal(normalize("p.m. me"), "pm me");
  assert.equal(normalize("p_m_me"), "p m me");
  assert.equal(normalize("p-m-me"), "p m me");
});

test("collapses whitespace and trims", () => {
  assert.equal(normalize("   hit    me     up   "), "hit me up");
});

test("preserves digits inside alphanumerics", () => {
  assert.equal(normalize("user123"), "user123");
});
```

Create `src/core/chatModerationFindHits.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  findHits,
  setCompiledLexiconForTesting,
} from "./chatModeration.ts";

test.beforeEach(() => {
  setCompiledLexiconForTesting({
    version: "test",
    phrases: ["pm me", "hit me up", "selling", "wickr"],
    regex: [
      { name: "phone", pattern: "\\b\\+?\\d[\\d\\s\\-]{7,}\\d\\b" },
      { name: "tme_invite", pattern: "t\\.me/\\+" },
    ],
  });
});

test.afterEach(() => {
  setCompiledLexiconForTesting(null);
});

test("matches a phrase verbatim", () => {
  const r = findHits("hey pm me about that");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "phrase");
});

test("matches phrase after leet normalisation", () => {
  const r = findHits("p.m. m3 about that");
  assert.equal(r.matched, true);
});

test("matches phrase with mixed punctuation", () => {
  const r = findHits("Hit-me-up later?");
  assert.equal(r.matched, true);
});

test("does not match an unrelated message", () => {
  const r = findHits("the surf was good today");
  assert.equal(r.matched, false);
});

test("phrase boundary safety: 'sell' inside 'selling' counts (substring), 'pm me' inside 'compm me' does not", () => {
  // Phrases match on word-boundary. 'sell' would match 'selling'? No — phrases
  // are literal, padded with spaces. 'sell' is not in our phrase list, so no.
  // Test that 'pm me' inside 'compm me' is rejected by the boundary padding.
  const r = findHits("Welcompm me to the group");
  assert.equal(r.matched, false);
});

test("regex match returns the regex name as source", () => {
  const r = findHits("call me on +61 412 345 678");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_phone");
});

test("regex matches against original text, not normalised", () => {
  // Phone-format regex would not match if punctuation was stripped to spaces
  // because it expects digit groups; ensure original text is the regex input.
  const r = findHits("number is +61-412-345-678");
  assert.equal(r.matched, true);
});

test("regex on tme invite link", () => {
  const r = findHits("join at t.me/+abcDEF123");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.source, "regex_tme_invite");
});
```

Append both test files to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `normalize` and `findHits` are not exported.

- [ ] **Step 3: Implement in `chatModeration.ts`**

Append to `src/core/chatModeration.ts`:

```ts
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  "$": "s",
};

export function normalize(text: string): string {
  let out = text.toLowerCase();
  // Decode leet — but only for standalone characters, not inside words like
  // user123. Apply by replacing each char in a pass; the punctuation collapse
  // below means runs of digits inside alphanumerics survive intact (because
  // they are not preceded/followed by a letter that would form a leet pair).
  out = out
    .split("")
    .map((c) => LEET_MAP[c] ?? c)
    .join("");
  // Collapse runs of non-alphanumerics to a single space, then collapse whitespace.
  out = out.replace(/[^a-z0-9]+/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export function findHits(text: string): HitResult {
  const { phrases, regex } = getCompiledLexicon();

  // Phrase pass: normalise + word-boundary match.
  const padded = ` ${normalize(text)} `;
  for (const phrase of phrases) {
    if (padded.includes(` ${phrase} `)) {
      return { matched: true, source: "phrase" };
    }
  }

  // Regex pass: match against original (non-normalised) text. Format-perfect
  // patterns like phone numbers and wallet addresses must see the original
  // punctuation/casing.
  for (const { name, re } of regex) {
    if (re.test(text)) {
      return { matched: true, source: `regex_${name}` };
    }
  }

  return { matched: false };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/chatModeration.ts src/core/chatModerationNormaliser.test.ts src/core/chatModerationFindHits.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(moderation): normaliser + findHits scanner

normalize(): lowercase, leet-decode, collapse non-alphanumerics to
spaces, trim. findHits(): phrase pass against normalised text with
word-boundary padding; regex pass against original text for
format-perfect matches (phones, wallets, invite links).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Strikes store with 30-day decay

**Files:**
- Create: `src/core/chatStrikesStore.ts`
- Create: `src/core/chatStrikesStore.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `src/core/chatStrikesStore.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeNextStrikeCount,
  STRIKE_DECAY_DAYS,
} from "./chatStrikesStore.ts";

test("first strike returns 1 when no existing row", () => {
  const next = computeNextStrikeCount(null, new Date());
  assert.equal(next, 1);
});

test("second strike within window increments to 2", () => {
  const lastStrikeAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const next = computeNextStrikeCount({ count: 1, lastStrikeAt }, new Date());
  assert.equal(next, 2);
});

test("third strike within window increments to 3", () => {
  const lastStrikeAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const next = computeNextStrikeCount({ count: 2, lastStrikeAt }, new Date());
  assert.equal(next, 3);
});

test("strike outside decay window resets to 1", () => {
  const lastStrikeAt = new Date(
    Date.now() - (STRIKE_DECAY_DAYS + 1) * 24 * 60 * 60 * 1000,
  );
  const next = computeNextStrikeCount({ count: 2, lastStrikeAt }, new Date());
  assert.equal(next, 1);
});

test("strike exactly at the decay boundary still counts (window is inclusive)", () => {
  const now = new Date();
  const lastStrikeAt = new Date(now.getTime() - STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000);
  const next = computeNextStrikeCount({ count: 1, lastStrikeAt }, now);
  assert.equal(next, 2);
});
```

Append to `package.json` `test` script: `src/core/chatStrikesStore.test.ts`.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement the pure helper + DB round-trip in `chatStrikesStore.ts`**

Create `src/core/chatStrikesStore.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";

import { db } from "./storage/db.ts";
import { chatStrikes } from "./storage/schema.ts";

export const STRIKE_DECAY_DAYS = 30;

// Pure decision function — testable without DB.
export function computeNextStrikeCount(
  existing: { count: number; lastStrikeAt: Date } | null,
  now: Date,
): number {
  if (!existing) return 1;
  const ageMs = now.getTime() - existing.lastStrikeAt.getTime();
  const decayMs = STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs > decayMs) return 1;
  return existing.count + 1;
}

export type RecordStrikeInput = {
  chatId: number;
  telegramId: number;
  reason: string;
  now?: Date;
};

export type RecordStrikeResult = {
  count: number;
  lastReason: string;
};

// Records a strike. Returns the new count post-record. Uses
// INSERT ... ON CONFLICT DO UPDATE so concurrent webhooks can't double-count.
export async function recordStrike(input: RecordStrikeInput): Promise<RecordStrikeResult> {
  const now = input.now ?? new Date();

  const existingRows = await db
    .select({ count: chatStrikes.count, lastStrikeAt: chatStrikes.lastStrikeAt })
    .from(chatStrikes)
    .where(
      and(
        eq(chatStrikes.chatId, input.chatId),
        eq(chatStrikes.telegramId, input.telegramId),
      ),
    )
    .limit(1);

  const existing = existingRows[0] ?? null;
  const nextCount = computeNextStrikeCount(existing, now);

  await db
    .insert(chatStrikes)
    .values({
      chatId: input.chatId,
      telegramId: input.telegramId,
      count: nextCount,
      lastStrikeAt: now,
      lastReason: input.reason,
    })
    .onConflictDoUpdate({
      target: [chatStrikes.chatId, chatStrikes.telegramId],
      set: {
        count: nextCount,
        lastStrikeAt: now,
        lastReason: input.reason,
      },
    });

  return { count: nextCount, lastReason: input.reason };
}

export async function clearStrikes(input: {
  chatId: number;
  telegramId: number;
}): Promise<void> {
  await db
    .delete(chatStrikes)
    .where(
      and(
        eq(chatStrikes.chatId, input.chatId),
        eq(chatStrikes.telegramId, input.telegramId),
      ),
    );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 5: Commit**

```bash
git add src/core/chatStrikesStore.ts src/core/chatStrikesStore.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(moderation): chat strikes store with 30-day decay

computeNextStrikeCount is a pure function: returns 1 if no existing
row or last strike is older than 30 days, else existing.count + 1.
recordStrike uses INSERT ... ON CONFLICT DO UPDATE for concurrent-
webhook safety. clearStrikes deletes the row outright.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `restrictChatMember` and `banChatMember` in telegram tools

**Files:**
- Modify: `src/core/tools/telegramTools.ts`

- [ ] **Step 1: Implement the wrappers**

Append to `src/core/tools/telegramTools.ts` (after `deleteTelegramMessage`):

```ts
export async function restrictChatMember(
  input: {
    chatId: number;
    telegramId: number;
    untilDate?: number; // Unix seconds; undefined = forever
    canSendMessages?: boolean; // default false (mute)
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
  input: {
    chatId: number;
    telegramId: number;
    untilDate?: number; // Unix seconds; undefined = permanent
  },
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/core/tools/telegramTools.ts
git commit -m "$(cat <<'EOF'
feat(telegram): add restrictChatMember and banChatMember wrappers

Mirror the existing deleteTelegramMessage shape: withTelegramRetry +
callTelegramAPI. restrictChatMember sends an explicit Permissions
object with can_send_messages=false (mute by default); banChatMember
omits until_date for permanent. Used by the moderation strikes
ladder (next task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Strikes ladder — pure decision function + tests

**Files:**
- Create: `src/core/chatModerationLadder.ts`
- Create: `src/core/chatModerationLadder.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `src/core/chatModerationLadder.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { decideStrikeAction, MUTE_DURATION_HOURS } from "./chatModerationLadder.ts";

test("strike count 1 → warn", () => {
  const a = decideStrikeAction(1);
  assert.equal(a.kind, "warn");
});

test("strike count 2 → mute for 24 hours", () => {
  const a = decideStrikeAction(2);
  assert.equal(a.kind, "mute");
  if (a.kind === "mute") assert.equal(a.durationHours, MUTE_DURATION_HOURS);
});

test("strike count 3 → ban", () => {
  const a = decideStrikeAction(3);
  assert.equal(a.kind, "ban");
});

test("strike count 4+ also bans (cap)", () => {
  assert.equal(decideStrikeAction(4).kind, "ban");
  assert.equal(decideStrikeAction(99).kind, "ban");
});

test("strike count 0 is invalid (defensive)", () => {
  assert.throws(() => decideStrikeAction(0));
});
```

Append `src/core/chatModerationLadder.test.ts` to `package.json`.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/core/chatModerationLadder.ts`:

```ts
export const MUTE_DURATION_HOURS = 24;

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
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/chatModerationLadder.ts src/core/chatModerationLadder.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(moderation): strikes ladder pure decision function

decideStrikeAction(count): 1 → warn, 2 → 24h mute, 3+ → ban.
Pure function; testable without DB or Telegram. Ladder enforcement
wires this to the telegram tools in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire moderation into `telegramBot.ts` group-message handler

**Files:**
- Modify: `src/telegramBot.ts`

- [ ] **Step 1: Add imports**

In the import block at the top of `src/telegramBot.ts`, add:

```ts
import { findHits } from "./core/chatModeration.ts";
import { recordStrike, clearStrikes } from "./core/chatStrikesStore.ts";
import { decideStrikeAction, MUTE_DURATION_HOURS } from "./core/chatModerationLadder.ts";
import {
  banChatMember,
  restrictChatMember,
} from "./core/tools/telegramTools.ts";
```

- [ ] **Step 2: Implement `runChatModeration`**

Add a new function near the top of the group-message section of the file (above `handleGroupMessage`):

```ts
async function runChatModeration(
  message: any,
  logger?: LoggerLike,
): Promise<{ deleted: boolean }> {
  // Skip when there's no sender (e.g., service messages already handled
  // upstream) or when the bot itself is the sender.
  const fromId = message.from?.id;
  if (!fromId) return { deleted: false };

  // Admins are exempt from strikes. Audit-log the hit for visibility but
  // take no enforcement action.
  const isAdminSender = isAdmin(fromId);

  // Compose the text to scan: text + caption (when this is a media message).
  const text = typeof message.text === "string" ? message.text : "";
  const caption = typeof message.caption === "string" ? message.caption : "";
  const combined = [text, caption].filter((s) => s.length > 0).join("\n");
  if (combined.length === 0) return { deleted: false };

  const hit = findHits(combined);
  if (!hit.matched) return { deleted: false };

  // Audit row first — if a later step throws, we still know what happened.
  await recordAdminAction({
    adminTelegramId: fromId,
    adminUsername: message.from?.username ?? null,
    command: "chat_moderation:delete",
    targetChatId: message.chat.id,
    targetUsername: message.from?.username ?? null,
    reason: isAdminSender ? `${hit.source} (admin_exempt)` : hit.source,
    denied: false,
  });

  if (isAdminSender) {
    return { deleted: false };
  }

  // Delete the offending message.
  try {
    await deleteTelegramMessage(
      { chatId: message.chat.id, messageId: message.message_id },
      logger,
    );
  } catch (error) {
    logger?.warn?.(
      { error, chatId: message.chat.id, messageId: message.message_id },
      "chatModeration: deleteMessage failed",
    );
    // Continue even if the delete failed — the strike still applies.
  }

  // Record + decide + enforce.
  const { count } = await recordStrike({
    chatId: message.chat.id,
    telegramId: fromId,
    reason: hit.source,
  });
  const action = decideStrikeAction(count);

  const groupName = message.chat.title ?? `chat ${message.chat.id}`;

  if (action.kind === "warn") {
    await safeSendDm(
      fromId,
      `Your message in <b>${escapeHtml(groupName)}</b> was removed. The Vouch Hub has rules against arrangement-shaped chat. Two more removals in 30 days will mute you for 24 hours.`,
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
      logger?.warn?.({ error, fromId }, "chatModeration: restrictChatMember failed");
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
    logger?.warn?.({ error, fromId }, "chatModeration: banChatMember failed");
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
  logger?: LoggerLike,
): Promise<void> {
  try {
    await sendTelegramMessage({ chatId: telegramId, text: htmlText }, logger);
  } catch (error) {
    // The user may have blocked the bot or never DM'd it. Non-fatal —
    // the moderation action stands either way.
    logger?.info?.({ error, telegramId }, "chatModeration: DM delivery failed (non-fatal)");
  }
}
```

(Note: `escapeHtml` already exported from `archive.ts` — import if not already present.)

- [ ] **Step 3: Hook the moderation step into `handleGroupMessage`**

At the top of `handleGroupMessage` (right after the migration / `migrate_to_chat_id` early returns and before the command-parse logic), add:

```ts
async function handleGroupMessage(message: any, logger?: LoggerLike) {
  const migration = parseChatMigration(message);
  if (migration) {
    // ... existing migration handling unchanged ...
  }
  if (message?.migrate_to_chat_id != null) {
    return;
  }

  // ── Chat moderation step (runs first; deletes block subsequent handling).
  const mod = await runChatModeration(message, logger);
  if (mod.deleted) return;

  // ... existing command parsing continues ...
}
```

- [ ] **Step 4: Hook into edited messages**

Find the entry point that processes `edited_message` updates (or add one if missing). Edited messages reach `processTelegramUpdate` via `payload.edited_message`. Route them through `runChatModeration` similarly:

In the dispatcher area of `processTelegramUpdate` (search for where `payload.message` is handled), add an analogous branch:

```ts
if (payload.edited_message) {
  const editedMessage = payload.edited_message;
  const editedChatType = editedMessage.chat?.type;
  if (editedChatType !== "private" && allowedTelegramChatIds.has(editedMessage.chat?.id)) {
    await runChatModeration(editedMessage, logger);
  }
  // (Edits in private chats / disallowed chats are ignored — same as messages.)
}
```

- [ ] **Step 5: Wire `/clear_strikes` admin command**

In the admin-command branch of `handleGroupMessage` (search for `"/admin_help"` to find the existing list of admin commands), add `/clear_strikes` to the recognised set, then in `handleAdminCommand` add:

```ts
if (input.command === "/clear_strikes") {
  const targetUsername = normalizeUsername(input.args[0] ?? "");
  if (!targetUsername) {
    await sendTelegramMessage(
      { chatId: input.chatId, text: "Use: /clear_strikes @username." },
      input.logger,
    );
    return;
  }

  // Resolve username → telegram_id via business_profiles or users.
  const profile = await getBusinessProfileByUsername(targetUsername);
  if (!profile?.telegramId) {
    await sendTelegramMessage(
      {
        chatId: input.chatId,
        text: `No telegram_id known for ${formatUsername(targetUsername)}.`,
      },
      input.logger,
    );
    return;
  }

  await clearStrikes({ chatId: input.chatId, telegramId: profile.telegramId });
  await recordAdminAction({
    adminTelegramId: input.from.id,
    adminUsername: input.from.username ?? null,
    command: input.command,
    targetChatId: input.chatId,
    targetUsername,
    denied: false,
  });
  await sendTelegramMessage(
    {
      chatId: input.chatId,
      text: `Strikes cleared for ${formatUsername(targetUsername)} in this chat.`,
    },
    input.logger,
  );
  return;
}
```

Also add `/clear_strikes` to the `buildAdminHelpText` list in `archive.ts`:

```ts
"/clear_strikes @x — clear chat-moderation strikes",
```

- [ ] **Step 6: Type-check + run tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add src/telegramBot.ts src/core/archive.ts
git commit -m "$(cat <<'EOF'
feat(moderation): wire chat moderation into group + edited-message paths

runChatModeration runs first in handleGroupMessage and on every
edited_message update for any allowed chat: scan text+caption, on
hit delete the message and apply the strike action (warn / 24h mute
via restrictChatMember / ban via banChatMember). Admins are exempt;
their hits are audit-logged with admin_exempt suffix but take no
action. /clear_strikes admin command resets a user's strike row in
the current chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: OPSEC runbook — moderation lookup section

**Files:**
- Modify: `docs/runbook/opsec.md`

- [ ] **Step 1: Append §6b to OPSEC runbook**

Insert after §6a (the lexicon reference appendix) and before §7 (appeals contacts):

```markdown
---

## 6b. Chat moderation — admin reference

The bot moderates every member message in any allowed chat using the lexicon at `data/moderation_lexicon.json` and the strikes ladder defined in `src/core/chatModerationLadder.ts`. Strikes ladder:

| Strike | Action | Reversible by |
|---|---|---|
| 1 | Delete + warn DM | Auto-decay after 30 days, or `/clear_strikes @x` |
| 2 | Delete + 24h mute | Mute auto-expires; `/clear_strikes @x` resets the count |
| 3 | Delete + permanent ban | Telegram native unban + `/clear_strikes @x` |

Audit log query for moderation events in the last 7 days:

\`\`\`
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, target_username, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND created_at > now() - interval '7 days' ORDER BY created_at DESC"
\`\`\`

Current strike state for a specific user across all chats:

\`\`\`
psql "$DATABASE_URL" -c "SELECT chat_id, count, last_strike_at, last_reason FROM chat_strikes WHERE telegram_id=<id>"
\`\`\`

Updating the lexicon: edit `data/moderation_lexicon.json` in the repo, commit, deploy. Lexicon is loaded at boot; no admin command. The version field is informational; bump it on changes for audit-log correlation if desired.

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/opsec.md
git commit -m "$(cat <<'EOF'
docs(opsec): chat moderation §6b — strikes ladder + audit queries

Admin reference for the new chat moderation: ladder summary, SQL
queries to inspect recent moderation events and per-user strike
state, lexicon update procedure (PR + deploy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: DEPLOY.md — apply migration on next deploy

**Files:**
- Modify: `DEPLOY.md`

- [ ] **Step 1: Note the new migration in §8**

In `DEPLOY.md` Step 8 (or wherever the migration step lives), no edit is needed — `npm run db:migrate` runs all pending migrations. But add a note in the runbook at the bottom of `DEPLOY.md`:

After the existing `## Step 13 — Vendetta-resistant posture: legacy NEG cleanup`, add:

```markdown
## Step 14 — Chat moderation v2 enablement (one-time, after deploy)

After v2 ships and `npm run db:migrate` has applied `0009_chat_strikes.sql`, enable member chat in any group you want moderated:

1. In Telegram → group settings → Permissions → enable "Send messages" for members.
2. Recommended: also set Slow Mode to 30 seconds and disable "Send media" / "Send links" / "Send polls" so members can only send text. Telegram's native restrictions reduce attack surface; the bot lexicon catches the rest.
3. The bot starts moderating automatically on the next member message in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`. No bot-side configuration.
4. Watch `admin_audit_log` for `command='chat_moderation:delete'` rows for the first week to verify false-positive rate is acceptable. If a phrase is over-firing, edit `data/moderation_lexicon.json` in the repo and redeploy.
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(deploy): chat moderation v2 enablement step

After v2 deploys and migrations apply, enable member chat in
Telegram group settings; bot moderation starts automatically.
Recommends Telegram-native slow mode + media restriction as
complementary defences.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green, including the four new test files.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify the commits**

Run: `git log --oneline -10`
Expected: 8 new commits + the spec commit at the start, each scoped + with the Co-Authored-By trailer.

- [ ] **Step 4: Report to user**

Brief summary: tasks done, commits hash range, lexicon size, migration to apply on deploy.

Do **not** push.

---

## Self-review checklist

**Spec coverage (each numbered §):**

- §4.1 Lexicon JSON → Task 2
- §4.2 Normaliser + findHits → Task 3
- §4.3 Strike state schema → Task 1
- §4.4 Strikes ladder → Tasks 4 + 6
- §4.5 What gets scanned → Task 7 (text + caption + edited_message)
- §4.6 Multi-group behaviour → Task 7 (no per-chat config; runs on every allowed chat)
- §4.7 Audit log → Task 7 (recordAdminAction in runChatModeration)
- §4.8 Admin overrides → Task 7 (/clear_strikes)
- §5 Architecture → Tasks 1-7
- §6 Verification → Final verification
- §7 Risks → captured in spec; no code task
- §8 Out of scope → no code task
- §9 Forward compatibility → no code task (the implementation is multi-group-clean by construction)
- §10 Approach B upgrade path → not built (deferred)

**Placeholders:** none.

**Type / symbol consistency:**
- `findHits` defined in Task 3, consumed in Task 7 ✓
- `recordStrike` / `clearStrikes` defined in Task 4, consumed in Task 7 ✓
- `decideStrikeAction` / `MUTE_DURATION_HOURS` defined in Task 6, consumed in Task 7 ✓
- `restrictChatMember` / `banChatMember` defined in Task 5, consumed in Task 7 ✓
- `chatStrikes` table defined in Task 1, consumed in Task 4 ✓

All consistent. No spec requirement without a task.
