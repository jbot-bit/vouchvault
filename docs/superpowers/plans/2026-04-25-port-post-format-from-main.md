# Port Post-Format Work From `origin/main` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the V3 post-format and manual-repost-import work that landed on `origin/main` (commits `f5638bd..552b3c0`) onto the `redesign/v3-implementation` branch, where files were moved from `src/mastra/` → `src/core/` and partially rewritten.

**Architecture:** Three coherent commits — (1) one consolidated archive-text format port that reaches the same end state as `origin/main`'s archive.ts (drop headings, rename labels to From/For/Vouch/Tags/Date, bold every label, italic `(repost)` legacy footer, dd/mm/yyyy date format), (2) port the manual-repost `FROM:/DATE:` header unwrap into the legacy parser, (3) port the two `scripts/smokePost*.ts` smoke scripts with import paths fixed for the new file layout. We deliberately **collapse the 5 archive-format commits on main into one commit** here because the intermediate states (e.g. add Tags, then rename labels, then bold labels) are noise — only the end state matters on this branch.

**Tech Stack:** TypeScript, Node `--test` runner, Telegram Bot HTML formatting.

**Scope guard — explicitly NOT in this plan:**
- `buildWelcomeText`, `buildPinnedGuideText`, `buildBotDescriptionText`, `buildBotShortDescription` are **V3 spec-locked copy** on the redesign branch (commits `687d42b`, `1be8516`). Do not touch them, even though `origin/main` differs.
- The legacy-parser sentiment/bot-sender/multi-target/caption-fallback work from commit `c529884` is **already on this branch** (commits `72c1b12`, `cdfdbf9`, `56411de`, `b1641ad`). Do not duplicate.
- `scripts/analyzeLegacyExport.ts` from `c529884` is a one-off triage script — skip; it can be re-derived if needed.

---

## File Structure

**Modified:**
- `src/core/archive.ts` — replace `buildArchiveEntryText`, `buildPreviewText`, `buildResultPromptText`, `buildTagPromptText`, `buildLookupText`, `buildPublishedDraftText`, `buildTypePromptText`; rewrite `fmtDate` to dd/mm/yyyy.
- `src/core/archiveUx.test.ts` — rewrite the two `buildArchiveEntryText` tests + the `buildPreviewText` test for the new shape.
- `src/core/legacyImportParser.ts` — add `REPOST_HEADER_REGEX`, `tryUnwrapManualRepostHeader`, `legacyUsernameForDeletedAccount`; restructure the rawText resolution in `parseLegacyExportMessage` so the unwrap can override sender + timestamp before the missing-reviewer check.
- `src/core/legacyImport.test.ts` — append two new tests covering the FROM/DATE wrapper (named user + DELETED ACCOUNT).

**Created:**
- `scripts/smokePostFormatDemo.ts` — synthetic format-demo poster, imports from `../src/core/archive.ts`.
- `scripts/smokePostLegacySample.ts` — legacy-export sample poster, imports from `../src/core/archive.ts` + `../src/core/legacyImportParser.ts`.

**Cleanup at the end of the plan:**
- `.tmp_main_*.ts` snapshot files in repo root (created by the planning step). Delete before final commit.

---

## Task 1: Port post-format end-state to `archive.ts`

**Files:**
- Modify: `src/core/archive.ts:157-159` (rewrite `fmtDate`), `src/core/archive.ts:169-198` (rewrite `buildArchiveEntryText`), `src/core/archive.ts:200-214` (rewrite `buildPreviewText`), `src/core/archive.ts:242-244` (rewrite `buildTypePromptText`), `src/core/archive.ts:246-254` (rewrite `buildResultPromptText`), `src/core/archive.ts:256-270` (rewrite `buildTagPromptText`), `src/core/archive.ts:288-294` (the `Tags:` line inside `buildLookupText` becomes bold), `src/core/archive.ts:351-358` (rewrite `buildPublishedDraftText`).
- Test: `src/core/archiveUx.test.ts:21-90` (rewrite the three format tests).

