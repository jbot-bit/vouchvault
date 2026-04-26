# Vendetta-resistant posture — design v1.1

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md`, `docs/runbook/opsec.md`
**Revision:** v1.1 — codebase-audit fixes (predicate consistency for legacy NEGs, function/symbol names corrected against current `archiveStore.ts`, draft-table column added, logger redaction, deployment task for legacy NEG posts).

## 1. Context

VouchVault publishes structured peer-vouches into a private, request-to-join supergroup where members cannot post — only the bot does. The DM submission flow takes a target @username, an outcome (positive / mixed / negative), and tags from a fixed allowlist. The bot publishes a clean entry with a tap-to-copy `#id`, a 72h per-target cooldown, and an admin-only `/freeze`, `/remove_entry`, and `/lookup` toolset. CLAUDE.md has the full architecture.

The bot is also being designed against a near-future expansion to **multiple coordinated groups**: today's vouch hub plus an optional sales/listings group and an optional member chat group, all under the same admin team and the same DB. Every primitive in this spec must work generically across that multi-group future without rework. §10 covers that contract explicitly.

The threat model driving this spec is a real, repeated incident class:

> Members who receive a NEG entry have responded by hitting Telegram's in-app **Report** button on the bot's published post, motivated by personal grievance toward the named target. An internal `/report` flow that intercepts these reporters is **not viable** — operators have observed motivated reporters skip in-bot escalation and go directly to platform Report. The spec assumes:

> **Every published entry will be reported to Telegram by a hostile party. The published artefact must survive a T&S review on its own merits.**

The community-protective function — *flagging who is not trustworthy* — must continue to work, but cannot rely on a public artefact that exposes a named target to a "this post is about me" report claim. **Negative signal becomes private and persistent; the visible surface is a derived `Caution` status on the target's profile, not a feed entry.**

## 2. Goals

1. **No public NEG artefact going forward.** A NEG submission writes a permanent DB record but produces zero group posts, zero @-mentions of the target in any feed surface, and zero outbound DMs to anyone other than the submitter's own confirmation.
2. **Trust signal still flows uniformly.** A member querying `/profile @x` reliably learns whether the community has flagged caution, has frozen, or has nothing to say — and this works equally for new private NEGs and historical public NEGs already in the DB.
3. **Smallest diff that solves it.** One migration adding two text columns. One publish-path branch. One profile-status clause. One copy pass. One enum. No new commands, no new tables, no aggregation logic, no background jobs, no DM-broadcasts.
4. **Permanent NEGs.** A NEG record stays until an admin clears it via existing `/remove_entry`. No time-decay, no expiry, no automatic withdrawal.
5. **Hold the no-free-text-public invariant.** The single new free-text field (the optional admin-only note on a NEG) is never rendered to any non-admin surface, never logged in plaintext, never broadcast.

## 3. Non-goals

- Per-user rate limits beyond the existing 72h per-target cooldown.
- A user-facing `/report`, `/withdraw`, or `/dispute` command.
- Aggregation thresholds for caution. One NEG triggers caution. Volume is low; admins can clear on-demand.
- DM broadcast to past vouchers when a target is frozen — friend-of-frozen is itself a vendetta-creation surface; deliberately omitted.
- Time-decay on NEG records. NEGs are permanent unless an admin removes them.
- Migration of existing published NEG **records** in the DB. They continue to flag Caution under the new predicate — that is intentional and aligned with the goal. The associated *legacy public posts* in the group feed are a separate one-time deployment task (§5.1).
- Channel + linked-discussion-group migration (deferred to a future spec; this design is forward-compatible with that migration).
- Renaming `vouch_entries` table or `result` column. Internal identifiers stay; public-facing copy is the only thing that shifts.
- Outbound runtime regex moderation of public free-text content. There is no member-controlled free-text public surface in this design; a runtime lexicon gate has no consumer until/unless member chat returns.
- Any per-NEG audit-log row in `admin_audit_log`. The `vouch_entries` row IS the record, queryable via `/lookup`.

