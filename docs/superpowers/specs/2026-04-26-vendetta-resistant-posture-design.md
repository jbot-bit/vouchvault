# Vendetta-resistant posture — design v1

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md`, `docs/runbook/opsec.md`

## 1. Context

VouchVault publishes structured peer-vouches into a private, request-to-join supergroup where members cannot post — only the bot does. The DM submission flow takes a target @username, an outcome (positive / mixed / negative), and tags from a fixed allowlist. The bot publishes a clean entry with a tap-to-copy `#id`, a 72h per-target cooldown, and an admin-only `/freeze`, `/remove_entry`, and `/lookup` toolset. CLAUDE.md has the full architecture.

The bot is also being designed against a near-future expansion to **multiple coordinated groups**: today's vouch hub plus an optional sales/listings group and an optional member chat group, all under the same admin team and the same DB. Every primitive in this spec must work generically across that multi-group future without rework. §10 covers that contract explicitly.

The threat model driving this spec is a real, repeated incident class:

> Members who receive a NEG entry have responded by hitting Telegram's in-app **Report** button on the bot's published post, motivated by personal grievance toward the named target. An internal `/report` flow that intercepts these reporters is **not viable** — operators have observed motivated reporters skip in-bot escalation and go directly to platform Report. The spec assumes:

> **Every published entry will be reported to Telegram by a hostile party. The published artefact must survive a T&S review on its own merits.**

The community-protective function — *flagging who is not trustworthy* — must continue to work, but cannot rely on a public artefact that exposes a named target to a "this post is about me" report claim. **Negative signal becomes private and persistent; the visible surface is a derived `Caution` status on the target's profile, not a feed entry.**

## 2. Goals

1. **No public NEG artefact.** A NEG submission writes a permanent DB record but produces zero group posts, zero @-mentions of the target in any feed surface, and zero outbound DMs to anyone other than the submitter's own confirmation.
2. **Trust signal still flows.** A member querying `/profile @x` reliably learns whether the community has flagged caution, has frozen, or has nothing to say.
3. **Smallest diff that solves it.** One column add. One publish-path branch. One profile-status clause. One copy pass. No new commands, no new tables, no aggregation logic, no background jobs, no DM-broadcasts.
4. **Permanent NEGs.** A NEG record stays until an admin clears it via existing `/remove_entry`. No time-decay, no expiry, no automatic withdrawal.
5. **Hold the no-free-text-public invariant.** The single new free-text field (the optional admin-only note on a NEG) is never rendered to any non-admin surface.

## 3. Non-goals

- Per-user rate limits beyond the existing 72h per-target cooldown.
- A user-facing `/report`, `/withdraw`, or `/dispute` command.
- Aggregation thresholds for caution (`≥N withdrawals in 90d` etc.). One NEG triggers caution. Volume is low; admin can clear on-demand.
- DM broadcast to past vouchers when a target is frozen — friend-of-frozen is a vendetta-creation surface in itself; deliberately omitted.
- Time-decay on NEG records. NEGs are permanent unless an admin removes them.
- Migration of existing published NEG posts. Operators may `/remove_entry` historical NEG posts manually if desired.
- Channel + linked-discussion-group migration (deferred to a future spec; this design is forward-compatible with that migration).
- Renaming `vouch_entries` table or `result` column. Internal identifiers stay; public-facing copy is the only thing that shifts.
- Outbound runtime regex moderation of free-text content. There is no member-controlled free-text public surface in this design; a runtime lexicon gate has no consumer until/unless member chat returns.

## 4. Design

### 4.1. NEG submissions become private records

The DM flow is unchanged through the `Confirm` step. After confirm, the publish path branches on `result`:

- `result === "positive"` or `result === "mixed"` → publish to group as today (with `protect_content: true`, see §4.2).
- `result === "negative"` → **skip the `sendTelegramMessage` call entirely.** Mark the entry `published` in DB with `published_message_id = NULL`. Send the reviewer a single confirmation DM: *"Your concern about @x has been recorded. Admins will see it; the wider group will not."*

The DB row is permanent. It is queryable via `/lookup @x` (admin) and contributes to the `Caution` status visible via `/profile @x` (member-visible).

**Code:**
- `src/core/archivePublishing.ts` — branch in `publishArchiveEntryRecord`. Reuses existing `markArchiveEntryPublishing` → `setArchiveEntryStatus("published")` → `setArchiveEntryPublishedMessageId(null)` sequence; no new state machine.
- No schema change for this part. Existing `published_message_id INT NULL` column carries the signal.