- [ ] **Step 1: Rewrite the live-entry test (failing first)**

Replace lines 21-43 of `src/core/archiveUx.test.ts`:

```ts
test("buildArchiveEntryText renders live entries with bold labels and no heading", () => {
  const text = buildArchiveEntryText({
    entryId: 42,
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    entryType: "service",
    result: "positive",
    tags: ["good_comms", "on_time"],
    createdAt: new Date("2026-04-24T10:00:00.000Z"),
    source: "live",
  });

  assert.equal(
    text,
    [
      "<b>From:</b> <b>@alice</b>",
      "<b>For:</b> <b>@bobbiz</b>",
      "<b>Vouch:</b> <b>Positive</b>",
      "<b>Tags:</b> Good Comms, On Time",
    ].join("\n"),
  );
});
```

- [ ] **Step 2: Rewrite the legacy-entry test**

Replace lines 45-69 of `src/core/archiveUx.test.ts`:

```ts
test("buildArchiveEntryText renders legacy entries with bold labels, dd/mm/yyyy Date, and an italic '(repost)' footer", () => {
  const text = buildArchiveEntryText({
    entryId: 7,
    reviewerUsername: "legacyop",
    targetUsername: "oldvendor",
    entryType: "service",
    result: "negative",
    tags: ["poor_comms"],
    createdAt: new Date("2025-11-02T00:00:00.000Z"),
    source: "legacy_import",
    legacySourceTimestamp: new Date(Date.UTC(2025, 10, 2, 12)),
  });

  assert.equal(
    text,
    [
      "<b>From:</b> <b>@legacyop</b>",
      "<b>For:</b> <b>@oldvendor</b>",
      "<b>Vouch:</b> <b>Negative</b>",
      "<b>Tags:</b> Poor Comms",
      "<b>Date:</b> 02/11/2025",
      "",
      "<i>(repost)</i>",
    ].join("\n"),
  );
});
```

Note the change to `legacySourceTimestamp`: anchor at `Date.UTC(2025, 10, 2, 12)` (noon UTC) so the dd/mm/yyyy render is timezone-stable. The previous test used `new Date("2025-11-02T00:00:00.000Z")` which works at noon-UTC anchoring too, but main's parser writes timestamps at noon-UTC, so we mirror that here for clarity.

- [ ] **Step 3: Rewrite the preview test**

Replace lines 71-90 of `src/core/archiveUx.test.ts`:

```ts
test("buildPreviewText mirrors the posted format with a bold underlined heading", () => {
  const text = buildPreviewText({
    reviewerUsername: "alice",
    targetUsername: "bobbiz",
    result: "positive",
    tags: ["good_comms", "on_time"],
  });

  assert.equal(
    text,
    [
      "<b><u>Preview</u></b>",
      "",
      "<b>From:</b> <b>@alice</b>",
      "<b>For:</b> <b>@bobbiz</b>",
      "<b>Vouch:</b> <b>Positive</b>",
      "<b>Tags:</b> Good Comms, On Time",
    ].join("\n"),
  );
});
```

- [ ] **Step 4: Run tests — confirm the three rewritten tests fail**

Run: `npm test 2>&1 | tail -25`

Expected: three failures in `archiveUx.test.ts` for the three rewritten tests, with assertion diffs showing OP/Target/Result vs From/For/Vouch. All other 63 tests still pass.

- [ ] **Step 5: Rewrite `fmtDate` for dd/mm/yyyy**

Replace lines 157-159 of `src/core/archive.ts`:

```ts
function fmtDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return escapeHtml(`${day}/${month}/${year}`);
}
```

- [ ] **Step 6: Rewrite `buildArchiveEntryText`**

Replace lines 169-198 of `src/core/archive.ts`:

```ts
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
    `<b>From:</b> ${fmtUser(input.reviewerUsername)}`,
    `<b>For:</b> ${fmtUser(input.targetUsername)}`,
    `<b>Vouch:</b> ${fmtResult(input.result)}`,
    `<b>Tags:</b> ${fmtTags(input.tags)}`,
  ];

  if (isLegacy && input.legacySourceTimestamp) {
    lines.push(`<b>Date:</b> ${fmtDate(input.legacySourceTimestamp)}`);
  }

  if (isLegacy) {
    lines.push("", "<i>(repost)</i>");
  }

  return lines.join("\n");
}
```

- [ ] **Step 7: Rewrite `buildPreviewText`**

Replace lines 200-214 of `src/core/archive.ts`:

```ts
export function buildPreviewText(input: {
  reviewerUsername: string;
  targetUsername: string;
  result: EntryResult;
  tags: EntryTag[];
}): string {
  return [
    "<b><u>Preview</u></b>",
    "",
    `<b>From:</b> ${fmtUser(input.reviewerUsername)}`,
    `<b>For:</b> ${fmtUser(input.targetUsername)}`,
    `<b>Vouch:</b> ${fmtResult(input.result)}`,
    `<b>Tags:</b> ${fmtTags(input.tags)}`,
  ].join("\n");
}
```

- [ ] **Step 8: Update the in-flow prompt builders to match**

Replace `buildTypePromptText` at lines 242-244:

```ts
export function buildTypePromptText(targetUsername: string): string {
  return [`<b>Target saved:</b> ${fmtUser(targetUsername)}`, "", "What are you vouching for?"].join("\n");
}
```

Replace `buildResultPromptText` at lines 246-254:

```ts
export function buildResultPromptText(targetUsername: string): string {
  return [
    "<b>Step 2 of 3 — Result</b>",
    "",
    `<b>For:</b> ${fmtUser(targetUsername)}`,
    "",
    "Choose the result.",
  ].join("\n");
}
```

Replace `buildTagPromptText` at lines 256-270:

```ts
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
```

- [ ] **Step 9: Update `buildLookupText` Tags line to bold**

In `src/core/archive.ts` around line 292, replace:

```ts
    lines.push(`Tags: ${fmtTags(entry.tags)}`);
```

with:

```ts
    lines.push(`<b>Tags:</b> ${fmtTags(entry.tags)}`);
```

- [ ] **Step 10: Update `buildPublishedDraftText`**

Replace lines 351-358 of `src/core/archive.ts`:

```ts
export function buildPublishedDraftText(targetUsername: string, result: EntryResult): string {
  return [
    "<b>✓ Posted to the group</b>",
    "",
    `<b>For:</b> ${fmtUser(targetUsername)}`,
    `<b>Vouch:</b> ${fmtResult(result)}`,
  ].join("\n");
}
```

- [ ] **Step 11: Run all tests**

Run: `npm test 2>&1 | tail -10`

Expected: `tests 66 / pass 66 / fail 0` — same total since we rewrote rather than added.

- [ ] **Step 12: Commit**

```bash
git add src/core/archive.ts src/core/archiveUx.test.ts
git commit -m "$(cat <<'EOF'
feat(post-format): rename labels to From/For/Vouch/Tags/Date, drop heading, italic (repost) footer

Brings the V3 post-format work from origin/main onto this branch.

- Live entries: drop the "🧾 Entry #N" heading; lines start at "From:".
- Legacy entries: same body shape, with bold "Date: dd/mm/yyyy" and a
  small italic "(repost)" footer after a blank line — no heavy heading.
- Every field label is bold (<b>From:</b>, <b>For:</b>, <b>Vouch:</b>,
  <b>Tags:</b>, <b>Date:</b>) so each row has a strong left-edge anchor.
- Date format moves from ISO yyyy-mm-dd to dd/mm/yyyy to match how the
  group reads dates and the source export's DATE: lines.
- DM preview, step-2/step-3 prompts, lookup, and the published-draft
  confirmation all mirror the group post format.

archiveUx tests rewritten for all three shapes; npm test 66/66 passing.
EOF
)"
```

---

## Task 2: Port `FROM:/DATE:` manual-repost unwrap to the legacy parser