## 4. Design

### 4.1. NEG submissions become private records

The DM flow is unchanged through the `Confirm` step. After confirm, the publish path branches on `result`:

- `result === "positive"` or `result === "mixed"` → publish to the group as today, **with `protect_content: true`** (§4.2).
- `result === "negative"` → **skip the `sendTelegramMessage` call entirely.** Mark the entry `published` in DB with `publishedMessageId = null`. Send the reviewer a single confirmation DM:

  > *"Your concern about @x has been recorded as #42. Admins will see it; the wider group will not."*

  The `#42` is the entry id, included for parity with the tap-to-copy semantics on published entries. Reviewers can reference the id later if they want to retract or discuss with admins.

The DB row is permanent. It is queryable via `/lookup @x` (admin) and contributes to the `Caution` status visible via `/profile @x` (member-visible).

**Code:**
- `src/core/archivePublishing.ts` — branch in `publishArchiveEntryRecord`. Reuses existing `markArchiveEntryPublishing` → `setArchiveEntryStatus("published")` sequence; sets `publishedMessageId` to `null` on the NEG branch (no `setArchiveEntryPublishedMessageId` call required since the column is already nullable).
- No schema change for this part — `published_message_id` is already nullable in `vouch_entries` (confirmed in `src/core/storage/schema.ts:73`).

### 4.2. Forward protection on every published entry

Every `sendTelegramMessage` for a published archive entry sets `protect_content: true`. Belt-and-braces with the supergroup-level "Restrict saving content" setting; per-message `protect_content` is independent of that toggle and is what a T&S reviewer sees as a property of the message itself.

**Code:**
- `src/core/tools/telegramTools.ts` — extend `sendTelegramMessage` and `buildTelegramSendMessageParams` to accept `protectContent?: boolean` and forward as `protect_content`.
- `src/core/archivePublishing.ts` — pass `protectContent: true` in the publish call.

### 4.3. Optional admin-only note on NEG submissions

Reviewers submitting a NEG may add a short context note. The note is plain text, ≤240 characters, **visible to admins only via `/lookup @x`**, never rendered to any member-visible surface, never logged in plaintext.

**Flow:**
- After tag selection in a NEG draft, before the preview, the bot offers:
  > *"Optional: add a short note for admins (240 chars max). Send the note now, or tap **Skip**."*
- If the reviewer sends a text message ≤240 chars, store on the draft. Reject messages >240 chars with the prompt re-shown. If they tap Skip, store `null`.
- Preview shows the note back to the reviewer with an explicit label *"Admin-only note (not published): …"* so the visibility rule is unambiguous at confirm time.
- On `Confirm`, persist the note onto the entry row.
- **POS/MIX drafts skip this step entirely.** The validator rejects `private_note` on any non-NEG draft.

**Code:**
- `src/core/archive.ts` — extend `DRAFT_STEPS` with `awaiting_admin_note` (insertion: between `selecting_tags` and `preview`, traversed only on NEG drafts). Add `MAX_PRIVATE_NOTE_CHARS = 240`. Add `validatePrivateNote(text: string): { ok: true } | { ok: false; reason: "too_long" | "control_chars" | "empty" }`.
- `src/core/storage/schema.ts` — add `privateNote: text("private_note")` (nullable) to **both** `vouchEntries` and `vouchDrafts`. Migration `migrations/0008_add_private_note.sql` adds the two columns in one migration.
- `src/core/archiveStore.ts` — extend `createOrResetDraft` / `setDraftStep` / entry-insert / entry-fetch helpers to round-trip `privateNote`.
- `src/telegramBot.ts` — wire the `awaiting_admin_note` step into the existing `withReviewerDraftLock` state machine. Branch from `selecting_tags → Done` button: if `result === "negative"`, transition to `awaiting_admin_note`; else transition to `preview`. Add Skip-button callback handler.
- `src/core/archive.ts` — `buildLookupText` (admin path) renders the note, **HTML-escaped via the existing `escapeHtml`**, indented under the entry as `<i>Note:</i> <escaped-text>`. `buildProfileText` (member-visible) does not render it.
- New callback string `draft:skip_admin_note` (≤64 bytes UTF-8); add to `src/core/callbackData.test.ts` per the existing convention.