### 4.2. Forward protection on every published entry

Every `sendTelegramMessage` for a published archive entry sets `protect_content: true`. Belt-and-braces with the supergroup-level "Restrict saving content" setting; per-message `protect_content` is independent of that toggle and is what a T&S reviewer sees as a property of the message itself.

**Code:**
- `src/core/tools/telegramTools.ts` — extend `sendTelegramMessage` and `buildTelegramSendMessageParams` to accept `protectContent?: boolean` and forward as `protect_content`.
- `src/core/archivePublishing.ts` — pass `protectContent: true` in the publish call.

### 4.3. Optional admin-only note on NEG submissions

Reviewers submitting a NEG may add a short context note. The note is plain text, ≤240 characters, **visible to admins only via `/lookup @x`**, never rendered to any member-visible surface.

**Flow:**
- After tag selection in a NEG draft, before the preview, the bot offers: *"Optional: add a short note for admins (240 chars max). Send the note now, or tap **Skip**."*
- If the reviewer sends a text message, store on the draft. If they tap Skip, store `null`.
- Preview shows the note back to the reviewer with a label *"Admin-only note: …"* so they understand the visibility rule.
- On confirm, persist the note on the entry row.

**Code:**
- `src/core/archive.ts` — extend `DRAFT_STEPS` with `awaiting_admin_note`. Add helper to validate the note (length, control chars).
- `src/core/storage/schema.ts` and `migrations/<n>_add_private_note.sql` — add `private_note TEXT NULL` to `vouch_entries`.
- `src/core/archiveStore.ts` — extend create-entry / get-entry to round-trip `private_note`.
- `src/telegramBot.ts` — wire the `awaiting_admin_note` step into the existing draft-state handler.
- `src/core/archive.ts` — `buildLookupText` (admin-only path) renders the note when present; `buildProfileText` (member-visible) does not.

### 4.4. `Caution` status on `/profile @x`

`/profile @x` already exists. Its status line currently reads *"Status: Active"* or *"Status: Frozen — <reason>"*. Add a third state:

- `Frozen` (existing — admin action) — wins over everything.
- `Caution` (new) — present whenever there is any `vouch_entries` row with `target_username = @x`, `result = 'negative'`, `status = 'published'`, `published_message_id IS NULL`. (The combination uniquely identifies a private NEG record.)
- `Active` (existing — has at least one POS/MIX) — when no NEG and not frozen.
- `New` (existing — no entries at all).

The member-visible `/profile @x` text shows the Status word and nothing else about the NEG — no count, no IDs, no reviewer names, no notes.

The admin `/lookup @x` already lists every entry; NEG entries appear there with the `private_note` rendered.

**Code:**
- `src/core/archiveStore.ts` — `getProfileStats` (already exists, used by `buildProfileText`) extended to include `negativePrivateCount: number`.
- `src/core/archive.ts` — `fmtStatusLine` accepts an additional `hasCaution: boolean`; returns the priority-ordered status string.

### 4.5. Caution clears when admin removes the NEG

No new admin command. The existing `/remove_entry <id>` already transitions an entry to `removed` and is audited. When the last `negative` `published`+`null-message` row for a target is removed, `Caution` automatically goes away because it is a derived state computed at query time, not a stored flag.

If admin wants to keep the audit trail but suppress the caution, `/remove_entry` is the path. (Soft-delete is fine; the row is kept with `status = 'removed'`, which falls outside the Caution predicate.)

### 4.6. Anti-impersonation deny-list at target validation

Reject target usernames that match Telegram-reserved or bot-impersonating handles, **plus** marketplace-substring patterns derived from the QA-export lexicon scan.

**Two layers:**
- **Reserved handles** — exact-match Set: `telegram`, `spambot`, `botfather`, `notoscam`, `replies`, `gif`, plus the bot's own username (resolved from `process.env.TELEGRAM_BOT_USERNAME`, cached).
- **Marketplace substrings** — case-insensitive substring check against the normalised username. The substring list is derived from the QA export and lives as a constant in `archive.ts`. ~40 substrings: `scammer`, `vendor`, `plug`, `gear`, `seller`, `dealer`, `_4sale`, `coke`, `meth`, `weed`, `bud`, `kush`, `oxy`, `xan`, `mdma`, `molly`, `shrooms`, `lsd`, `acid`, `tabs`, `fent`, `supply`, `legit_seller`, `vouched_vendor`, etc. The full list is shipped in code; `docs/runbook/opsec.md` carries the rationale.

