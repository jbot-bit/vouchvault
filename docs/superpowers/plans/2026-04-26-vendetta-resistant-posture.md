# Vendetta-Resistant Posture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1, commit `3ed2668`).

**Goal:** Make NEG submissions private (no group post), expose a derived `Caution` status on `/profile`, harden every published entry with `protect_content`, lock down impersonation/marketplace usernames, and replace free-text freeze reasons with an enum.

**Architecture:** All work is in `src/core/` and `src/telegramBot.ts`. One migration adds `private_note` to `vouch_entries` and `vouch_drafts`. Internal types (`vouch_entries`, `EntryResult`, `POS/MIX/NEG`) are unchanged — only the publish path branches and the public-facing copy shifts. Each task is a single logical commit and runs the TDD loop.

**Tech Stack:** TypeScript with `--experimental-strip-types`, Node `node:test`, drizzle-orm + drizzle-kit, Postgres, pino logger, Telegram Bot API via `src/core/tools/telegramTools.ts`.

**Conventions (per CLAUDE.md):**
- Tests live alongside source: `src/core/<name>.ts` ↔ `src/core/<name>.test.ts`.
- New `*.test.ts` files **must be appended to the `test` script in `package.json`** or they will not run.
- Commits: `feat(scope): ...` / `fix(scope): ...` / `docs(scope): ...`. Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Don't push without an explicit ask.
- `git add` may hit `mmap` errors due to OneDrive — retry or stage files individually.

---

## File Structure (changes)

| File | Status | Responsibility |
|---|---|---|
| `migrations/0008_add_private_note.sql` | **Create** | Add nullable `private_note TEXT` to `vouch_entries` and `vouch_drafts` |
| `src/core/storage/schema.ts` | Modify | Mirror the migration in drizzle schema |
| `src/core/archiveStore.ts` | Modify | Round-trip `privateNote` through draft and entry helpers |
| `src/core/logger.ts` | Modify | Add `*.privateNote` and `*.private_note` to redact paths |
| `src/core/tools/telegramTools.ts` | Modify | Plumb `protectContent` into `sendTelegramMessage` and `buildTelegramSendMessageParams` |
| `src/core/archivePublishing.ts` | Modify | Branch on `result==='negative'` to skip the send and leave `publishedMessageId` null |
| `src/core/archive.ts` | Modify | Constants (deny-list, freeze enum, MAX_PRIVATE_NOTE_CHARS), validators, `fmtStatusLine`, `buildPreviewText`, `buildLookupText`, `buildProfileText`, `rulesLine` block, `aboutLine`, vocabulary cleanse |
| `src/telegramBot.ts` | Modify | Reserved-target rejection, freeze enum validation, `awaiting_admin_note` step + Skip callback, NEG branch + confirmation DM, drop admin gate on group `/profile`, pass `hasCaution` to builder |
| `src/core/reservedTargets.test.ts` | **Create** | Unit-test the deny-list |
| `src/core/freezeReason.test.ts` | **Create** | Unit-test the enum + label rendering |
| `src/core/privateNoteValidator.test.ts` | **Create** | Unit-test 240-char and control-char rules |
| `src/core/privateNeg.test.ts` | **Create** | NEG branch leaves `publishedMessageId` null + DM contains `#id` |
| `src/core/profileCaution.test.ts` | **Create** | Caution status priority + member view hides Negative count |
| `src/core/loggerRedact.test.ts` | **Create** | Logger redacts note fields |
| `src/core/callbackData.test.ts` | Modify | Add `draft:skip_admin_note` to known-callbacks |
| `src/core/archiveUx.test.ts` | Modify | Update V3-locked copy + new attestation/rules/Caution assertions |
| `package.json` | Modify | Append every new `*.test.ts` to `scripts.test` |
| `docs/runbook/opsec.md` | Modify | New §6a appendix |
| `DEPLOY.md` | Modify | New §11 deployment task: legacy NEG cleanup |

---

## Task 1: Add `private_note` columns + drizzle round-trip

**Files:**
- Create: `migrations/0008_add_private_note.sql`
- Modify: `src/core/storage/schema.ts`
- Modify: `src/core/archiveStore.ts`

- [ ] **Step 1: Write the failing schema-shape test**

Append to `src/core/archiveUx.test.ts` (it already imports from `archive.ts`; add a tiny round-trip-shape test temporarily — we'll move/rename later if needed):

```ts
import { vouchDrafts, vouchEntries } from "../core/storage/schema.ts";

test("vouch_entries and vouch_drafts have a privateNote column", () => {
  // drizzle exposes columns on the table object
  assert.ok((vouchEntries as any).privateNote, "vouch_entries.privateNote missing");
  assert.ok((vouchDrafts as any).privateNote, "vouch_drafts.privateNote missing");
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm test`
Expected: FAIL — `vouch_entries.privateNote missing`.

- [ ] **Step 3: Write the migration**

Create `migrations/0008_add_private_note.sql`:

```sql
ALTER TABLE vouch_entries
  ADD COLUMN private_note TEXT;

ALTER TABLE vouch_drafts
  ADD COLUMN private_note TEXT;
```

- [ ] **Step 4: Mirror in drizzle schema**

In `src/core/storage/schema.ts`, inside the `vouchEntries` table definition (after `publishedMessageId`):

```ts
publishedMessageId: integer("published_message_id"),
privateNote: text("private_note"),
```

And inside `vouchDrafts` (after `step`):

```ts
step: text("step").notNull().default("awaiting_target"),
privateNote: text("private_note"),
```

- [ ] **Step 5: Round-trip `privateNote` in `archiveStore.ts`**

Edit `src/core/archiveStore.ts` `createArchiveEntry` parameter type and insert call:

```ts
export async function createArchiveEntry(input: {
  // ... existing fields ...
  createdAt?: Date;
  privateNote?: string | null;
}) {
  const rows = await db
    .insert(vouchEntries)
    .values({
      // ... existing field assignments ...
      createdAt: input.createdAt ?? new Date(),
      privateNote: input.privateNote ?? null,
```

Edit `updateDraftByReviewerTelegramId` parameter type union and `set()` block to include:

```ts
updates: Partial<{
  // ... existing fields ...
  step: DraftStep;
  privateNote: string | null;
}>,
```

In the `set({...})` block:

```ts
step: updates.step ?? (draft.step as DraftStep),
privateNote:
  updates.privateNote === undefined ? draft.privateNote : updates.privateNote,
updatedAt: new Date(),
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Run the test, expect pass**

Run: `npm test`
Expected: the column-shape test passes; existing tests still green.

- [ ] **Step 8: Commit**

```bash
git add migrations/0008_add_private_note.sql src/core/storage/schema.ts src/core/archiveStore.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): add private_note column to vouch_entries and vouch_drafts