### 4.4. `Caution` status on `/profile @x`

`/profile @x` already exists. Its status line currently reads *"Status: Active"* or *"Status: Frozen — <reason>"*. Add a third state with the priority order:

> **`Frozen` > `Caution` > `Active` > `New`**

**Caution predicate (definitive):**

> Caution is true iff there is **any** `vouch_entries` row with `target_username = @x`, `result = 'negative'`, `status = 'published'`.

The predicate **does not** condition on `published_message_id`. This is deliberate: legacy public NEGs already in the DB also flag Caution, so the trust signal is uniform across new private NEGs and historical entries. The only thing the `published_message_id`-NULL branch in §4.1 does is suppress the *new* group post; the DB row's contribution to Caution is the same either way.

`getProfileSummary` already returns `totals.negative` from this exact filter (`status='published'` group-by `result`). The change is to surface that count to the renderer as a boolean `hasCaution = totals.negative > 0`, not to add a new SQL query.

The member-visible `/profile @x` text shows the Status word and the Positive/Mixed counts only — **the Negative count is hidden from members**. Admins see the full breakdown via `/lookup @x`, which already lists every entry; NEG entries appear there with the `private_note` rendered.

**Code:**
- `src/core/archiveStore.ts` — `getProfileSummary` is unchanged; the existing `totals.negative` count is sufficient.
- `src/core/archive.ts` — `fmtStatusLine` accepts an additional `hasCaution: boolean`; returns the priority-ordered status string. `buildProfileText` member rendering shows `Positive: N · Mixed: N` only (drop the Negative segment from the count line). Admin-side `buildLookupText` renderings are untouched.
- `src/telegramBot.ts` — `handleProfileCommand` passes `hasCaution: summary.totals.negative > 0` to `buildProfileText`.

### 4.5. Caution clears when admin removes the NEG

No new admin command. The existing `/remove_entry <id>` already transitions an entry to `removed` and is audited. When the last `negative` `published` row for a target is removed, `Caution` automatically goes away because it is a derived state computed at query time, not a stored flag. (The `removed` status falls outside the Caution predicate.)

If admin wants to keep the audit trail but suppress caution, `/remove_entry` is the path. The row remains in the DB with `status='removed'`, queryable via direct SQL but not via `/lookup` filters that scope to non-removed entries.

### 4.6. Anti-impersonation deny-list at target validation

Reject target usernames that match Telegram-reserved or bot-impersonating handles, **plus** marketplace-substring patterns derived from the QA-export lexicon scan.

**Two layers:**
- **Reserved handles** — exact-match Set: `telegram`, `spambot`, `botfather`, `notoscam`, `replies`, `gif`, plus the bot's own username (resolved from `process.env.TELEGRAM_BOT_USERNAME`, cached).
- **Marketplace substrings** — case-insensitive substring check against the normalised username. The substring list is derived from the QA export and lives as a constant in `archive.ts`. ~40 substrings: `scammer`, `vendor`, `plug`, `gear`, `seller`, `dealer`, `_4sale`, `coke`, `meth`, `weed`, `bud`, `kush`, `oxy`, `xan`, `mdma`, `molly`, `shrooms`, `lsd`, `acid`, `tabs`, `fent`, `supply`, `legit_seller`, `vouched_vendor`, etc. Full list shipped in code; `docs/runbook/opsec.md` carries the rationale (see §5).

Either match rejects the target with the same generic message — *"That handle can't be a vouch subject."* — with no diagnostic about which list matched (avoids giving an attacker a Boolean oracle).