**Files:**
- Modify: `src/core/legacyImportParser.ts` — add helpers near top, restructure `parseLegacyExportMessage` rawText handling.
- Test: `src/core/legacyImport.test.ts` — append two new tests.

**Why:** The old admin migration pasted historical vouches into the new group as bot messages with a header like:
```
FROM: @rixx_aus / 2091586089
DATE: 05/04/2026

Pos vouch @mordecai_on good lad, always a pleasure
```
Without the unwrap, these get skipped as `bot_sender` (the message is sent by the import bot) or `missing_reviewer` (the export-level `from` is the bot, not the original reviewer). The unwrap re-injects the original reviewer + date so the row imports correctly.

- [ ] **Step 1: Add the two failing tests**

Append to `src/core/legacyImport.test.ts`:

```ts
test("unwraps a FROM/DATE manual-repost header and uses its fields", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "-",
      text:
        "FROM: @rixx_aus / 2091586089\n" +
        "DATE: 05/04/2026\n" +
        "\n" +
        "Pos vouch @mordecai_on good lad, always a pleasure",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.reviewerUsername, "rixx_aus");
  assert.equal(decision.candidate.targetUsername, "mordecai_on");
  assert.equal(decision.candidate.result, "positive");
  assert.equal(
    decision.candidate.originalTimestamp.toISOString().slice(0, 10),
    "2026-04-05",
  );
});

test("unwraps a FROM/DATE header for a DELETED ACCOUNT into a synthetic legacy username", () => {
  const decision = parseLegacyExportMessage({
    sourceChatId: SOURCE_CHAT_ID,
    message: buildMessage({
      from: "-",
      text:
        "FROM: DELETED ACCOUNT / 8448430705\n" +
        "DATE: 05/04/2026\n" +
        "\n" +
        "+rep @cool_ridge solid",
    }),
  });

  assert.equal(decision.kind, "import");
  assert.equal(decision.candidate.reviewerUsername, "legacy_8448430705");
  assert.equal(decision.candidate.targetUsername, "cool_ridge");
});
```

- [ ] **Step 2: Run tests — confirm both new tests fail**

Run: `npm test -- 2>&1 | grep -A2 "unwraps a FROM" | head -20`

Expected: both tests fail. Likely outcomes: the `@rixx_aus / 2091586089` test fails with `multiple_targets` (because both `@rixx_aus` and `@mordecai_on` match the username regex inside the unwrapped text), and the `DELETED ACCOUNT` one fails with `missing_reviewer`. Both confirm the unwrap isn't running.

- [ ] **Step 3: Add helpers near the top of `legacyImportParser.ts`**

Open `src/core/legacyImportParser.ts`. Find the line that ends the existing top-level constants block (roughly line 105, just before `function isLikelyBotSender` or similar — locate the line above the `FROM_ID_USER_PREFIX` regex if it exists, otherwise above the first non-pattern function).