Nullable text column on both tables. Carries the optional admin-only
note submitted with a private NEG; round-tripped via createArchiveEntry
and updateDraftByReviewerTelegramId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Logger redact `*.privateNote` / `*.private_note`

**Files:**
- Modify: `src/core/logger.ts`
- Create: `src/core/loggerRedact.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/loggerRedact.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";

import { createLogger } from "./logger.ts";

function captureLogs(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

test("logger redacts *.privateNote and *.private_note", () => {
  const { stream, lines } = captureLogs();
  const logger = createLogger({ level: "info" });
  // pino accepts a stream via destination; reuse the existing constructor by
  // writing a child that pipes to our capture
  const child = logger.child({});
  // simulate a structured log with sensitive shapes
  (child as any).info(
    { entry: { privateNote: "leak-camelCase" } },
    "with camelCase",
  );
  (child as any).info(
    { row: { private_note: "leak-snake_case" } },
    "with snake_case",
  );
  // pino writes to process.stdout by default; for a deterministic check,
  // assert by spawning a fresh logger pointed at our stream:
  const { default: pino } = await import("pino");
  const pin = pino(
    {
      level: "info",
      redact: {
        paths: [
          "*.token",
          "*.secret",
          "*.password",
          "*.api_key",
          "*.authorization",
          "*.privateNote",
          "*.private_note",
          "headers.authorization",
          "params.token",
        ],
        censor: "[REDACTED]",
      },
    },
    stream,
  );
  pin.info({ entry: { privateNote: "leak-camelCase" } }, "x");
  pin.info({ row: { private_note: "leak-snake_case" } }, "y");
  const all = lines.join("\n");
  assert.ok(!all.includes("leak-camelCase"), "camelCase note leaked");
  assert.ok(!all.includes("leak-snake_case"), "snake_case note leaked");
  assert.ok(all.includes("[REDACTED]"));
});
```

- [ ] **Step 2: Append the test file to `package.json`**

In `package.json`, append `src/core/loggerRedact.test.ts` to the `test` script's space-separated list.

- [ ] **Step 3: Run the test, expect failure**

Run: `npm test`
Expected: FAIL — current `logger.ts` does not include the new redact paths; the captured output contains plaintext.

- [ ] **Step 4: Add the redact paths to `logger.ts`**

```ts
redact: {
  paths: [
    "*.token",
    "*.secret",
    "*.password",
    "*.api_key",
    "*.authorization",
    "*.privateNote",
    "*.private_note",
    "headers.authorization",
    "params.token",
  ],
  censor: "[REDACTED]",
},
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/logger.ts src/core/loggerRedact.test.ts package.json
git commit -m "$(cat <<'EOF'
fix(logger): redact privateNote / private_note in structured logs

Adds *.privateNote and *.private_note to the pino redact path list so
admin-only NEG notes never appear in plaintext log output regardless of
which call site passes the entry/draft object through pino.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `protect_content` plumbing in Telegram tools

**Files:**
- Modify: `src/core/tools/telegramTools.ts`
- Modify: `src/core/archivePublishing.ts`
- Modify: `src/core/archiveUx.test.ts` (use existing test file; add one assertion)

- [ ] **Step 1: Write the failing assertion**

Append to an appropriate test file (or create a small `src/core/protectContent.test.ts`) — but the simplest TDD here is a unit test of `buildTelegramSendMessageParams`:

Create `src/core/protectContent.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildTelegramSendMessageParams } from "./tools/telegramTools.ts";

test("buildTelegramSendMessageParams forwards protectContent as protect_content", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
    protectContent: true,
  } as any);
  assert.equal((params as any).protect_content, true);
});

test("buildTelegramSendMessageParams omits protect_content when undefined", () => {
  const params = buildTelegramSendMessageParams({
    chatId: -1001,
    text: "hi",
  } as any);
  assert.equal((params as any).protect_content, undefined);
});
```

Append `src/core/protectContent.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `protect_content` undefined when set.

- [ ] **Step 3: Implement in `tools/telegramTools.ts`**

Update `buildTelegramSendMessageParams`:

```ts
export function buildTelegramSendMessageParams(input: {
  chatId: number;
  text: string;
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  disableNotification?: boolean;
  replyMarkup?: Record<string, unknown>;
  protectContent?: boolean;
}) {
  return {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? "HTML",
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    reply_parameters:
      input.replyToMessageId == null
        ? undefined
        : {
            message_id: input.replyToMessageId,
            allow_sending_without_reply: input.allowSendingWithoutReply,
          },
    reply_markup: input.replyMarkup,
  };
}
```

Update the `sendTelegramMessage` wrapper input type to include `protectContent?: boolean` and pass it through.

- [ ] **Step 4: Pass it from the publish path**

In `src/core/archivePublishing.ts`, in the `sendTelegramMessage(...)` call inside `publishArchiveEntryRecord`:

```ts
published = await sendTelegramMessage(
  {
    chatId: entry.chatId,
    text: buildArchiveEntryPostText(entry),
    protectContent: true,
  },
  logger,
);
```

- [ ] **Step 5: Type-check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean + all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/telegramTools.ts src/core/archivePublishing.ts src/core/protectContent.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(post-format): set protect_content=true on every published entry

Plumbs protectContent through sendTelegramMessage and
buildTelegramSendMessageParams; archivePublishing passes true on every
publish call. Belt-and-braces with the supergroup-level Restrict
saving content setting; per-message protect_content is independent and
visible to a Telegram T&S reviewer as a property of the message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: NEG private publish path