**Code:**
- `src/core/archive.ts` — `RESERVED_TARGET_USERNAMES: ReadonlySet<string>`, `MARKETPLACE_USERNAME_SUBSTRINGS: ReadonlyArray<string>`, `isReservedTarget(username): boolean`.
- `src/telegramBot.ts` — call `isReservedTarget` after `normalizeUsername`, alongside the existing self-vouch / frozen-profile checks.

### 4.7. Expose `/profile @target` to non-admins in group context

Today `/profile` in DM is open; `/profile` in group is admin-gated (`src/telegramBot.ts:1198–1217`). Drop the admin gate so any member can `/profile @x` in the group and see the structured trust card with Status. This is the primary read path for the new Caution signal.

The existing `recordAdminAction` audit call stays, with `denied: false`, so member-side profile queries are visible to admins as a soft heatmap of who's checking whom.

**Code:** remove the `isAdmin` gate from the group-context `/profile` handler (`telegramBot.ts:1206–1217`). Keep the `recordAdminAction` audit call.

### 4.8. Freeze reason becomes an admin-template enum

`/freeze @x <reason>` currently accepts free-text and stores the trimmed first 200 chars (`setBusinessProfileFrozen` slices `input.reason?.trim().slice(0, 200)` at `archiveStore.ts:143`). Free-text reasons are an unnecessary risk surface — a reason like *"scammer who took my $500"* is a reportable claim a hostile target's friend could escalate. Replace with a fixed enum:

- `unmet_commitments` — label *"unmet commitments"*
- `community_concerns` — label *"community concerns"*
- `policy_violation` — label *"policy violation"*
- `at_member_request` — label *"at member's request"*
- `under_review` — label *"under review"*

The freeze command takes `/freeze @x <enum-key>`. The profile renders the human-readable label. Free-text is not accepted; the enum is the entire vocabulary.

**Code:**
- `src/core/archive.ts` — `FREEZE_REASONS` constant (the five keys above), `FREEZE_REASON_LABELS` map, `isFreezeReason(value): value is FreezeReason` predicate.
- `src/telegramBot.ts` — `/freeze` handler validates the enum, rejects free-text with the list of valid keys.
- `src/core/archiveStore.ts` — `setBusinessProfileFrozen` keeps writing the **enum key** to `freeze_reason`. Drop the `slice(0, 200)` truncation as the enum keys are short and pre-validated. Add a value check in the function as defence-in-depth.
- The existing `freeze_reason text` column accepts the enum keys without a DB CHECK constraint (app-level validation is sufficient and keeps the migration light); legacy free-text rows in the column continue to display verbatim until they're naturally cleared by `/unfreeze`.

### 4.9. Vocabulary cleanse — minimal, copy-only

Member-facing copy shifts away from commerce-coded language. Internal identifiers (`vouch_entries`, `result='negative'`, `EntryResult` type, `POS/MIX/NEG` prefix constants) stay unchanged — no DB migration, no symbol churn.

**Public-facing swaps (concrete strings):**

| Surface | Current | New |
|---|---|---|
| `buildBotDescriptionText` (`archive.ts:412`) | *"A business hub for local businesses to share and verify service experiences."* (via `aboutLine`) and *"Log and review local-business service experiences with the community."* | *"A community vouch hub for members who personally know each other. Log honest vouches; help others find trustworthy people to deal with."* |
| `buildBotShortDescription` (`archive.ts:422`) | *"Vouch Hub — log and review local-business service experiences. Open from the group launcher."* | *"Vouch Hub — community vouches between members who know each other. Open from the group launcher."* |
| `aboutLine` (`archive.ts:196`) | *"A business hub for local businesses to share and verify service experiences."* | *"A community vouch hub for members who personally know each other."* |
| `buildWelcomeText` body | *"Log and review local-business service experiences with the community."* | *"Vouch for members you personally know. The community helps each other find trustworthy people to deal with."* |
| `buildPinnedGuideText` body | *"Log and review local-business service experiences with the community."* | (same as welcome) |
| NEG submission flow copy in DM | "Negative" | "Concern" — applied at button label and step prompts |
| Group launcher button | "Submit Vouch" | unchanged |
| `rulesLine()` | one-line | expanded block, see §4.10 |