Add this block right after the sentiment patterns block (find a stable anchor: it should sit above any function that consumes patterns — search for `// Manual-repost` to confirm it's not already there):

```ts
// Manual-repost wrapper used when an admin pasted historical vouches into a
// new group instead of using the bot. Format is exactly:
//   FROM: @username / 1234567890
//   DATE: dd/mm/yyyy
//   <blank line>
//   <original body>
// The username may also be the literal "DELETED ACCOUNT" — in which case we
// fall back to a synthetic placeholder built from the numeric id so the row
// can still flow through validation.
const REPOST_HEADER_REGEX =
  /^FROM:\s*(?:@\s*([A-Za-z0-9_]+)|(DELETED\s+ACCOUNT))\s*\/\s*(\d+)\s*\r?\n+DATE:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*\r?\n/i;

function legacyUsernameForDeletedAccount(numericId: number): string {
  return `legacy_${numericId}`;
}

function tryUnwrapManualRepostHeader(text: string): {
  body: string;
  reviewerUsername: string;
  originalTimestamp: Date;
} | null {
  const match = REPOST_HEADER_REGEX.exec(text);
  if (!match) {
    return null;
  }

  const [, namedUsername, deletedMarker, idStr, dayStr, monthStr, yearStr] = match;
  const numericId = Number(idStr);
  if (!Number.isSafeInteger(numericId)) {
    return null;
  }

  const reviewerUsername = deletedMarker
    ? legacyUsernameForDeletedAccount(numericId)
    : (normalizeUsername(namedUsername ?? null) ?? null);
  if (!reviewerUsername) {
    return null;
  }

  const day = Number(dayStr);
  const month = Number(monthStr);
  let year = Number(yearStr);
  if (year < 100) year += 2000;
  if (
    !Number.isInteger(day) || day < 1 || day > 31 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(year) || year < 2000 || year > 2100
  ) {
    return null;
  }
  // Anchor to noon UTC so the dd/mm/yyyy render is stable across timezones.
  const originalTimestamp = new Date(Date.UTC(year, month - 1, day, 12));

  const body = text.slice(match[0].length).replace(/^\s*\n+/, "");
  return { body, reviewerUsername, originalTimestamp };
}
```

- [ ] **Step 4: Wire the unwrap into `parseLegacyExportMessage`**

Inside `parseLegacyExportMessage` in `src/core/legacyImportParser.ts`, the redesign branch currently resolves `text` AFTER the `missing_reviewer` skip (around lines 459-475). Change the order so the unwrap can supply a reviewer when the export-level sender is the import bot.

Find this block (roughly lines 459-476 — the exact start is the comment-or-line above `if (!reviewerUsername)`, anchor on the assignment `const text = (() => { ... })();`):

```ts
  if (!reviewerUsername) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "missing_reviewer",
      detail: "Could not derive a public reviewer @username from the export sender fields.",
      bucket: "missing_reviewer",
    });
  }

  const text = (() => {
    const main = flattenLegacyMessageText((input.message as Record<string, unknown>).text).trim();
    if (main) return main;
    return flattenLegacyMessageText((input.message as Record<string, unknown>).caption).trim();
  })();
  const targetUsernames = extractLegacyTargetUsernames(text);
```

Replace with — note we now declare `let originalTimestamp` at this point. Since `originalTimestamp` is already defined earlier as `const`, **first** find the earlier declaration and change it to `let`. Search for `const originalTimestamp =` — there should be one site near `getLegacyMessageTimestamp`. Change `const` → `let`.

Then replace the block above with:

```ts
  // Resolve the body text first (with caption fallback) so we can inspect it
  // for a manual-repost wrapper before deciding whether the sender info is
  // actually missing.
  const rawText = (() => {
    const main = flattenLegacyMessageText((input.message as Record<string, unknown>).text).trim();
    if (main) return main;
    return flattenLegacyMessageText((input.message as Record<string, unknown>).caption).trim();
  })();

  // If the message text starts with a manual-repost wrapper
  // (`FROM: @user / id\nDATE: dd/mm/yyyy\n\n<body>`), unwrap it: the wrapper's
  // FROM/DATE fields override the export-level sender + timestamp, and the
  // body becomes the text we run target/sentiment extraction on.
  const unwrap = tryUnwrapManualRepostHeader(rawText);
  const text = unwrap ? unwrap.body.trim() : rawText;
  if (unwrap) {
    reviewerUsername = unwrap.reviewerUsername;
    originalTimestamp = unwrap.originalTimestamp;
  }

  if (!reviewerUsername) {
    return buildSkipDecision({
      message: input.message,
      sourceMessageId,
      originalTimestamp,
      reviewerUsername,
      reason: "missing_reviewer",
      detail: "Could not derive a public reviewer @username from the export sender fields.",
      bucket: "missing_reviewer",
    });
  }

  const targetUsernames = extractLegacyTargetUsernames(text);
```

If `reviewerUsername` is also currently `const`, change it to `let` at its declaration site too. Search for `const reviewerUsername` and `let reviewerUsername` near the top of `parseLegacyExportMessage` — pick whichever is currently used and ensure both `reviewerUsername` and `originalTimestamp` are declared as `let` so the unwrap can rebind them. (The existing redesign code already rebinds `reviewerUsername` from `fromId` at lines 453-456, so it should already be `let`.)

- [ ] **Step 5: Run tests — confirm the two new tests pass and nothing else broke**

Run: `npm test 2>&1 | tail -10`

Expected: `tests 68 / pass 68 / fail 0` (66 prior + 2 new). If anything else regresses, inspect — most likely a test that uses a bot-like `from:` value now gets unwrapped if its body matches the regex (it won't, since real test fixtures don't have `FROM: ... / DATE: ...`), but verify.

- [ ] **Step 6: Commit**

```bash
git add src/core/legacyImportParser.ts src/core/legacyImport.test.ts
git commit -m "$(cat <<'EOF'
feat(legacy-import): unwrap FROM/DATE manual-repost wrappers into the original sender

Old admin migration pasted historical vouches into the new group as the
bot, with a header like:

    FROM: @rixx_aus / 2091586089
    DATE: 05/04/2026

    <original body>

Without unwrap, those rows skipped as bot_sender or missing_reviewer.
Now we detect the wrapper, override the export-level sender +
timestamp with the wrapper's FROM/DATE fields, and run target/sentiment
extraction on the unwrapped body. DELETED ACCOUNT senders fall back to a
synthetic legacy_<numericId> placeholder so the row still validates.

Two new tests cover the named-user and DELETED-ACCOUNT shapes.
npm test 68/68 passing.
EOF
)"
```

---

## Task 3: Port the two `smokePost*` scripts

**Files:**
- Create: `scripts/smokePostFormatDemo.ts`
- Create: `scripts/smokePostLegacySample.ts`

**Why:** Both scripts let the owner eyeball the rendered post format in a test Telegram chat without going through the full replay pipeline. `smokePostFormatDemo.ts` posts hand-picked synthetic entries (live + legacy + deleted-account); `smokePostLegacySample.ts` parses a real export and posts a representative sample. The redesign branch's file layout means the imports must point at `../src/core/...` instead of `../src/mastra/...`.

- [ ] **Step 1: Create `scripts/smokePostFormatDemo.ts`**

Copy the content from the snapshot file and fix the import path. The snapshot is in `.tmp_smoke_format.ts` at repo root; its only divergence from what we want is the import line.

Run:

```bash
sed 's|../src/mastra/archive\.ts|../src/core/archive.ts|g' .tmp_smoke_format.ts > scripts/smokePostFormatDemo.ts
```

Then verify the file imports are correct:

```bash
grep -n "from \"../src" scripts/smokePostFormatDemo.ts
```

Expected output: one line, `import { ... } from "../src/core/archive.ts";`

- [ ] **Step 2: Create `scripts/smokePostLegacySample.ts`**

Same approach — translate two import paths:

```bash
sed -e 's|../src/mastra/archive\.ts|../src/core/archive.ts|g' \
    -e 's|../src/mastra/legacyImportParser\.ts|../src/core/legacyImportParser.ts|g' \
    .tmp_smoke_legacy.ts > scripts/smokePostLegacySample.ts
```

Verify:

```bash
grep -n "from \"../src" scripts/smokePostLegacySample.ts
```

Expected: two `import` lines, both pointing at `../src/core/...`.

- [ ] **Step 3: Type-check the two scripts**

The project's `tsconfig.json` includes `scripts/**/*.ts`. Run a no-emit type-check by leaning on the test runner's strip-types loader — it'll fail loudly if a type doesn't resolve. Use a minimal smoke load:

```bash
node --experimental-strip-types --check scripts/smokePostFormatDemo.ts 2>&1
node --experimental-strip-types --check scripts/smokePostLegacySample.ts 2>&1
```

Expected: no output (success). If `--check` is unsupported with `--experimental-strip-types`, fall back to:

```bash
node --experimental-strip-types -e "import('./scripts/smokePostFormatDemo.ts').catch(e => { console.error(e); process.exit(1); });" 2>&1 | head -5
```

That dynamic import will fail at runtime (no `--target-chat-id`) but should reach the main function — meaning the imports resolved cleanly. The presence of "Missing --target-chat-id" or similar Error message confirms types loaded; an `ERR_MODULE_NOT_FOUND` or TypeScript error means the import paths are wrong.

- [ ] **Step 4: Run tests — confirm nothing regressed**

Run: `npm test 2>&1 | tail -5`

Expected: `tests 68 / pass 68 / fail 0` (the new scripts aren't in the test suite, so the count is unchanged).

- [ ] **Step 5: Delete the `.tmp_main_*.ts` and `.tmp_smoke_*.ts` snapshot files**

Run:

```bash
rm .tmp_main_archive.ts .tmp_main_archive_test.ts .tmp_main_legacy.ts .tmp_main_legacy_test.ts .tmp_main_parser.ts .tmp_smoke_format.ts .tmp_smoke_legacy.ts
```

- [ ] **Step 6: Commit**

```bash
git add scripts/smokePostFormatDemo.ts scripts/smokePostLegacySample.ts
git commit -m "$(cat <<'EOF'
feat(scripts): port smokePostFormatDemo + smokePostLegacySample from main

Both scripts let the owner eyeball the rendered group-post format in a
test chat without committing to a full replay:

- smokePostFormatDemo.ts — posts a tiny set of hand-picked synthetic
  entries (live + legacy + DELETED-ACCOUNT placeholder) using the live
  buildArchiveEntryText. No DB, no parser.
- smokePostLegacySample.ts — parses the real legacy export, picks a
  representative sample (deleted-account, negatives, positives), and
  posts each through the same formatter. No DB.

Import paths point at src/core/ to match the redesign-branch layout.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- f5638bd (drop #N from legacy, add Tags line): ✓ Task 1 — `buildArchiveEntryText` now always emits `Tags:`, no entry-id heading.
- a837383 (drop heading from live, "From the Vault" for legacy): ✓ subsumed — Task 1 drops the heading entirely on both shapes (legacy gets the italic `(repost)` footer instead, per 561c831).
- c529884 part 1 (FROM/DATE repost parsing + DELETED ACCOUNT): ✓ Task 2.
- c529884 parts 2-3 (sentiment patterns, bot-sender skipping): SKIPPED — already on the redesign branch via `72c1b12`/`cdfdbf9`/`56411de`/`b1641ad`. Documented in scope guard above.
- c529884 part 4 (`scripts/analyzeLegacyExport.ts`): SKIPPED — one-off triage script. Documented in scope guard.
- 561c831 (italic vault footer, Original→Date, dd/mm/yyyy, smoke scripts): ✓ Task 1 + Task 3.
- 850128f (label rename OP→From etc., vault→repost): ✓ Task 1.
- 552b3c0 (bold every label): ✓ Task 1.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to..."/etc. Every step has full code or an exact command.

**Type consistency:** `EntryResult`, `EntryTag`, `EntrySource`, `LegacyImportCandidate`, `parseLegacyExportMessage`, `buildArchiveEntryText` — all names match the existing redesign-branch exports verified via Read of `src/core/archive.ts:5-8` and `src/core/legacyImportParser.ts:34-45,369`. No drift across tasks.

**Risks:**
- The `let reviewerUsername` / `let originalTimestamp` change in Task 2 Step 4 assumes the existing redesign code declares these as `let` (since it already rebinds `reviewerUsername` from `fromId`). If they're `const`, the change is a one-word edit at the declaration. Plan calls this out explicitly.
- The line numbers cited in "Files" are taken from the current state on disk; if Task 1 reorders nothing in `archive.ts` between functions (it doesn't — every edit is in-place), Task 2's line numbers in `legacyImportParser.ts` are independent.

---

## Execution Handoff

Plan saved. The plan is small (3 tasks, all on local files, with full tests) so I'll execute it inline.