Either match rejects the target with the same generic message: *"That handle can't be a vouch subject."* No diagnostic about which list matched (avoids giving an attacker a Boolean oracle).

**Code:**
- `src/core/archive.ts` — `RESERVED_TARGET_USERNAMES: ReadonlySet<string>`, `MARKETPLACE_USERNAME_SUBSTRINGS: ReadonlyArray<string>`, `isReservedTarget(username): boolean`.
- `src/telegramBot.ts` — call `isReservedTarget` after `normalizeUsername`, alongside the existing self-vouch / frozen-profile checks.

### 4.7. Expose `/profile @target` to non-admins in group context

Today `/profile` in DM is open; `/profile` in group is admin-gated (`src/telegramBot.ts:1198–1217`). Drop the admin gate so any member can `/profile @x` in the group and see the structured trust card with Status. This is the primary read path for the new Caution signal.

The existing `recordAdminAction` audit call stays, with `denied: false`, so member-side profile queries are visible to admins as a soft heatmap of who's checking whom.

**Code:** remove the `isAdmin` gate from the group-context `/profile` handler. Keep the audit call.

### 4.8. Freeze reason becomes an admin-template enum

`/freeze @x <reason>` currently accepts free-text. Free-text reasons are an unnecessary risk surface — a reason like *"scammer who took my $500"* is a reportable claim a hostile target's friend could escalate. Replace with a fixed enum:

- `unmet_commitments`
- `community_concerns`
- `policy_violation`
- `at_member_request`
- `under_review`

The freeze command takes `/freeze @x <enum-key>`. The profile renders the human-readable label (`"unmet commitments"` etc.). Free-text is not accepted; the enum is the entire vocabulary.

**Code:**
- `src/core/archive.ts` — `FREEZE_REASONS` constant, `FREEZE_REASON_LABELS` map, `isFreezeReason` predicate.
- `src/telegramBot.ts` — `/freeze` handler validates the enum, rejects free-text with the list.
- `src/core/storage/schema.ts` — `freeze_reason` column already exists as text; constrain via app-level validation rather than a DB CHECK constraint to keep the migration light.

### 4.9. Vocabulary cleanse — minimal, copy-only

Member-facing copy shifts from commerce-coded language to social/community language. Internal identifiers (`vouch_entries`, `result='negative'`, `EntryResult` type, `POS/MIX/NEG` prefix constants) stay unchanged — no DB migration, no symbol churn.

**Public-facing swaps:**

| Surface | From | To |
|---|---|---|
| NEG submission flow copy | "Negative" | "Concern" |
| Bot description (`buildBotDescriptionText`) | mentions of "businesses" / "service experiences" | "community vouches between members who know each other" |
| Welcome / pinned guide (`buildWelcomeText`, `buildPinnedGuideText`) | references to "vouch hub" | unchanged — "vouch" is preserved as the product noun, social-flavoured in this context |
| Group launcher button | "Submit Vouch" | unchanged |
| `rulesLine()` | one-line | expanded block, see §4.10 |

The cleanse is deliberately small. The product is a "vouch hub for a private community"; that framing already reads more social than commercial. The single cosmetic change inside the DM flow is `Negative → Concern`, which matches how the new private-NEG behavior reads to the reviewer.

The four V3-locked text builders (`buildWelcomeText`, `buildPinnedGuideText`, `buildBotDescriptionText`, `buildBotShortDescription`) require their tests in `archiveUx.test.ts` updated in the same commit. This spec is the spec change that authorises that drift.

### 4.10. Expanded `rulesLine()` block

Replace the single-line `rulesLine()` with a multi-line block, used by `buildWelcomeText`, `buildPinnedGuideText`, and `buildBotDescriptionText`:

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

## 5. OPSEC runbook appendix

`docs/runbook/opsec.md` gains a new short section after §6 (member-velocity response):

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