The four V3-locked text builders (`buildWelcomeText`, `buildPinnedGuideText`, `buildBotDescriptionText`, `buildBotShortDescription`) require their tests in `archiveUx.test.ts` updated in the same commit. **This spec is the spec change that authorises that drift** per CLAUDE.md's V3-lock policy.

### 4.10. Expanded `rulesLine()` block

Replace the single-line `rulesLine()` (currently *"Follow Telegram's Terms of Service. No illegal activity, no scams."*) with a multi-line block, used by `buildWelcomeText`, `buildPinnedGuideText`, and `buildBotDescriptionText`:

> **Rules**
> - Follow Telegram's Terms of Service. No illegal activity, no scams.
> - Vouch only for members you actually know personally.
> - No personal opinions about people, no rating individuals, no vouching minors.
> - You are responsible for the accuracy of your own vouches.

This block sits in the chat description, the pinned guide, and the bot's profile, so a T&S reviewer arriving from a hostile report finds the documented scope on display.

### 4.11. Honest-opinion attestation in the preview

`buildPreviewText` adds one final line above the Confirm keyboard:

> *"By confirming, you declare you personally know this member and stand behind this vouch. You are responsible for what you submit."*

Locks the social-attestation framing into the publish moment for both POS and the now-private NEG path. (Wording deliberately social, not transactional — no mention of "trade," "transaction," "deal," or "service.")

### 4.12. Logger redaction for `private_note`

`src/core/logger.ts` defines pino redact paths for token / secret / password / api_key / authorization. Extend with `*.privateNote` and `*.private_note` to ensure note bodies never appear in structured log output regardless of which call passes the entry/draft object through pino.

**Code:**
- `src/core/logger.ts` — add `*.privateNote` and `*.private_note` to the `redact.paths` list.

## 5. Documentation deliverables

### 5.1. OPSEC runbook appendix

`docs/runbook/opsec.md` gains a new section after §6 (member-velocity response):

> ## 6a. Lexicon reference — derived from peer-group export 2026-04-26
>
> Numbers below come from a one-time scan of a 9,706-message export from a peer drug-trade circuit, used as adversarial training data for this bot's hardening. Patterns appear here for admin reference; the runtime defence is the username-substring deny-list in `src/core/archive.ts:MARKETPLACE_USERNAME_SUBSTRINGS`.
>
> | Cluster | Volume in 9.7k corpus | Examples |
> | --- | --- | --- |
> | Drug-direct vocab | 291 hits | bud, gas, coke, shrooms, carts, tabs, meth, oxy, fire |
> | Buy-sell verbs | 320 hits | pm me, selling, buy, sell, hit me up |
> | Money-codes | 1,007 hits | 1k, 2k, rack, paid, transfer |
> | Delivery-trade | 282 hits | drop, meet, pickup, post, f2f |
> | Vendor-roles | 235 hits | guy, plug, dealer, vendor, supplier |
> | Stealth-shipping | 11 hits | vac seal, smell proof, seized, customs |
> | Burner-comms | 69 hits | signal, threema, wickr |
> | Doxing patterns | rare but catastrophic | "Name: …", "Current Address: …" |
>
> What admins watch for in `/lookup @x` `private_note` text: any of the above clusters, especially doxing-pattern + drug-direct co-occurrence; that combination is the highest-priority `/freeze` signal.

This is documentation only — no runtime consumer.

### 5.2. Deployment task — historical NEG cleanup