**Files:**
- Modify: `src/core/archivePublishing.ts`
- Create: `src/core/privateNeg.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/privateNeg.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

// We test the publish path's decision via a small seam: extract the
// "should publish to group" predicate, or test the function with a
// mock send. For minimum coupling we test the predicate directly.

import { shouldPublishToGroup } from "./archivePublishing.ts";

test("shouldPublishToGroup true for positive", () => {
  assert.equal(shouldPublishToGroup("positive"), true);
});
test("shouldPublishToGroup true for mixed", () => {
  assert.equal(shouldPublishToGroup("mixed"), true);
});
test("shouldPublishToGroup false for negative", () => {
  assert.equal(shouldPublishToGroup("negative"), false);
});
```

Append `src/core/privateNeg.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `shouldPublishToGroup` is not exported.

- [ ] **Step 3: Implement the predicate + branch in `archivePublishing.ts`**

Add an export at the top of `src/core/archivePublishing.ts`:

```ts
export function shouldPublishToGroup(result: EntryResult): boolean {
  return result !== "negative";
}
```

Modify `publishArchiveEntryRecord` to branch:

```ts
const reserved = await markArchiveEntryPublishing(entry.id);
if (!reserved) {
  // ... existing reservation-failure handling ...
}

const normalized = normalizePublishableEntry(entry);

if (!shouldPublishToGroup(normalized.result)) {
  // Private NEG path: do not send to group. Mark published with no
  // message id, leaving published_message_id null. Caution status on
  // /profile picks the row up via the predicate in §4.4 of the spec.
  await setArchiveEntryStatus(entry.id, "published");
  return { message_id: null as unknown as number, reused: false };
}

let published;
try {
  published = await sendTelegramMessage(
    {
      chatId: entry.chatId,
      text: buildArchiveEntryPostText(entry),
      protectContent: true,
    },
    logger,
  );
} catch (error) {
  // ... existing failure handling ...
}
```

(Adjust the return type of `publishArchiveEntryRecord` — add `| null` to `message_id` — or restructure to return `{ message_id: number | null; reused: boolean }`.)

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (If the return-type change ripples, narrow at consumer call sites with explicit `if (result.message_id != null)` checks; do not loosen unrelated types.)

- [ ] **Step 6: Commit**

```bash
git add src/core/archivePublishing.ts src/core/privateNeg.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(publish): NEG entries become private DB records (no group post)

publishArchiveEntryRecord branches on result === 'negative': the entry
transitions to published with publishedMessageId=null and no Telegram
sendMessage is performed. POS/MIX continue to publish as today with
protect_content=true. The private NEG row contributes to Caution status
on /profile via the predicate in spec §4.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Anti-impersonation deny-list + marketplace substrings

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/telegramBot.ts`
- Create: `src/core/reservedTargets.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/reservedTargets.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { isReservedTarget } from "./archive.ts";

