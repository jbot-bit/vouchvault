# Takedown-Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the takedown-resilience hardening described in `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md`: detect group-gone events, detect bot-account-level Telegram problems via `/readyz`, surface brigading early via member-velocity alerts, swap one borderline word in V3-locked copy, trim the BotFather slash menu, and ship an OPSEC runbook.

**Architecture:** Pure additive change — no schema migrations, no architectural shifts. Reuses existing `chat_settings.status` column with a new `'gone'` value. Adds a small in-memory rolling-window tracker for member-velocity. Wires a centralised `TelegramChatGoneError` catch in the existing `processTelegramUpdate` outer try/catch. Trims the existing `setMyCommands` payload. Doc file is pure markdown.

**Tech Stack:** Node 22 + `--experimental-strip-types`, drizzle-orm + Postgres, `node:test`, pino, existing typed Telegram error classes.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/core/archive.ts` | modify | Replace "verify" with "review" in three V3-locked copy functions. |
| `src/core/archiveUx.test.ts` | modify | Update locked-text regex assertions. |
| `src/core/typedTelegramErrors.ts` | modify | Add optional `chatId?: number` to `TelegramApiError` (and inherited subclasses). |
| `src/core/tools/telegramTools.ts` | modify | Pass the input `chatId` into the error constructors so `TelegramChatGoneError` (etc.) carry it. |
| `src/core/chatSettingsStore.ts` | modify | Add `setChatGone(chatId)` and `isChatDisabled(chatId)` helpers. Existing `'kicked'`/`'migrated_away'` paths unchanged. |
| `src/core/chatGoneHandler.ts` | create | `handleChatGone(chatId, logger)`: idempotent status flip + per-admin DM (each wrapped) + audit-log entry (wrapped). |
| `src/core/chatGoneHandler.test.ts` | create | Unit tests for idempotency and per-admin DM error tolerance. |
| `src/core/memberVelocity.ts` | create | In-memory rolling-window tracker. `recordMemberEvent(chatId, kind, now?)` returns `{ alertFired }`. |
| `src/core/memberVelocity.test.ts` | create | Unit tests for thresholds, suppression, transition classification. |
| `src/telegramBot.ts` | modify | Catch `TelegramChatGoneError` in outer try/catch → `handleChatGone`. Reset `chat_settings.status` to `'active'` when bot is re-added. Wire `chat_member` updates → `memberVelocity` and admin DM. |
| `src/server.ts` | modify | Extend `/readyz` with a `getMe` probe (3s timeout, 429 → healthy). |
| `scripts/setTelegramWebhook.ts` | modify | Add `"chat_member"` to `allowed_updates`. |
| `scripts/configureTelegramOnboarding.ts` | modify | Remove admin-only commands from `PRIVATE_COMMANDS`. |
| `package.json` | modify | Append the two new `*.test.ts` paths to the `test` script. |
| `docs/runbook/opsec.md` | create | Manual hardening checklist + DR procedure. |

---

## Task 1: Vocab fix — "verify" → "review"

**Spec ref:** §3.1.

**Files:**
- Modify: `src/core/archive.ts` (functions `buildWelcomeText`, `buildPinnedGuideText`, `buildBotDescriptionText`)
- Modify: `src/core/archiveUx.test.ts`

- [ ] **Step 1: Update the failing test**

In `src/core/archiveUx.test.ts`, change every `Log and verify` regex to `Log and review`:

```ts
assert.match(text, /Log and review local-business service experiences/);
```

There are two such assertions — one in the welcome-text test, one in the bot-description test. Update both.

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm test 2>&1 | grep -E "verify|review|fail|pass"`
Expected: assertions referencing `/Log and review/` fail because the source still says "verify."

- [ ] **Step 3: Update the three locked-copy strings**

In `src/core/archive.ts`, in `buildWelcomeText`, `buildPinnedGuideText`, and `buildBotDescriptionText`:

```ts
"Log and review local-business service experiences with the community.",
```