When this spec ships, the predicate change in §4.4 means **legacy public NEG records continue to flag Caution** on the target's profile (correct trust signal). However, the **legacy public NEG posts** themselves remain in the group feed as pre-existing reportable artefacts.

**One-time deployment task** for operators:

1. Run `psql "$DATABASE_URL" -tAc "SELECT id FROM vouch_entries WHERE result='negative' AND status='published' AND published_message_id IS NOT NULL ORDER BY id"` — list of legacy public NEG entry ids.
2. For each id, run `/remove_entry <id>` from an admin account in the host group. The bot deletes the group post and transitions the row to `removed`.
3. Verify via the same SQL query returning empty.

The list is finite and small (NEGs were rare). Re-running `/remove_entry` on an already-removed entry is idempotent (existing handler).

**Caution behaviour during cleanup:** removing the legacy NEG also clears Caution if it was the only NEG on that target. That is correct — admins are explicitly choosing to retract the entry. A reviewer who still considers the target untrustworthy can re-submit a private NEG via the new flow.

This task is captured in `DEPLOY.md` as an addition to the post-deploy checklist.

## 6. Architecture

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `archive.ts` text builders | Render every public string + new attestation + rules block | Entry / draft data | HTML strings |
| `archive.ts` validators | `isReservedTarget`, `isFreezeReason`, `validatePrivateNote`, marketplace-substring check | Username / reason / note | Boolean / discriminated result |
| `archivePublishing.ts` | Branch on NEG: skip publish, leave `publishedMessageId` null | Entry row | Sent message_id or null |
| `archiveStore.ts` | Round-trip `privateNote` on draft and entry; `getProfileSummary` unchanged (existing `totals.negative` already correct) | Entry / draft id / target | DB rows |
| Existing `/freeze`, `/remove_entry`, `/profile`, `/lookup` handlers in `telegramBot.ts` | Same as today plus enum reason and removed admin gate on `/profile` | Command + args | Replies |
| `logger.ts` redact list | Suppress note bodies from structured logs | (config) | (config) |

No new units. No new commands. No new tables. Two new columns in one migration. One new draft step. One new derived field.

## 7. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`. New tests (append to `package.json` `test` script):
   - `src/core/reservedTargets.test.ts` — `isReservedTarget` for each list (reserved exact match, marketplace substring case-insensitive, bot-username from env).
   - `src/core/freezeReason.test.ts` — `isFreezeReason` and label rendering for each enum key; rejection of free-text values.
   - `src/core/privateNoteValidator.test.ts` — `validatePrivateNote` enforces ≤240 chars, rejects empty / control-char-only inputs.
   - `src/core/privateNeg.test.ts` — submitting a NEG produces `publishedMessageId = null`, `privateNote` round-trips, no `sendTelegramMessage` call (mock the API). Validator rejects `privateNote` on POS/MIX drafts.
   - `src/core/profileCaution.test.ts` — `/profile @x` returns Caution when an active negative entry exists (covering both `publishedMessageId IS NULL` private NEGs and `publishedMessageId IS NOT NULL` legacy public NEGs); clears when `/remove_entry` is run; member-visible builder hides the Negative count; admin `/lookup` shows the entry with its `privateNote`, HTML-escaped.
   - `src/core/archiveUx.test.ts` — update the four V3-locked-copy tests for new wording. Add: rules block contents, attestation line in preview, "Concern" wording for NEG flow.
   - `src/core/callbackData.test.ts` — add `draft:skip_admin_note` to the asserted-under-64-bytes set.
   - `src/core/loggerRedact.test.ts` — assert `*.privateNote` and `*.private_note` are redacted by the configured pino logger when an object containing those keys is logged.