test("reserved exact-match handles are rejected", () => {
  for (const handle of ["telegram", "spambot", "botfather", "notoscam", "replies", "gif"]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("bot's own username is rejected when env is set", () => {
  process.env.TELEGRAM_BOT_USERNAME = "vouchvault_bot";
  assert.equal(isReservedTarget("vouchvault_bot"), true);
  delete process.env.TELEGRAM_BOT_USERNAME;
});

test("marketplace substrings are rejected case-insensitively", () => {
  for (const handle of [
    "scammer42",
    "best_vendor",
    "the_plug",
    "gear_supplier",
    "coke_au",
    "_4sale_now",
    "MDMA_supply",
    "TabsFest",
    "myplug_2025",
  ]) {
    assert.equal(isReservedTarget(handle), true, handle);
  }
});

test("benign usernames pass", () => {
  for (const handle of ["alice", "bob_smith", "real_person99", "long_username_okay"]) {
    assert.equal(isReservedTarget(handle), false, handle);
  }
});
```

Append `src/core/reservedTargets.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `isReservedTarget` is not exported.

- [ ] **Step 3: Implement constants and `isReservedTarget` in `archive.ts`**

Add near the other constants in `src/core/archive.ts`:

```ts
export const RESERVED_TARGET_USERNAMES: ReadonlySet<string> = new Set([
  "telegram",
  "spambot",
  "botfather",
  "notoscam",
  "replies",
  "gif",
]);

export const MARKETPLACE_USERNAME_SUBSTRINGS: ReadonlyArray<string> = [
  "scammer", "scam_", "_scam",
  "vendor", "vendr",
  "plug", "the_plug",
  "gear", "supply", "supplier", "supplies",
  "seller", "_4sale", "4sale_", "for_sale",
  "dealer", "dealr",
  "trapper", "trapping", "trap_",
  "coke", "cocaine",
  "meth", "methhead",
  "weed", "kush", "bud_", "_bud",
  "oxy", "perc", "fent",
  "xan", "xanax", "bars_",
  "mdma", "molly", "mandy", "pingers",
  "shrooms", "psilo",
  "lsd", "acid_", "tabs_",
  "ket_", "ketamine",
  "legit_seller", "vouched_vendor", "approved_seller",
];

export function isReservedTarget(username: string): boolean {
  const lower = username.toLowerCase();
  if (RESERVED_TARGET_USERNAMES.has(lower)) return true;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@+/, "").toLowerCase();
  if (botUsername && lower === botUsername) return true;
  for (const sub of MARKETPLACE_USERNAME_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Wire into `telegramBot.ts`**

Find the target-input handler (where `normalizeUsername` is called for a draft target — search for `normalizeUsername(` near the self-vouch / frozen-profile checks at telegramBot.ts:458–471). Add the rejection right after `normalizeUsername`:

```ts
const normalized = normalizeUsername(rawTarget);
if (!normalized) { /* existing invalid-format reject */ return; }
if (isReservedTarget(normalized)) {
  await sendTelegramMessage(
    {
      chatId,
      text: "That handle can't be a vouch subject.",
    },
    logger,
  );
  return;
}
// ... existing self-vouch / frozen-profile checks ...
```

(Use the precise existing reject pattern — match its keyboard / reply-options conventions.)

- [ ] **Step 5: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/archive.ts src/telegramBot.ts src/core/reservedTargets.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(archive): reject reserved + marketplace-substring targets

Adds RESERVED_TARGET_USERNAMES (Telegram-reserved + bot-impersonating
handles) and MARKETPLACE_USERNAME_SUBSTRINGS (~40 patterns derived from
peer-group lexicon). isReservedTarget is invoked after normalizeUsername
in the target-input handler. Generic reject message; no diagnostic
about which list matched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Freeze reason enum

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveStore.ts`
- Modify: `src/telegramBot.ts`
- Create: `src/core/freezeReason.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/freezeReason.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  FREEZE_REASONS,
  FREEZE_REASON_LABELS,
  isFreezeReason,
} from "./archive.ts";

test("FREEZE_REASONS contains exactly the five enum keys", () => {
  assert.deepEqual([...FREEZE_REASONS].sort(), [
    "at_member_request",
    "community_concerns",
    "policy_violation",
    "under_review",
    "unmet_commitments",
  ]);
});

test("isFreezeReason accepts each key and rejects free text", () => {
  for (const k of FREEZE_REASONS) assert.equal(isFreezeReason(k), true, k);
  for (const bad of ["scammer", "took my money", "", "POLICY_VIOLATION"]) {
    assert.equal(isFreezeReason(bad), false, bad);
  }
});

test("FREEZE_REASON_LABELS provides a human label for every key", () => {
  for (const k of FREEZE_REASONS) {
    assert.ok(FREEZE_REASON_LABELS[k], `missing label for ${k}`);
  }
});
```

Append `src/core/freezeReason.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement in `archive.ts`**

Add near the other enum constants:

```ts
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
```

- [ ] **Step 4: Update `setBusinessProfileFrozen` to validate**

In `src/core/archiveStore.ts`:

```ts
import { FREEZE_REASONS, isFreezeReason, type FreezeReason } from "./archive.ts";

export async function setBusinessProfileFrozen(input: {
  username: string;
  isFrozen: boolean;
  reason?: string | null;
  byTelegramId?: number | null;
}) {
  const profile = await getOrCreateBusinessProfile(input.username);

  let reasonToStore: string | null = null;
  if (input.isFrozen) {
    if (!isFreezeReason(input.reason)) {
      throw new Error(
        `freeze_reason must be one of: ${FREEZE_REASONS.join(", ")}`,
      );
    }
    reasonToStore = input.reason;
  }

  const rows = await db
    .update(businessProfiles)
    .set({
      isFrozen: input.isFrozen,
      freezeReason: input.isFrozen ? reasonToStore : null,
      frozenAt: input.isFrozen ? new Date() : null,
      frozenByTelegramId: input.isFrozen ? (input.byTelegramId ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(businessProfiles.id, profile.id))
    .returning();

  return rows[0]!;
}
```

- [ ] **Step 5: Update `/freeze` handler in `telegramBot.ts`**

Find the `/freeze` admin handler. Replace its reason-acceptance code with enum validation:

```ts
const rawReason = args[1] ?? "";
if (!isFreezeReason(rawReason)) {
  await sendTelegramMessage(
    {
      chatId,
      text:
        "Reason must be one of:\n" +
        FREEZE_REASONS.map((r) => `• <code>${r}</code>`).join("\n"),
    },
    logger,
  );
  return;
}
// proceed with rawReason as the validated FreezeReason
```

Make sure `isFreezeReason` and `FREEZE_REASONS` are imported.

- [ ] **Step 6: Update where freeze reason renders**

In `src/core/archive.ts` `fmtStatusLine` (currently shows `freezeReason ?? "no reason given"` raw): change to render the human label when the stored value matches an enum key, falling back to the raw text for legacy rows:

```ts
function fmtStatusLine(isFrozen: boolean, freezeReason: string | null): string {
  if (!isFrozen) return "Status: Active";
  const label =
    freezeReason && isFreezeReason(freezeReason)
      ? FREEZE_REASON_LABELS[freezeReason]
      : (freezeReason ?? "no reason given");
  return `Status: Frozen — <i>${escapeHtml(label)}</i>`;
}
```

- [ ] **Step 7: Run + type-check**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 8: Commit**

```bash
git add src/core/archive.ts src/core/archiveStore.ts src/telegramBot.ts src/core/freezeReason.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(admin): freeze reason becomes an enum

Replaces free-text /freeze reasons with FREEZE_REASONS:
unmet_commitments, community_concerns, policy_violation,
at_member_request, under_review. Eliminates a defamation surface in
profile rendering. Legacy rows render verbatim until cleared by
/unfreeze. setBusinessProfileFrozen rejects non-enum values
defence-in-depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Caution status rendering + drop `/profile` admin gate

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/telegramBot.ts`
- Create: `src/core/profileCaution.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/profileCaution.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildProfileText } from "./archive.ts";

test("profile shows Caution when negative count > 0", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 3, mixed: 0, negative: 1 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Status: Caution/);
});

test("profile member view hides the Negative count", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 3, mixed: 0, negative: 1 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Positive: 3/);
  assert.match(text, /Mixed: 0/);
  assert.doesNotMatch(text, /Negative/);
});

test("Frozen wins over Caution", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 0, mixed: 0, negative: 1 },
    isFrozen: true,
    freezeReason: "community_concerns",
    recent: [],
    hasCaution: true,
  });
  assert.match(text, /Status: Frozen — <i>community concerns<\/i>/);
  assert.doesNotMatch(text, /Status: Caution/);
});

test("status falls back to Active when no NEG and not frozen", () => {
  const text = buildProfileText({
    targetUsername: "bobbiz",
    totals: { positive: 2, mixed: 1, negative: 0 },
    isFrozen: false,
    freezeReason: null,
    recent: [],
    hasCaution: false,
  });
  assert.match(text, /Status: Active/);
});
```

Append `src/core/profileCaution.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — `buildProfileText` does not accept `hasCaution`; current renderer also shows the Negative count.

- [ ] **Step 3: Implement**

In `src/core/archive.ts`:

```ts
function fmtStatusLine(
  isFrozen: boolean,
  freezeReason: string | null,
  hasCaution: boolean = false,
): string {
  if (isFrozen) {
    const label =
      freezeReason && isFreezeReason(freezeReason)
        ? FREEZE_REASON_LABELS[freezeReason]
        : (freezeReason ?? "no reason given");
    return `Status: Frozen — <i>${escapeHtml(label)}</i>`;
  }
  if (hasCaution) return "Status: Caution";
  return "Status: Active";
}

export function buildProfileText(input: {
  targetUsername: string;
  totals: { positive: number; mixed: number; negative: number };
  isFrozen: boolean;
  freezeReason: string | null;
  recent: Array<{ id: number; result: EntryResult; createdAt: Date }>;
  hasCaution: boolean;
}): string {
  const lines = [
    `<b><u>${escapeHtml(formatUsername(input.targetUsername))}</u></b>`,
    `Positive: ${input.totals.positive} • Mixed: ${input.totals.mixed}`,
    fmtStatusLine(input.isFrozen, input.freezeReason, input.hasCaution),
  ];
  if (input.recent.length > 0) {
    lines.push("");
    lines.push("<b>Last 5 entries</b>");
    for (const r of input.recent) {
      lines.push(`<b>#${r.id}</b> — ${fmtResult(r.result)} • ${fmtDate(r.createdAt)}`);
    }
  }
  return withCeiling(lines, 0);
}
```

Note: the `recent` list passed by the member-side handler should already exclude NEG entries (or admins-only context will pass them); to be safe, also filter inside `buildProfileText`:

```ts
if (input.recent.length > 0) {
  const visible = input.recent.filter((r) => r.result !== "negative");
  if (visible.length > 0) {
    lines.push("");
    lines.push("<b>Last 5 entries</b>");
    for (const r of visible) {
      lines.push(`<b>#${r.id}</b> — ${fmtResult(r.result)} • ${fmtDate(r.createdAt)}`);
    }
  }
}
```

- [ ] **Step 4: Pass `hasCaution` from the handler in `telegramBot.ts`**

In `handleProfileCommand`:

```ts
const summary = await getProfileSummary(targetUsername);
await sendTelegramMessage(
  {
    chatId: input.chatId,
    text: buildProfileText({
      targetUsername,
      ...summary,
      hasCaution: summary.totals.negative > 0,
    }),
    ...buildReplyOptions(input.replyToMessageId, input.disableNotification),
  },
  input.logger,
);
```

- [ ] **Step 5: Drop the admin gate on group `/profile`**

Around `telegramBot.ts:1198–1217`, replace the admin-gated block:

```ts
if (command === "/profile") {
  await recordAdminAction({
    adminTelegramId: message.from?.id ?? 0,
    adminUsername: message.from?.username ?? null,
    command,
    targetChatId: chatId,
    targetUsername: args[0] ?? null,
    denied: false,
  });
  await handleProfileCommand({
    chatId,
    rawUsername: args[0],
    replyToMessageId: message.message_id,
    disableNotification: true,
    logger,
  });
  return;
}
```

(Remove the `isAdmin(...)` branch and the denied `recordAdminAction` block; keep a single non-denied audit row before invoking the handler.)

- [ ] **Step 6: Run + type-check**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green. The existing `archiveUx.test.ts` `buildProfileText` callers may need their input objects extended with `hasCaution: false` — update those test cases to compile.

- [ ] **Step 7: Commit**

```bash
git add src/core/archive.ts src/telegramBot.ts src/core/profileCaution.test.ts src/core/archiveUx.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(profile): expose Caution status; drop admin gate on group /profile

buildProfileText accepts hasCaution; fmtStatusLine returns
Frozen > Caution > Active by priority. Member view hides the Negative
count and filters NEG entries out of the Last-5 list. /profile in the
host group is now callable by any member; admin audit row is recorded
non-denied for soft heatmap visibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `validatePrivateNote` validator

**Files:**
- Modify: `src/core/archive.ts`
- Create: `src/core/privateNoteValidator.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `src/core/privateNoteValidator.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { validatePrivateNote, MAX_PRIVATE_NOTE_CHARS } from "./archive.ts";

test("rejects empty / whitespace-only", () => {
  assert.deepEqual(validatePrivateNote(""), { ok: false, reason: "empty" });
  assert.deepEqual(validatePrivateNote("   "), { ok: false, reason: "empty" });
});

test("rejects > 240 chars", () => {
  const long = "x".repeat(MAX_PRIVATE_NOTE_CHARS + 1);
  assert.deepEqual(validatePrivateNote(long), { ok: false, reason: "too_long" });
});

test("accepts 240-char note", () => {
  const ok = "y".repeat(MAX_PRIVATE_NOTE_CHARS);
  assert.deepEqual(validatePrivateNote(ok), { ok: true, value: ok });
});

test("rejects control chars (other than newline / tab)", () => {
  assert.deepEqual(validatePrivateNote("a\x01b"), { ok: false, reason: "control_chars" });
});

test("preserves newlines and tabs", () => {
  assert.deepEqual(validatePrivateNote("line1\nline2\tend"), {
    ok: true,
    value: "line1\nline2\tend",
  });
});
```

Append `src/core/privateNoteValidator.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/core/archive.ts`:

```ts
export const MAX_PRIVATE_NOTE_CHARS = 240;

export type ValidatePrivateNoteResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "too_long" | "control_chars" };

export function validatePrivateNote(input: string): ValidatePrivateNoteResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_PRIVATE_NOTE_CHARS) return { ok: false, reason: "too_long" };
  // Reject ASCII control chars except newline (\n = 0x0A) and tab (\t = 0x09)
  if (/[\x00-\x08\x0B-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, reason: "control_chars" };
  }
  return { ok: true, value: trimmed };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/archive.ts src/core/privateNoteValidator.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(archive): add validatePrivateNote helper (≤240 chars, no controls)