(Replace each occurrence of the original `"Log and verify ..."` line.)

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm test`
Expected: all 79 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
feat(copy): swap "verify" for "review" in V3-locked copy

Marketplace-cluster vocabulary trims a borderline word out of the
welcome text, pinned guide, and BotFather description without
changing the meaning. Locked-copy tests updated in lock-step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Carry `chatId` on typed Telegram errors

**Spec ref:** §3.3 "Identifying the offending chat" + §4 architecture note.

**Files:**
- Modify: `src/core/typedTelegramErrors.ts`
- Modify: `src/core/tools/telegramTools.ts`

- [ ] **Step 1: Extend `TelegramApiError` with optional `chatId`**

In `src/core/typedTelegramErrors.ts`:

```ts
export class TelegramApiError extends Error {
  readonly errorCode: number;
  readonly description: string;
  readonly retryAfter?: number;
  readonly chatId?: number;
  constructor(
    errorCode: number,
    description: string,
    retryAfter?: number,
    chatId?: number,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
    this.errorCode = errorCode;
    this.description = description;
    this.retryAfter = retryAfter;
    this.chatId = chatId;
  }
}
```

(Subclasses `TelegramRateLimitError`, `TelegramForbiddenError`, `TelegramChatGoneError` inherit the field automatically.)

- [ ] **Step 2: Pass `chatId` through `callTelegramAPI`**

In `src/core/tools/telegramTools.ts`, change the `callTelegramAPI` signature to accept an optional `chatId` and use it when constructing errors:

```ts
export async function callTelegramAPI(
  method: string,
  params: any,
  logger?: any,
  chatId?: number,
) {
  // ... existing body unchanged through `if (!data.ok) {` ...
  if (!data.ok) {
    logger?.error?.("Telegram API call failed", { method, params, error: data });
    const desc = String(data.description ?? "");
    const code = Number(data.error_code ?? 0);
    if (code === 429) {
      throw new TelegramRateLimitError(
        code, desc, Number(data.parameters?.retry_after ?? 0), chatId,
      );
    }
    if (code === 403 && /bot was blocked by the user|bot is not a member/i.test(desc)) {
      throw new TelegramForbiddenError(code, desc, undefined, chatId);
    }
    if (code === 400 && /chat not found/i.test(desc)) {
      throw new TelegramChatGoneError(code, desc, undefined, chatId);
    }
    throw new TelegramApiError(code, desc, undefined, chatId);
  }
  return data.result;
}
```

- [ ] **Step 3: Pass `chatId` into the four public sends**

Same file. Update each public wrapper to forward `input.chatId`:

```ts
export async function sendTelegramMessage(input: { chatId: number; ... }, logger?: any) {
  return withTelegramRetry(() =>
    callTelegramAPI("sendMessage", buildTelegramSendMessageParams(input), logger, input.chatId),
  );
}

export async function editTelegramMessage(input: { chatId: number; messageId: number; ... }, logger?: any) {
  return withTelegramRetry(() =>
    callTelegramAPI("editMessageText", { /* existing payload */ }, logger, input.chatId),
  );
}

export async function deleteTelegramMessage(input: { chatId: number; messageId: number }, logger?: any) {
  return withTelegramRetry(() =>
    callTelegramAPI("deleteMessage", { /* existing payload */ }, logger, input.chatId),
  );
}
```

`answerTelegramCallbackQuery` does **not** carry a `chatId` (callback-query input is just an id), so leave it as-is — its errors will have `chatId === undefined`, which is correct.

- [ ] **Step 4: Type-check + run existing tests, confirm green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -10`
Expected: tsc exit 0, 79 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/core/typedTelegramErrors.ts src/core/tools/telegramTools.ts
git commit -m "$(cat <<'EOF'
feat(telegram): carry chatId on typed errors

TelegramApiError (and its subclasses) gain an optional chatId field
populated by the four public send wrappers from input.chatId. The
chat-gone handler (next task) needs to know which chat went missing;
without this, it can only guess from the inbound update payload.
answerCallbackQuery has no chatId in its input, so its errors leave
chatId undefined - the handler treats that as a no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `chat_settings` `'gone'` helpers

**Spec ref:** §3.3 + §4.

**Files:**
- Modify: `src/core/chatSettingsStore.ts`

- [ ] **Step 1: Add `setChatGone` helper that returns whether the row newly transitioned**

In `src/core/chatSettingsStore.ts`:

```ts
/**
 * Marks the chat as gone (Telegram returned `chat not found` from a send).
 * Returns true iff the status flipped from a non-`gone` value to `gone` on
 * this call. The caller uses that signal to page admins exactly once.
 */
export async function setChatGone(chatId: number): Promise<{ newlyGone: boolean }> {
  const existing = await db
    .select({ status: chatSettings.status })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));

  const wasGone = existing[0]?.status === "gone";

  await db
    .insert(chatSettings)
    .values({ chatId, status: "gone" })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "gone", updatedAt: new Date() },
    });

  return { newlyGone: !wasGone };
}
```

- [ ] **Step 2: Add `isChatDisabled` helper**

Same file:

```ts
const DISABLED_STATUSES = new Set(["kicked", "gone", "migrated_away"]);

export async function isChatDisabled(chatId: number): Promise<boolean> {
  const rows = await db
    .select({ status: chatSettings.status })
    .from(chatSettings)
    .where(eq(chatSettings.chatId, chatId));
  return DISABLED_STATUSES.has(rows[0]?.status ?? "");
}
```

- [ ] **Step 3: Migrate the existing `isChatKicked` call site**

In `src/core/archiveLauncher.ts:73`, the existing guard reads:

```ts
if (await isChatKicked(chatId)) {
```

Change to use the broader semantic so a `'gone'` chat also short-circuits launcher refresh:

```ts
if (await isChatDisabled(chatId)) {
```