## 6. Architecture

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `archive.ts` text builders | Render every public string + new attestation + rules block | Entry / draft data | HTML strings |
| `archive.ts` validators | `isReservedTarget`, `isFreezeReason`, marketplace-substring check | Username / reason | Boolean |
| `archivePublishing.ts` | Branch on NEG: skip publish, mark with null `published_message_id` | Entry row | message_id or null |
| `archiveStore.ts` | Round-trip `private_note`; expose `negativePrivateCount` | Entry id / target | DB rows |
| Existing `/freeze`, `/remove_entry`, `/profile`, `/lookup` handlers in `telegramBot.ts` | Same as today plus enum reason and removed admin gate on `/profile` | Command + args | Replies |

No new units. No new commands. No new tables. One new column. One new draft step. One new derived field.

## 7. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`. New tests (append to `package.json` `test` script):
   - `src/core/reservedTargets.test.ts` — `isReservedTarget` for each list.
   - `src/core/freezeReason.test.ts` — `isFreezeReason` and label rendering.
   - `src/core/privateNeg.test.ts` — submitting a NEG produces `published_message_id = null`, `private_note` round-trips, no `sendTelegramMessage` call (mock the API).
   - `src/core/profileCaution.test.ts` — `/profile @x` returns Caution when an active private NEG exists; clears when `/remove_entry` is run.
   - `src/core/archiveUx.test.ts` — update the four V3-locked-copy tests for new wording. Add: rules block contents, attestation line in preview, "Concern" wording for NEG flow.
2. **End-to-end (manual):**
   - **Forward protection:** publish a POS; long-press the group post; Forward and Save are absent.
   - **Reserved targets:** attempt `@telegram`, `@<botUsername>`, `@scammer_test`, `@coke_supply` — all rejected with the same generic message.
   - **NEG private path:** submit a NEG; no group post appears; reviewer sees the confirmation DM; `/lookup @target` shows the entry with `private_note`; `/profile @target` (in group, as a non-admin) shows `Status: Caution`; member sees Status word only.
   - **Caution clears:** `/remove_entry <id>` on the NEG; `/profile @target` returns to `Active` (or `New` if no other entries).
   - **Freeze enum:** `/freeze @x community_concerns` succeeds; `/freeze @x scammer_who_took_500` is rejected with the enum list.
   - **Member `/profile`:** non-admin in group runs `/profile @x` and gets the trust card. `recordAdminAction` audit row created with `denied: false`.
   - **Attestation + rules:** preview shows the attestation line; pinned guide and bot description show the expanded rules block.
3. **Idempotency regression:** replay a webhook with a known `update_id`; `processedTelegramUpdates` continues to short-circuit.

## 8. Risks / accepted tradeoffs

- **Single-vendetta NEG is enough to flip Caution.** Mitigation: admins can clear via `/remove_entry`. Accepted because NEG volume is low and admin involvement is on-demand only — no proactive queue. The cost of a malicious NEG is bounded (one Caution status word, no public artefact, no DM to anyone) and reversible.
- **Subject can see their own Caution.** They cannot see who filed it. The `private_note` is admin-only. Accepted; minimum information disclosure.
- **Frozen status is visible in profile.** A frozen target's friend may notice and be annoyed. **No bot-initiated DM** reaches them, so there is no bot-action artefact to point a Report at — they would have to compose a Report against a profile-status word, which Telegram's reporting flow does not directly support. Accepted.
- **Admin-template freeze reasons reduce expressiveness.** Five options cover the cases that have come up. Free-text reasons can still be added in `private_note` on a related entry if admins want richer audit context.
- **Existing legacy NEG posts in the group feed are not migrated.** Out of scope for this spec. Operators can `/remove_entry <id>` historical NEGs manually.

## 9. Out of scope (explicit)

- Per-user rate limits beyond the existing 72h per-target cooldown.
- `/withdraw`, `/dispute`, `/report` member-side commands.
- `/top` leaderboard, `/search <tag>`, weekly digest, repost / share features.
- Aggregation thresholds for caution.
- Time-decay or expiry on NEG records.
- DM broadcast to past vouchers when a target is frozen.
- Channel + linked-discussion-group migration.
- Runtime regex moderation of free-text content (no consumer in this design).
- Rename of `vouch_entries` table or `result` column.
- Bot copy in admin-only commands.

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
- **POS/MIX submission DM flow** publishes to the **vouch hub**. The launcher's `targetGroupChatId` (already on the draft schema) is preserved for the round-trip back to the originating chat for confirmation, but the **publication target** is the chat with role `vouch_hub`.
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