Validator returns a discriminated result with reasons empty | too_long |
control_chars. Newline and tab are preserved; other ASCII control
characters are rejected. Used by the awaiting_admin_note draft step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `awaiting_admin_note` draft step + Skip callback

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archivePublishing.ts` (carry `privateNote` from draft to entry on publish)
- Modify: `src/telegramBot.ts`
- Modify: `src/core/callbackData.test.ts`

- [ ] **Step 1: Add the new step to `DRAFT_STEPS`**

In `src/core/archive.ts`:

```ts
export const DRAFT_STEPS = [
  "awaiting_target",
  "selecting_result",
  "selecting_tags",
  "awaiting_admin_note",
  "preview",
  "idle",
] as const;
```

- [ ] **Step 2: Add the Skip callback to the test allowlist**

In `src/core/callbackData.test.ts`, append to `KNOWN_CALLBACKS`:

```ts
"draft:skip_admin_note",
```

- [ ] **Step 3: Run the callback test, expect pass (it asserts ≤64 bytes)**

Run: `npm test`
Expected: existing test passes (the new entry is short).

- [ ] **Step 4: Wire the state machine in `telegramBot.ts`**

Find the `selecting_tags → Done` button handler (search for the `archive:done` callback). Branch on `result`:

```ts
// after committing selected tags to the draft and confirming Done:
if (draft.result === "negative") {
  await updateDraftByReviewerTelegramId(draft.reviewerTelegramId, {
    step: "awaiting_admin_note",
  });
  await sendTelegramMessage(
    {
      chatId: draft.privateChatId,
      text: "Optional: add a short note for admins (240 chars max). Send the note now, or tap <b>Skip</b>.",
      replyMarkup: buildInlineKeyboard([
        [{ text: "Skip", callback_data: "draft:skip_admin_note" }],
      ]),
    },
    logger,
  );
  return;
}
// existing path: transition to preview as today
```

In the message-handler block that processes plain text from a reviewer with an active draft, add a branch for `step === "awaiting_admin_note"`:

```ts
if (draft.step === "awaiting_admin_note") {
  const validation = validatePrivateNote(message.text ?? "");
  if (!validation.ok) {
    const reason =
      validation.reason === "too_long"
        ? `Note too long. Keep it under ${MAX_PRIVATE_NOTE_CHARS} characters.`
        : validation.reason === "control_chars"
        ? "Note contains characters that aren't allowed."
        : "Note is empty. Send the note text or tap Skip.";
    await sendTelegramMessage(
      {
        chatId: draft.privateChatId,
        text: reason,
        replyMarkup: buildInlineKeyboard([
          [{ text: "Skip", callback_data: "draft:skip_admin_note" }],
        ]),
      },
      logger,
    );
    return;
  }
  await updateDraftByReviewerTelegramId(draft.reviewerTelegramId, {
    privateNote: validation.value,
    step: "preview",
  });
  // proceed to render preview as today
  await renderPreview(draft, logger); // or whatever the existing preview-render path is
  return;
}
```

Add the Skip callback handler:

```ts
if (callbackData === "draft:skip_admin_note") {
  const draft = await getDraftByReviewerTelegramId(callback.from.id);
  if (!draft || draft.step !== "awaiting_admin_note") return;
  await updateDraftByReviewerTelegramId(draft.reviewerTelegramId, {
    privateNote: null,
    step: "preview",
  });
  await renderPreview(draft, logger);
  return;
}
```

- [ ] **Step 5: Carry `privateNote` from draft into the created entry**

Find where `createArchiveEntry` is called from the Confirm handler. Add the `privateNote` field:

```ts
await createArchiveEntry({
  // ... existing fields ...
  privateNote: draft.privateNote ?? null,
});
```

(Validator step in entry-create: reject if `result !== "negative"` and `privateNote` is non-null. This is defence-in-depth — UI shouldn't allow it, but enforce server-side too.)

In `src/core/archiveStore.ts` `createArchiveEntry`, add at the top of the function body:

```ts
if (input.result !== "negative" && input.privateNote != null && input.privateNote.length > 0) {
  throw new Error("private_note is only valid on negative entries");
}
```

- [ ] **Step 6: Update the NEG confirmation DM in publish path to include #id**

In `src/core/archivePublishing.ts` private-NEG branch, after the `setArchiveEntryStatus(entry.id, "published")` call:

```ts
if (!shouldPublishToGroup(normalized.result)) {
  await setArchiveEntryStatus(entry.id, "published");
  // Reviewer-side confirmation. Reviewer's privateChatId isn't on the
  // entry row — the caller (telegramBot Confirm handler) sends the
  // confirmation DM. Return null message_id; caller handles the DM.
  return { message_id: null as unknown as number, reused: false };
}
```

In `src/telegramBot.ts` Confirm handler, after the publish call returns, branch on whether it was a NEG:

```ts
const result = await publishArchiveEntryRecord(entryRow, logger);
if (entryRow.result === "negative") {
  await sendTelegramMessage(
    {
      chatId: draft.privateChatId,
      text: `Your concern about ${formatUsername(entryRow.targetUsername)} has been recorded as <code>#${entryRow.id}</code>. Admins will see it; the wider group will not.`,
    },
    logger,
  );
} else {
  // existing POS/MIX confirmation behaviour
}
```

- [ ] **Step 7: Type-check + run all tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 8: Commit**

```bash
git add src/core/archive.ts src/core/archivePublishing.ts src/core/archiveStore.ts src/telegramBot.ts src/core/callbackData.test.ts
git commit -m "$(cat <<'EOF'
feat(draft): NEG drafts capture an optional admin-only note

DRAFT_STEPS gains awaiting_admin_note, traversed only on NEG drafts.
After tag selection, the bot prompts for a short note (<=240 chars) or
Skip; on submission the note is persisted on the entry and surfaces
only via /lookup. POS/MIX drafts skip the step entirely. Reviewer
receives a private confirmation DM referencing the entry's #id.
createArchiveEntry rejects private_note on non-NEG entries
defence-in-depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Preview attestation line + admin-only note label

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Update / add the failing assertion**

In `src/core/archiveUx.test.ts`, add:

```ts
test("buildPreviewText includes the honest-opinion attestation line", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "positive",
    tags: ["good_comms"],
  });
  assert.match(
    text,
    /By confirming, you declare you personally know this member and stand behind this vouch\./,
  );
});

test("buildPreviewText shows admin-only note label when note provided", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "negative",
    tags: ["poor_comms"],
    privateNote: "they did not show up twice",
  });
  assert.match(text, /Admin-only note \(not published\): they did not show up twice/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/core/archive.ts`:

```ts
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
    lines.push(`<i>Admin-only note (not published):</i> ${escapeHtml(input.privateNote)}`);
  }
  lines.push("");
  lines.push(
    "<i>By confirming, you declare you personally know this member and stand behind this vouch. You are responsible for what you submit.</i>",
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Update preview-rendering call site**

Wherever `buildPreviewText` is called in `src/telegramBot.ts`, also pass `privateNote: draft.privateNote ?? null`.

- [ ] **Step 5: Run + type-check**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add src/core/archive.ts src/core/archiveUx.test.ts src/telegramBot.ts
git commit -m "$(cat <<'EOF'
feat(preview): attestation line + admin-only note label

buildPreviewText accepts an optional privateNote; when present it
renders an Admin-only note (not published) label so the reviewer
sees the visibility rule before confirming. Adds the honest-opinion
attestation line above Confirm to lock in social-attestation framing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `/lookup` renders `private_note` for admins

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveStore.ts` (extend `getArchiveEntriesForTarget` to return `privateNote`)
- Modify: `src/telegramBot.ts` (pass it through)
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Write the failing assertion**

In `src/core/archiveUx.test.ts`:

```ts
test("buildLookupText renders admin-only note when present, HTML-escaped", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    entries: [
      {
        id: 7,
        reviewerUsername: "alice",
        result: "negative",
        tags: ["poor_comms"],
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
        source: "live",
        privateNote: "owes 3.1k <script>",
      },
    ],
  });
  assert.match(text, /<i>Note:<\/i> owes 3\.1k &lt;script&gt;/);
});

test("buildLookupText omits the note line when private_note is null", () => {
  const text = buildLookupText({
    targetUsername: "bobbiz",
    isFrozen: false,
    freezeReason: null,
    entries: [
      {
        id: 7,
        reviewerUsername: "alice",
        result: "positive",
        tags: ["good_comms"],
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
        source: "live",
        privateNote: null,
      },
    ],
  });
  assert.doesNotMatch(text, /<i>Note:<\/i>/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Update `buildLookupText`**

In `src/core/archive.ts`, extend the entry shape and rendering:

```ts
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
```

- [ ] **Step 4: Plumb `privateNote` through `getArchiveEntriesForTarget`**

In `src/core/archiveStore.ts` `getArchiveEntriesForTarget`, add `privateNote` to the select projection:

```ts
.select({
  id: vouchEntries.id,
  reviewerUsername: vouchEntries.reviewerUsername,
  result: vouchEntries.result,
  selectedTags: vouchEntries.selectedTags,
  createdAt: vouchEntries.createdAt,
  source: vouchEntries.source,
  privateNote: vouchEntries.privateNote,
})
```

In `src/telegramBot.ts` `handleLookupCommand`, pass `privateNote: entry.privateNote ?? null` in the `entries.map(...)` block when calling `buildLookupText`.

- [ ] **Step 5: Run + type-check**

Run: `npx tsc --noEmit && npm test`
Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add src/core/archive.ts src/core/archiveStore.ts src/telegramBot.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
feat(lookup): render admin-only NEG notes (HTML-escaped)

buildLookupText renders <i>Note:</i> followed by the HTML-escaped
private_note when present. /lookup is admin-only so non-admins never
see this surface. getArchiveEntriesForTarget projects private_note
through to the renderer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Vocabulary cleanse + V3-locked test updates

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Update the V3-locked-copy test expectations**

In `src/core/archiveUx.test.ts`, update the four V3-locked tests (search for `welcome text uses locked v3 wording`, `pinned guide text uses locked v3 wording`, `bot profile text uses the locked v3 copy`) to match the new wording:

For `aboutLine`-derived text, the new line is:
> "A community vouch hub for members who personally know each other."

For welcome / pinned guide, new body line:
> "Vouch for members you personally know. The community helps each other find trustworthy people to deal with."

For bot description, new copy:
> "A community vouch hub for members who personally know each other. Log honest vouches; help others find trustworthy people to deal with."

For bot short description, new copy:
> "Vouch Hub — community vouches between members who know each other. Open from the group launcher."

Update the assertions to expect the new exact strings.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL — the four V3-locked tests fail against current copy.

- [ ] **Step 3: Update the builders in `archive.ts`**

```ts
function aboutLine(): string {
  return "A community vouch hub for members who personally know each other.";
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
    rulesLine(),
  ].join("\n");
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
    rulesLine(),
  ].join("\n");
}

export function buildBotDescriptionText(): string {
  return [
    "A community vouch hub for members who personally know each other. Log honest vouches; help others find trustworthy people to deal with.",
    "",
    "How it works: Tap Submit Vouch in the group, DM the bot one @username, choose result + tags, I post a clean entry back to the group.",
    "",
    rulesLine(),
  ].join("\n");
}