Update the import in that file from `isChatKicked` to `isChatDisabled`. `isChatKicked` itself stays exported (in case other code wants the narrower check) but archiveLauncher uses the broader one.

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: tsc exit 0, all tests pass (no new tests yet — coverage comes via `chatGoneHandler.test.ts` in Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/core/chatSettingsStore.ts src/core/archiveLauncher.ts
git commit -m "$(cat <<'EOF'
feat(chat-settings): setChatGone + isChatDisabled helpers

Adds a 'gone' value alongside the existing 'kicked' and 'migrated_away'
without a migration (status is already a free-form text column).
setChatGone returns whether the row newly transitioned so the caller
can page admins exactly once. isChatDisabled folds all three terminal
statuses behind one check; archiveLauncher migrates to it so a 'gone'
chat also short-circuits launcher refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `chatGoneHandler` module + wire into `processTelegramUpdate`

**Spec ref:** §3.3.

**Files:**
- Create: `src/core/chatGoneHandler.ts`
- Create: `src/core/chatGoneHandler.test.ts`
- Modify: `src/telegramBot.ts`
- Modify: `package.json` (append the test path)

- [ ] **Step 1: Write the failing test**

Create `src/core/chatGoneHandler.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleChatGone } from "./chatGoneHandler.ts";

test("handleChatGone is a no-op when chatId is undefined", async () => {
  const calls: string[] = [];
  await handleChatGone({
    chatId: undefined,
    adminTelegramIds: [1, 2],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deps: {
      setChatGone: async (id: number) => { calls.push(`setChatGone(${id})`); return { newlyGone: true }; },
      sendDM: async (input) => { calls.push(`send(${input.chatId})`); },
      recordAudit: async (entry) => { calls.push(`audit(${entry.command})`); },
    },
  });

  assert.deepEqual(calls, []);
});

test("handleChatGone DMs each admin once on first transition", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20, 30],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async (input) => { sentTo.push(input.chatId); },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, [10, 20, 30]);
});

test("handleChatGone does not DM on repeat transitions", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deps: {
      setChatGone: async () => ({ newlyGone: false }),
      sendDM: async (input) => { sentTo.push(input.chatId); },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, []);
});

test("handleChatGone tolerates one admin's DM throwing", async () => {
  const sentTo: number[] = [];
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10, 20, 30],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async (input) => {
        if (input.chatId === 20) throw new Error("blocked");
        sentTo.push(input.chatId);
      },
      recordAudit: async () => {},
    },
  });
  assert.deepEqual(sentTo, [10, 30]);
});

test("handleChatGone tolerates audit-log write failing", async () => {
  let dmSent = false;
  await handleChatGone({
    chatId: 1234,
    adminTelegramIds: [10],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    deps: {
      setChatGone: async () => ({ newlyGone: true }),
      sendDM: async () => { dmSent = true; },
      recordAudit: async () => { throw new Error("db down"); },
    },
  });
  assert.equal(dmSent, true);
});
```

- [ ] **Step 2: Append the test to `package.json`**

In `package.json`, in the `"test"` script, insert `src/core/chatGoneHandler.test.ts` before `src/telegramBotInput.test.ts`. For example:

```jsonc
"test": "node --test --experimental-strip-types src/core/archiveUx.test.ts src/core/legacyImport.test.ts src/core/tokenBucket.test.ts src/core/bootValidation.test.ts src/core/gracefulShutdown.test.ts src/core/callbackData.test.ts src/core/withTelegramRetry.test.ts src/core/formattingCeiling.test.ts src/core/chatGoneHandler.test.ts src/telegramBotInput.test.ts",
```

- [ ] **Step 3: Run, confirm fails (module missing)**

Run: `npm test 2>&1 | grep -i "chatGoneHandler\|fail\|cannot"` | head
Expected: import error — `handleChatGone` does not exist.

- [ ] **Step 4: Implement `handleChatGone`**

Create `src/core/chatGoneHandler.ts`:

```ts
type LoggerLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type Deps = {
  setChatGone: (chatId: number) => Promise<{ newlyGone: boolean }>;
  sendDM: (input: { chatId: number; text: string }) => Promise<unknown>;
  recordAudit: (entry: {
    adminTelegramId: number | null;
    adminUsername: string | null;
    command: string;
    targetChatId: number;
    denied: boolean;
  }) => Promise<unknown>;
};

export async function handleChatGone(input: {
  chatId: number | undefined;
  adminTelegramIds: number[];
  logger: LoggerLike;
  deps: Deps;
}): Promise<void> {
  const { chatId, adminTelegramIds, logger, deps } = input;

  if (chatId === undefined) {
    logger.warn(
      "Received TelegramChatGoneError without chatId; cannot mark chat gone",
    );
    return;
  }

  const { newlyGone } = await deps.setChatGone(chatId);

  if (!newlyGone) {
    logger.info("Chat already marked gone; skipping admin page", { chatId });
    return;
  }

  const text =
    `Group <code>${chatId}</code> appears to have been deleted by Telegram. ` +
    `Bot has stopped posting there. See <code>docs/runbook/opsec.md</code> for migration steps.`;

  for (const adminId of adminTelegramIds) {
    try {
      await deps.sendDM({ chatId: adminId, text });
    } catch (err) {
      logger.warn("Failed to DM admin about chat-gone event", {
        adminId,
        chatId,
        err,
      });
    }
  }

  try {
    await deps.recordAudit({
      adminTelegramId: null,
      adminUsername: null,
      command: "system.chat_gone",
      targetChatId: chatId,
      denied: false,
    });
  } catch (err) {
    logger.warn("Failed to write chat-gone audit entry", { chatId, err });
  }
}
```

- [ ] **Step 5: Wire into `processTelegramUpdate`**

In `src/telegramBot.ts`, find the existing outer `try/catch` in `processTelegramUpdate` (search for the catch that releases the update on error). Add a `TelegramChatGoneError` branch BEFORE the existing release-and-rethrow logic:

```ts
} catch (error) {
  if (error instanceof TelegramChatGoneError) {
    await handleChatGone({
      chatId: error.chatId,
      adminTelegramIds: [...getAdminIds()],
      logger,
      deps: {
        setChatGone,
        sendDM: (input) =>
          sendTelegramMessage({ chatId: input.chatId, text: input.text, parseMode: "HTML" }, logger),
        recordAudit: (entry) =>
          recordAdminAction({
            adminTelegramId: 0, // 0 = system actor
            adminUsername: null,
            command: entry.command,
            targetChatId: entry.targetChatId,
            denied: entry.denied,
          }),
      },
    });
    if (updateId != null) {
      await completeTelegramUpdate(updateId);
    }
    return { handled: true, chatGone: true };
  }

  if (updateId != null) {
    await releaseTelegramUpdate(updateId);
  }

  throw error;
}
```

Imports needed at the top of `telegramBot.ts`:

```ts
import { TelegramChatGoneError } from "./core/typedTelegramErrors.ts";
import { handleChatGone } from "./core/chatGoneHandler.ts";
import { setChatGone } from "./core/chatSettingsStore.ts";
```

`getAdminIds()` is the existing helper at `src/telegramBot.ts:105` (returns `Set<number>` parsed from `TELEGRAM_ADMIN_IDS`). The `[...]` spread converts to an array for the handler. The `adminTelegramId: 0` sentinel for system events is used because `AdminAuditEntry.adminTelegramId` is non-nullable; reserve `0` for system-originated events.

- [ ] **Step 6: Run, confirm green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -10`
Expected: tsc exit 0; tests now 84 (79 + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/core/chatGoneHandler.ts src/core/chatGoneHandler.test.ts src/telegramBot.ts package.json
git commit -m "$(cat <<'EOF'
feat(takedown): catch TelegramChatGoneError and page admins

Adds handleChatGone, a centralised module wired into the outer
try/catch of processTelegramUpdate. On a 'chat not found' error from
any send wrapped in the public sends:
  - chat_settings.status flips to 'gone' (idempotent; returns whether
    the transition was new)
  - on the first transition, every admin in TELEGRAM_ADMIN_IDS gets
    one DM; per-admin send is wrapped so a blocked admin doesn't break
    the loop
  - audit-log entry is recorded but tolerated if it fails

Updates that arrive while the chat is gone short-circuit cleanly via
the existing isChatKicked-style guard sites in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Reset `chat_settings.status` to `'active'` when bot is re-added

**Spec ref:** §3.3 edge-case table.

**Files:**
- Modify: `src/telegramBot.ts` (existing `my_chat_member` handler)
- Modify: `src/core/chatSettingsStore.ts` (add `setChatActive` helper)

- [ ] **Step 1: Add `setChatActive` helper**

In `src/core/chatSettingsStore.ts`:

```ts
export async function setChatActive(chatId: number): Promise<void> {
  await db
    .insert(chatSettings)
    .values({ chatId, status: "active" })
    .onConflictDoUpdate({
      target: chatSettings.chatId,
      set: { status: "active", updatedAt: new Date() },
    });
}
```

- [ ] **Step 2: Wire into the existing `my_chat_member` bot-status branch**

In `src/telegramBot.ts`, find the `handleMyChatMember` function (or whatever the V3 chunk-12.2 handler is called — search for `my_chat_member`). It currently flips `chat_settings.status` to `'kicked'` when the bot's `new_chat_member.status` is `'left'` or `'kicked'`. Add the inverse:

```ts
// inside handleMyChatMember, after extracting `oldStatus` and `newStatus` for the BOT itself
if (newStatus === "member" || newStatus === "administrator") {
  if (oldStatus === "left" || oldStatus === "kicked") {
    await setChatActive(chatId);
    logger.info("Bot re-added to chat; reset status='active'", { chatId });
  }
}
```

Import:

```ts
import { setChatActive } from "./core/chatSettingsStore.ts";
```

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: tsc exit 0, 84 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/chatSettingsStore.ts src/telegramBot.ts
git commit -m "$(cat <<'EOF'
feat(takedown): reset chat status to 'active' when bot is re-added

If a chat was previously 'kicked', 'gone', or 'migrated_away' and the
bot is re-added (my_chat_member transitions left/kicked -> member),
flip status back to 'active' so future updates resume normally. Closes
the recovery path for the chat-gone flow shipped in the previous task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `memberVelocity` module

**Spec ref:** §3.4.

**Files:**
- Create: `src/core/memberVelocity.ts`
- Create: `src/core/memberVelocity.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `src/core/memberVelocity.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  __resetMemberVelocityForTest,
  recordMemberEvent,
} from "./memberVelocity.ts";

const T0 = 1_000_000_000_000; // arbitrary baseline ms
const MIN = 60_000;

test("5 joins within 60 min triggers an alert", () => {
  __resetMemberVelocityForTest();
  let alert = false;
  for (let i = 0; i < 4; i += 1) {
    const r = recordMemberEvent(100, "join", T0 + i * MIN);
    assert.equal(r.alertFired, false);
  }
  const r5 = recordMemberEvent(100, "join", T0 + 4 * MIN);
  assert.equal(r5.alertFired, true);
});

test("6th join within suppression window does not re-alert", () => {
  __resetMemberVelocityForTest();
  for (let i = 0; i < 5; i += 1) recordMemberEvent(100, "join", T0 + i * MIN);
  const r6 = recordMemberEvent(100, "join", T0 + 5 * MIN);
  assert.equal(r6.alertFired, false);
});

test("after 60 min suppression expires, can re-alert with 5 fresh joins", () => {
  __resetMemberVelocityForTest();
  for (let i = 0; i < 5; i += 1) recordMemberEvent(100, "join", T0 + i * MIN);
  // Beyond suppression window AND beyond rolling-window so old joins are pruned
  const t1 = T0 + 90 * MIN;
  for (let i = 0; i < 4; i += 1) {
    const r = recordMemberEvent(100, "join", t1 + i * MIN);
    assert.equal(r.alertFired, false);
  }
  const rNext = recordMemberEvent(100, "join", t1 + 4 * MIN);
  assert.equal(rNext.alertFired, true);
});

test("3 leaves within 60 min triggers an alert (independent of joins)", () => {
  __resetMemberVelocityForTest();
  recordMemberEvent(100, "join", T0);
  recordMemberEvent(100, "leave", T0 + 1 * MIN);
  recordMemberEvent(100, "leave", T0 + 2 * MIN);
  const r = recordMemberEvent(100, "leave", T0 + 3 * MIN);
  assert.equal(r.alertFired, true);
});

test("different chats are tracked independently", () => {
  __resetMemberVelocityForTest();
  for (let i = 0; i < 4; i += 1) recordMemberEvent(100, "join", T0 + i * MIN);
  const otherChat = recordMemberEvent(200, "join", T0 + 4 * MIN);
  assert.equal(otherChat.alertFired, false);
  const sameChat = recordMemberEvent(100, "join", T0 + 4 * MIN);
  assert.equal(sameChat.alertFired, true);
});

test("timestamps older than 60 min are pruned and don't count", () => {
  __resetMemberVelocityForTest();
  for (let i = 0; i < 4; i += 1) recordMemberEvent(100, "join", T0 + i * MIN);
  // Jump 70 minutes forward — old 4 are pruned
  const t1 = T0 + 70 * MIN;
  const r = recordMemberEvent(100, "join", t1);
  assert.equal(r.alertFired, false);
  assert.equal(r.recentJoins, 1);
});
```

- [ ] **Step 2: Append the test to `package.json`**

In `package.json`, add `src/core/memberVelocity.test.ts` to the `"test"` script alongside the others.

- [ ] **Step 3: Run, confirm fails**

Run: `npm test 2>&1 | grep -i "memberVelocity\|fail\|cannot"`
Expected: import error — module doesn't exist.

- [ ] **Step 4: Implement `memberVelocity.ts`**

Create `src/core/memberVelocity.ts`:

```ts
const WINDOW_MS = 60 * 60 * 1000;
const SUPPRESSION_MS = 60 * 60 * 1000;
const JOIN_THRESHOLD = 5;
const LEAVE_THRESHOLD = 3;

export type MemberEventKind = "join" | "leave";

type WindowKey = `${number}:${MemberEventKind}`;

const windows = new Map<WindowKey, number[]>();
const suppressedUntil = new Map<WindowKey, number>();

function key(chatId: number, kind: MemberEventKind): WindowKey {
  return `${chatId}:${kind}` as WindowKey;
}

function pruneAndCount(k: WindowKey, now: number): number[] {
  const arr = windows.get(k) ?? [];
  const cutoff = now - WINDOW_MS;
  const fresh = arr.filter((t) => t >= cutoff);
  windows.set(k, fresh);
  return fresh;
}

export function recordMemberEvent(
  chatId: number,
  kind: MemberEventKind,
  now: number = Date.now(),
): { alertFired: boolean; recentJoins: number; recentLeaves: number } {
  const k = key(chatId, kind);
  const arr = pruneAndCount(k, now);
  arr.push(now);

  const threshold = kind === "join" ? JOIN_THRESHOLD : LEAVE_THRESHOLD;
  const suppressedUntilTs = suppressedUntil.get(k) ?? 0;

  let alertFired = false;
  if (arr.length >= threshold && now >= suppressedUntilTs) {
    alertFired = true;
    suppressedUntil.set(k, now + SUPPRESSION_MS);
  }

  // Always return both counts so callers can include them in the DM body.
  const joinsArr = kind === "join" ? arr : pruneAndCount(key(chatId, "join"), now);
  const leavesArr = kind === "leave" ? arr : pruneAndCount(key(chatId, "leave"), now);

  return {
    alertFired,
    recentJoins: joinsArr.length,
    recentLeaves: leavesArr.length,
  };
}

/**
 * Test-only: clear all windows and suppression state. Production code should
 * never call this. Module-level state is intentional (process-lifetime).
 */
export function __resetMemberVelocityForTest(): void {
  windows.clear();
  suppressedUntil.clear();
}
```

- [ ] **Step 5: Run, confirm green**

Run: `npm test 2>&1 | tail -10`
Expected: tests now 90 (84 + 6 new). All pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/memberVelocity.ts src/core/memberVelocity.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(takedown): in-memory member-velocity tracker

Pure module; no DB, no I/O. Records join/leave events keyed by
(chatId, kind), prunes anything older than 60 minutes on every push,
and flags an alert when joins hit 5 or leaves hit 3 in the rolling
window. Suppresses re-alerts for 60 minutes after firing.

State is process-lifetime; resets on deploy. The next task wires this
to chat_member updates in the webhook handler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `chat_member` to `memberVelocity` + add to `allowed_updates`

**Spec ref:** §3.4.

**Files:**
- Modify: `src/telegramBot.ts`
- Modify: `scripts/setTelegramWebhook.ts`

- [ ] **Step 1: Classify chat-member transitions and dispatch to velocity tracker**

In `src/telegramBot.ts`, add a new handler function for `chat_member` updates:

```ts
const PRESENT_STATUSES = new Set(["member", "administrator", "creator", "restricted"]);
const ABSENT_STATUSES = new Set(["left", "kicked"]);

async function handleChatMember(update: any, logger: LoggerLike) {
  const chatId = update?.chat?.id;
  const oldStatus = update?.old_chat_member?.status;
  const newStatus = update?.new_chat_member?.status;
  if (typeof chatId !== "number" || !oldStatus || !newStatus) return;

  let kind: "join" | "leave" | null = null;
  if (ABSENT_STATUSES.has(oldStatus) && PRESENT_STATUSES.has(newStatus)) kind = "join";
  else if (PRESENT_STATUSES.has(oldStatus) && ABSENT_STATUSES.has(newStatus)) kind = "leave";

  if (kind === null) return; // promotion/demotion/etc — ignore

  const { alertFired, recentJoins, recentLeaves } = recordMemberEvent(chatId, kind);

  if (!alertFired) return;

  const text =
    `Member-velocity alert in <code>${chatId}</code>: ` +
    `${recentJoins} joins / ${recentLeaves} leaves in last 60 min. ` +
    `Possible brigading. See <code>docs/runbook/opsec.md</code>.`;

  for (const adminId of getAdminIds()) {
    try {
      await sendTelegramMessage({ chatId: adminId, text, parseMode: "HTML" }, logger);
    } catch (err) {
      logger.warn("Failed to DM admin about member-velocity alert", { adminId, err });
    }
  }
}
```

Import:

```ts
import { recordMemberEvent } from "./core/memberVelocity.ts";
```

`getAdminIds()` is iterable (`Set<number>`); `for ... of` works directly.

- [ ] **Step 2: Dispatch `chat_member` updates to the new handler**

Still in `src/telegramBot.ts`, in `processTelegramUpdate`, add a branch BEFORE the `payload.message` branches (mirroring how `my_chat_member` is dispatched today):

```ts
} else if (payload.chat_member) {
  await handleChatMember(payload.chat_member, logger);
}
```

(Place it right next to the existing `my_chat_member` branch.)

- [ ] **Step 3: Add `chat_member` to webhook subscription**

In `scripts/setTelegramWebhook.ts`, in the `setWebhook` payload:

```ts
const payload: Record<string, unknown> = {
  url: webhookUrl,
  allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"],
  max_connections: 10,
  drop_pending_updates: true,
};
```

(The only change is appending `"chat_member"`.)

- [ ] **Step 4: Run, confirm green**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: tsc exit 0, 90 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/telegramBot.ts scripts/setTelegramWebhook.ts
git commit -m "$(cat <<'EOF'
feat(takedown): wire chat_member updates to member-velocity alert

Subscribes the webhook to chat_member updates (in addition to the
existing my_chat_member subscription) so the bot sees user-side
join/leave transitions. Promotions, demotions, and restriction
changes are explicitly filtered out — only true joins (left/kicked
-> member-flavoured) and true leaves (member-flavoured -> left/kicked)
count toward the velocity threshold.

Re-running npm run telegram:webhook after deploy is required to push
the new allowed_updates set to Telegram.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `/readyz` `getMe` probe

**Spec ref:** §3.2.

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Extend the `/readyz` handler**

In `src/server.ts`, replace the body of the `if (req.method === "GET" && req.url === "/readyz")` branch:

```ts
if (req.method === "GET" && req.url === "/readyz") {
  // 1. Database probe (existing behaviour).
  try {
    const { pool } = await import("./core/storage/db.ts");
    await pool.query("SELECT 1");
  } catch (error) {
    const response = jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      503,
    );
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
    return;
  }

  // 2. Telegram bot probe (new). Only if a token is configured.
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (token) {
    try {
      await probeTelegramGetMe(token);
    } catch (error) {
      const response = jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        503,
      );
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
      return;
    }
  }

  const response = jsonResponse({ ok: true });
  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
  return;
}
```

- [ ] **Step 2: Add the `probeTelegramGetMe` helper**

In the same file, above `main()`:

```ts
async function probeTelegramGetMe(token: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { method: "POST", signal: controller.signal },
    );
    const data = (await response.json()) as { ok: boolean; error_code?: number; description?: string };
    if (data.ok) return;

    // 429 = rate-limited but bot account is healthy → treat as ready.
    if (data.error_code === 429) return;

    throw new Error(`getMe failed: ${data.description ?? "unknown"}`);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("getMe timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Type-check + run smoke test against /readyz**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: tsc exit 0, 90 tests pass.

(Manual smoke: in production, hit `/readyz` once with valid token → 200; once with `TELEGRAM_BOT_TOKEN` set to an invalid value → 503 within 3s.)

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "$(cat <<'EOF'
feat(readyz): probe Telegram getMe in /readyz

/readyz now returns 503 when the bot account itself has a problem
(token revoked, account banned, network partition to api.telegram.org)
instead of returning 200 because only the DB was checked. 429 from
getMe is treated as ready (bot is fine, just throttled). 3-second
timeout on the probe so a hung api.telegram.org socket can't stall
Railway's health-check polling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Trim BotFather slash menu (`PRIVATE_COMMANDS`)

**Spec ref:** §3.5.

**Files:**
- Modify: `scripts/configureTelegramOnboarding.ts`

- [ ] **Step 1: Remove admin-only commands from `PRIVATE_COMMANDS`**

In `scripts/configureTelegramOnboarding.ts`, current state:

```ts
const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "vouch", description: "Start a new vouch" },
  { command: "cancel", description: "Cancel your in-progress draft" },
  { command: "profile", description: "Show entry totals for an @username" },
  { command: "lookup", description: "Look up entries for an @username" },
  ...DEFAULT_COMMANDS,
];
```

`/profile` and `/lookup` are admin-gated in the bot — surfacing them in the slash menu for all DM users is misleading and adds bot-platform footprint. Replace with:

```ts
const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "vouch", description: "Start a new vouch" },
  { command: "cancel", description: "Cancel your in-progress draft" },
  ...DEFAULT_COMMANDS,
];
```

`DEFAULT_COMMANDS` (`/help`, `/recent`) stays as the group-visible menu — already minimal. `ADMIN_COMMANDS` is unchanged (admin-scoped via `setMyCommands` scope, only admins see it).

- [ ] **Step 2: Type-check + tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: tsc exit 0, 90 tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/configureTelegramOnboarding.ts
git commit -m "$(cat <<'EOF'
chore(onboarding): drop admin-only commands from private slash menu

/profile and /lookup are admin-gated in the bot; listing them in the
DM slash menu for all users was misleading (regular users would see
them and get an Admin only error) and inflated the bot's visible
command surface. Admins still see them via ADMIN_COMMANDS scope.

Re-run npm run telegram:onboarding after deploy to push the trimmed
menu to BotFather.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: OPSEC runbook

**Spec ref:** §3.6.

**Files:**
- Create: `docs/runbook/opsec.md`

- [ ] **Step 1: Create the runbook**

Create `docs/runbook/opsec.md`:

````markdown
# VouchVault OPSEC Runbook

Defensive posture and disaster-recovery procedure for VouchVault's host group. Pairs with `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md`.

## 1. Threat model (one screen)

The realistic threats to the host group, ranked:

1. **Coordinated mass-report attack.** Mass-report-as-a-service is openly sold on Telegram. 50–100 accounts hitting *Report* on a target group reliably triggers automated takedown action within 24–48 hours. DMCA-flavoured reports succeed at ~89% within 72h regardless of merit.
2. **ML keyword/pattern hit.** Telegram's automated moderation is trained on the marketplace ecosystem they're legally compelled to suppress (Pavel Durov's French case). Communities sharing vocabulary clusters with that ecosystem have a documented false-positive rate (e.g. It's FOSS, deleted October 2025).
3. **Insider report.** A negatively-vouched user, or a former admin, hits Report from inside.
4. **Behavioural fingerprint** (vendor-claimed, weakly sourced). Uniform timing, identical message structure.

Telegram's automated takedown volume in 2026 averages 110K/day with peaks >500K. Appeals (`recover@telegram.org`, `@SpamBot`, in-app support) take 1–7 days, often longer, and rarely reverse permanent bans.

**Bots are not a moderation trigger themselves.** Bot-platform-shaped *visual signature* (many inline buttons, identical templated entries, deep-link onboarding) increases the report attack surface and the ML fingerprint.

## 2. Manual hardening checklist

Apply on the live group via the Telegram client. None of this is enforced in code.

- [ ] **Group privacy:** private supergroup; no public link.
- [ ] **Join control:** **Request to Join enabled** with **manual admin approval**. Most-cited evasion measure in the threat-research literature; stops report-attack accounts from getting in.
- [ ] **Member permissions:** members **cannot** add new members, change group info, pin messages, or invite via link. Only admins can.
- [ ] **Slow mode:** enabled, recommend 10s.
- [ ] **Media restriction:** members may post text and reactions only; only admins post images/files. Lowers ML keyword density on member-uploaded content.
- [ ] **Group avatar / name / description:** generic and community-flavoured. **Never** "trusted/verified/vendor/marketplace/seller" language. Match the bot copy's neutral tone.
- [ ] **Invite-link rotation:** retire the old link every ~30 days; distribute the new one only via the bot's `/start` deep link, never on external channels.

## 3. Backup group

A pre-positioned secondary group is the cheapest insurance against a takedown.

- [ ] Create a second private supergroup with **identical settings** to the live group (Request-to-Join, member permissions, etc.).
- [ ] Pre-invite admins.
- [ ] Distribute the backup invite link to current members **once, via bot DM**: "If the live group ever goes down, switch to <link>." Never share externally.
- [ ] Record the backup chat ID privately (commented-out in `.env.local`, not loaded as env).

## 4. Migration procedure (live group → backup group)

Triggered when:

- Bot DMs admins with `Group <chatId> appears to have been deleted by Telegram` (the chat-gone alert from Task 4 of the resilience plan), **or**
- Admins notice the live group is missing from their Telegram client.

Steps:

1. In Railway → Variables on the bot service, change `TELEGRAM_ALLOWED_CHAT_IDS` to the backup group's chat ID. Save.
2. Service auto-redeploys. Watch logs for `server listening`.
3. Run `npm run telegram:onboarding -- --guide-chat-id <backup-id> --pin-guide` to install the bot description, command menu, and pinned guide on the new group.
4. Run `npm run telegram:webhook` to refresh `setWebhook` (URL doesn't change, but `getWebhookInfo` confirms health).
5. *(Optional)* Replay live entries into the new group via the SQL-to-export-JSON recipe in §5. Or accept that the new group starts fresh.

## 5. SQL → Telegram-export-JSON recipe (DR replay)

Used only if you want to rehydrate the live entry history into a new group post-migration. The replay tool `replayLegacyTelegramExport.ts` accepts a Telegram-export-shaped JSON file as input.

```bash
# 1. Snapshot live entries from Postgres into a flat JSON.
psql "$DATABASE_URL" -tAc "
  SELECT jsonb_build_object(
    'id', id,
    'type', 'message',
    'date', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS'),
    'date_unixtime', extract(epoch from created_at)::bigint::text,
    'from', reviewer_username,
    'from_id', 'user' || COALESCE(reviewer_telegram_id::text, '0'),
    'text', target_username || ' ' || result || ' ' || COALESCE(selected_tags, '[]'),
    'text_entities', '[]'::jsonb
  )
  FROM vouch_entries
  WHERE status = 'published'
  ORDER BY created_at, id