2. **End-to-end (manual):**
   - **Forward protection:** publish a POS; long-press the group post; Forward and Save are absent.
   - **Reserved targets:** attempt `@telegram`, `@<botUsername>`, `@scammer_test`, `@coke_supply` — all rejected with the same generic message.
   - **NEG private path:** submit a NEG; no group post appears; reviewer sees the confirmation DM mentioning `#<id>`; `/lookup @target` (admin) shows the entry with the `privateNote` rendered HTML-escaped; `/profile @target` (in group, as a non-admin) shows `Status: Caution`; member sees Status word + Positive/Mixed counts only.
   - **Legacy NEG continues to flag Caution:** with a pre-existing `result='negative', status='published', published_message_id NOT NULL` row, `/profile @target` returns `Status: Caution` before any new private NEG is submitted.
   - **Caution clears on `/remove_entry`:** running `/remove_entry <id>` on the only NEG returns the profile to `Active` (or `New` if no other entries).
   - **Admin note validation:** in a NEG draft, send a 250-char note; bot rejects with the prompt re-shown. Try POS draft and verify the `awaiting_admin_note` step is never reached.
   - **Freeze enum:** `/freeze @x community_concerns` succeeds; `/freeze @x scammer_who_took_500` is rejected with the enum list; legacy free-text-reason rows continue to render verbatim until next `/unfreeze`.
   - **Member `/profile`:** non-admin in group runs `/profile @x` and gets the trust card. `recordAdminAction` audit row created with `denied: false`.
   - **Attestation + rules:** preview shows the attestation line; pinned guide and bot description show the expanded rules block.
   - **Logger redaction:** with `LOG_LEVEL=debug`, walk through a NEG submission; tail logs and confirm no plaintext note appears.
3. **Idempotency regression:** replay a webhook with a known `update_id`; `processedTelegramUpdates` continues to short-circuit. Submitting a NEG, deduping a re-confirm via the existing `withReviewerDraftLock` path, both leave the DB in a consistent state.

## 8. Risks / accepted tradeoffs

- **Single-vendetta NEG is enough to flip Caution.** Mitigation: admins can clear via `/remove_entry`. Accepted because NEG volume is low and admin involvement is on-demand only — no proactive queue. The cost of a malicious NEG is bounded (one Caution status word, no public artefact, no DM to anyone) and reversible.
- **Subject can see their own Caution.** They cannot see who filed it. The `private_note` is admin-only and HTML-escaped. Accepted; minimum information disclosure.
- **Frozen status is visible in profile.** A frozen target's friend may notice and be annoyed. **No bot-initiated DM** reaches them, so there is no bot-action artefact to point a Report at — they would have to compose a Report against a profile-status word, which Telegram's reporting flow does not directly support. Accepted.
- **Admin-template freeze reasons reduce expressiveness.** Five options cover the cases that have come up. Free-text reasons can still be added by an admin appending a `private_note` to a related entry if richer audit context is desired.
- **Existing legacy NEG group posts.** Removed at deploy time per §5.2. In the window between deploy and cleanup completion, those legacy posts remain in the feed (pre-existing risk; no new exposure created by this spec).
- **Right-to-erasure path.** A member who asks for their data to be removed is handled with existing tooling: admin runs `/freeze @x at_member_request`, then `/remove_entry` on each of their entries (queryable via `/lookup @x`), then a manual SQL clear of `business_profiles` row if they want full erasure (admin task; out of scope to add a command).

## 9. Out of scope (explicit)

- Per-user rate limits beyond the existing 72h per-target cooldown.
- `/withdraw`, `/dispute`, `/report` member-side commands.
- `/top` leaderboard, `/search <tag>`, weekly digest, repost / share features.
- Aggregation thresholds for caution.
- Time-decay or expiry on NEG records.
- DM broadcast to past vouchers when a target is frozen.
- Channel + linked-discussion-group migration.
- Runtime regex moderation of public free-text content (no consumer in this design).
- Rename of `vouch_entries` table or `result` column.
- Bot copy in admin-only commands.
- DB CHECK constraint on `freeze_reason` column. App-level enum validation only.

## 10. Multi-group forward compatibility

The bot is being designed against a near-future state with up to three coordinated groups under the same admin team and the same DB:

| Role | Purpose | Member posting | Publish target for this spec's primitives |
|---|---|---|---|
| `vouch_hub` | Today's host group. POS/MIX entries publish here. | Bot only | **All POS/MIX entries publish here, regardless of which group the launcher was tapped in.** |
| `sales_group` *(future)* | Member listings, bot-mediated. Out of scope for this spec. | Bot only (listings); members react/comment via linked discussion if applicable | None — this spec's primitives don't publish here. |
| `chat_group` *(future)* | Member free chat with hard controls (cold-start, slow mode, regex deletes). Out of scope for this spec. | Members can post (with limits) | None — this spec's primitives don't publish here. The runtime lexicon gate that belongs on this surface is captured in the chat-group spec, not here. |

### Contract this spec commits to

Every primitive defined above is **group-role-agnostic** at the call site. Concretely:

- **`/profile @x`** is callable from any allowed chat (vouch hub, sales group, chat group, or DM). The output is the same trust card. The §4.7 admin-gate removal applies uniformly.
- **`/lookup @x`, `/freeze`, `/unfreeze`, `/remove_entry`, `/recover_entry`, `/frozen_list`, `/pause`, `/unpause`** are admin-callable from any allowed chat or DM. Behaviour is unchanged across roles.
- **NEG submission DM flow** is not chat-bound — it happens in DMs. The reviewer's launcher tap can originate in any allowed chat; the resulting NEG is private regardless.
- **POS/MIX submission DM flow** publishes to the **vouch hub**. The launcher's `targetGroupChatId` (already on `vouch_drafts`) is preserved for the round-trip back to the originating chat for confirmation, but the **publication target** is the chat with role `vouch_hub`.
- **`protect_content: true`** applies on every entry-publication regardless of role.
- **Marketplace-substring username deny-list** applies at validation, before any group-context branching.
- **Caution status** is derived from DB; queryable from any role.
- **Freeze enum** is independent of group role.

### Group-role resolution — minimal diff now

This spec does **not** introduce a new env var or schema column for group-role mapping. The current `TELEGRAM_ALLOWED_CHAT_IDS` allowlist remains the gate. The role-resolution rule for the work in this spec is:

> **The single chat in `TELEGRAM_ALLOWED_CHAT_IDS` is the `vouch_hub`. All entry publications target it.**

When the multi-group future ships, that future spec introduces the role-mapping concept (one likely shape: extend `chat_settings` with a `role` column defaulting to `vouch_hub`, with a `npm run telegram:onboarding` flag to set it). Until then, the implicit-single-vouch-hub rule above is the contract.

### What the future chat-group spec will need (captured here for handoff, not built)

- A `chat_role` column on `chat_settings` (or env-var equivalent), values `vouch_hub | sales_group | chat_group`.
- Per-message regex gate hooks on the chat group: URL count ≤2, @-mention count ≤2, cross-post detector (identical text from same user across chats within 30m), forwards-from-external delete, raw crypto-wallet / phone / email regex deletes.
- Cold-start period for new joiners in the chat group (text-only, no links/forwards/media for first 24–48h).
- Lexicon-substring runtime gate using the `MARKETPLACE_USERNAME_SUBSTRINGS` data plus a wider runtime lexicon — this spec stages the data; that spec consumes it.
- The OPSEC runbook §6a appendix shipped here is the data foundation that informs both the runtime lexicon and admin training for chat-group moderation.

### What this spec deliberately does not do for the multi-group future

- No code paths for `sales_group` or `chat_group` roles.
- No role-mapping config / migration. Single-chat `vouch_hub` rule stands.
- No moderation runtime for member-posted text (no consumer in single-chat configuration).
- No listings primitive, no buyer-seller mediation, no escrow.
- No cross-group activity broadcast or feed.

The deliberate omissions keep this spec's diff small while ensuring nothing it ships will need a rewrite when the chat group and sales group spec lands.