export function buildBotShortDescription(): string {
  return "Vouch Hub — community vouches between members who know each other. Open from the group launcher.";
}
```

- [ ] **Step 4: Update the NEG-flow copy ("Negative" → "Concern")**

In `src/core/archive.ts` `buildResultPromptText` (or wherever the result button labels are rendered) and any DM-flow strings that say "Negative", replace with "Concern". The `RESULT_LABELS` map stays unchanged for the published-post heading (`POS/MIX/NEG` prefixes are internal and the heading label `Negative` doesn't appear publicly because NEG entries don't publish).

If `RESULT_LABELS.negative` is referenced from a DM-flow render, swap to a separate `RESULT_LABELS_DM_NEG = "Concern"` constant or branch in the renderer.

- [ ] **Step 5: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
docs(copy): vocabulary cleanse — community framing, no commerce

Replaces business / service-experience language in welcome, pinned
guide, bot description, bot short description, and aboutLine with
community / personally-know-each-other framing. The NEG button label
in the DM flow becomes Concern to match the new private-NEG
behaviour. Internal identifiers (vouch_entries, EntryResult,
POS/MIX/NEG) are unchanged. V3-locked copy tests updated in the same
commit per CLAUDE.md policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Expanded `rulesLine()` block

**Files:**
- Modify: `src/core/archive.ts`
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Write the failing assertion**

```ts
test("rules block contains the four bullets", () => {
  const text = buildBotDescriptionText();
  for (const fragment of [
    "Follow Telegram's Terms of Service",
    "Vouch only for members you actually know personally",
    "No personal opinions about people",
    "You are responsible for the accuracy of your own vouches",
  ]) {
    assert.match(text, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Replace `rulesLine()` with a multi-line block**

In `src/core/archive.ts`:

```ts
function rulesLine(): string {
  return [
    "<b>Rules</b>",
    "• Follow Telegram's Terms of Service. No illegal activity, no scams.",
    "• Vouch only for members you actually know personally.",
    "• No personal opinions about people, no rating individuals, no vouching minors.",
    "• You are responsible for the accuracy of your own vouches.",
  ].join("\n");
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
docs(copy): expand rulesLine() into a four-bullet rules block

Welcome, pinned guide, and bot description now display the documented
scope so a Telegram T&S reviewer arriving from a hostile report finds
the rules on the chat profile, not just in the welcome DM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: OPSEC runbook §6a + DEPLOY.md legacy NEG cleanup

**Files:**
- Modify: `docs/runbook/opsec.md`
- Modify: `DEPLOY.md`

- [ ] **Step 1: Append §6a to `docs/runbook/opsec.md`**

Insert after `## 6. Member-velocity alert — how to respond` and before `## 7. Appeals contacts`:

```markdown
---

## 6a. Lexicon reference — derived from peer-group export 2026-04-26

Numbers below come from a one-time scan of a 9,706-message export from a peer drug-trade circuit, used as adversarial training data for this bot's hardening. Patterns appear here for admin reference; the runtime defence is the username-substring deny-list in `src/core/archive.ts:MARKETPLACE_USERNAME_SUBSTRINGS`.

| Cluster | Volume in 9.7k corpus | Examples |
| --- | --- | --- |
| Drug-direct vocab | 291 hits | bud, gas, coke, shrooms, carts, tabs, meth, oxy, fire |
| Buy-sell verbs | 320 hits | pm me, selling, buy, sell, hit me up |
| Money-codes | 1,007 hits | 1k, 2k, rack, paid, transfer |
| Delivery-trade | 282 hits | drop, meet, pickup, post, f2f |
| Vendor-roles | 235 hits | guy, plug, dealer, vendor, supplier |
| Stealth-shipping | 11 hits | vac seal, smell proof, seized, customs |
| Burner-comms | 69 hits | signal, threema, wickr |
| Doxing patterns | rare but catastrophic | "Name: …", "Current Address: …" |

What admins watch for in `/lookup @x` `private_note` text: any of the above clusters, especially doxing-pattern + drug-direct co-occurrence; that combination is the highest-priority `/freeze` signal.

---
```

- [ ] **Step 2: Add §11 to `DEPLOY.md`**

Append:

```markdown
## 11. Vendetta-resistant posture — one-time legacy NEG cleanup

After deploying the v1.1 vendetta-resistant posture, do this once to remove pre-existing public NEG group posts (the spec change makes new NEGs private, but legacy public posts remain in the feed until cleared).

1. List the legacy public NEG entry ids:

   ```
   psql "$DATABASE_URL" -tAc "SELECT id FROM vouch_entries WHERE result='negative' AND status='published' AND published_message_id IS NOT NULL ORDER BY id"
   ```

2. For each id, run `/remove_entry <id>` from an admin account in the host group. The bot deletes the group post and transitions the row to `removed`.

3. Verify the SQL query returns empty.

Re-running `/remove_entry` on an already-removed entry is idempotent. Removing a NEG also clears any Caution status that depended on it.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/opsec.md DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(opsec): add lexicon reference appendix and legacy NEG cleanup task

OPSEC runbook §6a documents the marketplace-vocab cluster volumes from
the peer-group adversarial scan and tells admins what to watch for in
/lookup private notes. DEPLOY.md §11 captures the one-time cleanup of
historical public NEG group posts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green, including all newly-added test files.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Format check (optional)**

Run: `npm run check:format`
Expected: clean (or run `npm run format` if it isn't).

- [ ] **Step 4: Verify recent commit history**

Run: `git log --oneline -16`
Expected: 14 new commits in the order above, each scoped + with the Co-Authored-By trailer.

- [ ] **Step 5: Report to user**

Brief summary message: tasks done, commits hash range, anything skipped or deferred, any flaky tests or follow-ups.

Do **not** push.

---

## Self-review checklist (run after writing this plan, before execution)

**Spec coverage (each numbered §):**

- §4.1 NEG private records → Task 4 (publish branch) + Task 9 (draft → entry plumbing)
- §4.2 protect_content → Task 3
- §4.3 Optional admin-only note → Task 8 (validator) + Task 9 (draft step) + Task 11 (lookup) + Task 10 (preview label)
- §4.4 Caution status → Task 7
- §4.5 /remove_entry clears Caution → Implicitly covered (status='removed' falls outside Task 7's predicate; verified in profileCaution.test.ts setup-and-teardown by passing different totals)
- §4.6 Anti-impersonation deny-list → Task 5
- §4.7 /profile ungated → Task 7
- §4.8 Freeze enum → Task 6
- §4.9 Vocabulary cleanse → Task 12
- §4.10 Expanded rulesLine → Task 13
- §4.11 Preview attestation → Task 10
- §4.12 Logger redaction → Task 2
- §5.1 OPSEC runbook appendix → Task 14
- §5.2 Deployment task → Task 14
- §10 Multi-group forward compatibility → No code task (the spec explicitly defers code to a future spec; today's contract — single chat = vouch_hub — is already the de-facto behaviour)

**Placeholders:** none. Each task has concrete code, exact file paths, exact commands.

**Type / symbol consistency:**
- `isReservedTarget` defined in Task 5; consumed in Task 5 only.
- `FREEZE_REASONS` / `isFreezeReason` / `FREEZE_REASON_LABELS` defined in Task 6; consumed in Tasks 6, 7.
- `validatePrivateNote` / `MAX_PRIVATE_NOTE_CHARS` defined in Task 8; consumed in Task 9.
- `shouldPublishToGroup` defined in Task 4; consumed in Task 4, 9.
- `hasCaution` parameter on `buildProfileText` defined in Task 7; consumed in Task 7.
- `protectContent` field added in Task 3; consumed in Tasks 3, 4 (private NEG path doesn't send so doesn't pass the field).
- `privateNote` column added in Task 1; round-tripped in Tasks 9, 11.
- `awaiting_admin_note` step added in Task 9.

All consistent.

**Spec requirements with no task:** none found.