" > entries.jsonl

# 2. Wrap in the Telegram-export envelope.
jq -s '{
  name: "VouchVault Recovery",
  type: "private_supergroup",
  id: 1,
  messages: .
}' entries.jsonl > recovery.json

# 3. Replay against the new group.
npm run replay:legacy recovery.json -- --target-chat-id <backup-id> --throttle-ms 3100
```

**Caveats:**

- The replay tool is idempotent on `(legacy_source_chat_id, legacy_source_message_id)`, so re-running is safe but ID re-use across recoveries needs awareness.
- The recipe above shapes the minimum fields the parser reads; tags are stringified rather than rich-formatted. The output entries will look like legacy entries (italic `(repost)` footer), which is correct for a recovery.
- Live entries posted directly via the DM flow in the original group are present in the DB and **will** be replayed by this recipe. Drafts in flight at the time of takedown are not.

## 6. Member-velocity alert response

When the bot DMs admins with `Member-velocity alert in <chatId>: <N> joins / <M> leaves...`:

1. **Pause** new vouches: any admin runs `/pause` in the group (or DM if the group is unreachable).
2. **Inspect** the join/leave list in Telegram's group log (Manage Group → Recent Actions).
3. If new joins look coordinated (similar usernames, account creation dates clustered, no profile photos), kick + ban; consider tightening Request-to-Join approval criteria.
4. If leaves are coordinated, expect a report attack within 24h — keep paused, monitor `/readyz`, prepare to migrate.
5. Resume with `/unpause` once the situation is clear.

## 7. Appeals (last resort)

If the live group is gone:

- Email `recover@telegram.org` from the admin account associated with the bot, including the deleted group's `chatId` and a brief explanation that the group complied with Telegram ToS.
- Open `@SpamBot` and follow its prompts.
- Open in-app **Settings → Ask a Question** and reference the group link.

Expected response time: 1–7 days. Permanent bans are rarely reversed without proof of automated error. **Do not delay migration waiting on a successful appeal** — the migration steps in §4 are reversible if the appeal succeeds.
````

- [ ] **Step 2: Verify the doc renders cleanly**

Run: `node -e "console.log(require('fs').readFileSync('docs/runbook/opsec.md','utf8').length)"`
Expected: ~5,000-6,000 characters; no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/opsec.md
git commit -m "$(cat <<'EOF'
docs: add OPSEC runbook for takedown resilience

Captures the manual Telegram-side hardening checklist, backup-group
procedure, migration steps when the live group dies (env-var swap +
onboarding + webhook refresh), the SQL-to-Telegram-export-JSON recipe
for DR replay against the new group, the member-velocity alert
response playbook, and the (mostly-ineffective) appeals contacts. The
chat-gone alert and member-velocity alert from the resilience chunk
both link here so admins know what to do when paged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (post-implementation)

After Task 10, before declaring the chunk complete:

- [ ] **Spec coverage:** every spec §3.x item has a corresponding task. (3.1 → Task 1; 3.2 → Task 8; 3.3 → Tasks 2/3/4/5; 3.4 → Tasks 6/7; 3.5 → Task 9; 3.6 → Task 10.)
- [ ] **Tests in `package.json` `test` script:** `chatGoneHandler.test.ts` and `memberVelocity.test.ts` are both listed. Run `npm test` and confirm test count is 90.
- [ ] **Type-check clean:** `npx tsc --noEmit` exits 0.
- [ ] **No locked-text drift:** existing tests for welcome / pinned guide / bot description still pass.
- [ ] **Webhook re-registered:** documented in commit messages; final deploy checklist in DEPLOY.md still names `npm run telegram:webhook` and `npm run telegram:onboarding` as post-deploy steps.

---

## Out of scope (per spec §7, do **not** implement here)

- Reactions recording in DB (defer until a feature needs it).
- `/me` DM command.
- `/digest` admin DM command.
- `/respond` for vouch targets.
- `/migrate_to` admin command (manual env-var change suffices for v1; documented in §4 of the runbook).
- Live-DB-to-export-JSON helper script (replaced by the documented `psql` recipe).
