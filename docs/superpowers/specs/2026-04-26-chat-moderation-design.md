# Chat moderation v5 — one-strike-ban edition

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1) and `docs/runbook/opsec.md` §6a (lexicon reference)
**Revision:** v5 supersedes v4. v5 deletes the strikes ladder entirely. v4's 3-strikes-with-30-day-decay was tracking infrastructure pretending to be fairness — in practice it gave hostile actors three free attempts and burdened the operator with audit-query state forever. v5 collapses to **one step: lexicon hit → delete + ban**. The empirical lexicon fires near-zero false positives in the target community; legitimate members who trip it DM an admin and get unbanned via Telegram-native UI. Hostile actors burn one account per attempt and are gone.

v5 net diff vs v4: drops `decideStrikeAction`, `getRecentStrikeCount`, `STRIKE_DECAY_DAYS`, `MUTE_DURATION_HOURS`, the `restrictChatMember` Telegram tool wrapper, and ~80 lines of orchestration. v5 keeps everything that mattered: the empirically-derived lexicon, the leet-decoding normaliser, bot/admin/inline-bot exemptions, audit-row insertion, edit-message scanning, multi-group support, and the boot-time admin-rights log.

## 1. Context

VouchVault's host group is currently bot-only-post. We want to **enable member chat in any allowed group** without exposing the system to a deliberate self-incriminate-and-report attack:

> A hostile member joins, posts incriminating content, then immediately reports their own post (or coordinates an accomplice report). Telegram's automated review sees the post + the report and tears the group down.

The countermeasure scans every member message on receipt, deletes anything matching a hardened lexicon, and applies a strikes ladder so a hostile actor exhausts the chat-attack vector within ≤3 messages.

The bot runs unattended on Railway. **The architecture must minimise moving parts.**

## 2. Goals

1. **Hostile post never settles.** Deleted within sub-second of webhook receipt.
2. **Repeat attackers exhaust quickly.** Three strikes within 30 days = ban.
3. **No new tables.** Strike count derives from existing `admin_audit_log` via a 30-day SQL window.
4. **No JSON files.** Lexicon is a TS constant.
5. **No new admin commands.** Decay is automatic; admins use Telegram-native unmute/unban for overrides.
6. **One new module + one test file total.** Plus three new Telegram tool wrappers, plus boot-time admin-rights logging.
7. **Multi-group by default.**
8. **Bot itself is exempt.** Bot's own messages and inline-bot relays are skipped.
9. **DB hiccups are non-fatal.** Transient query failures fail-safe to "delete-only, no enforcement" — the audit row recorded next time captures the strike.

## 3. Non-goals

- New database tables.
- New admin commands.
- New JSON or config files.
- Bot-relay posting (Approach B). Captured in §10 as the upgrade path.
- Cold-start period for new joiners.
- Per-group rule sets.
- ML / external moderation APIs.
- Admin review queue UI.
- Image/voice content moderation. Captions are scanned; image bytes are not.
- Hot-reload of the lexicon.
- Drug-name vocabulary blocking. The empirical scan in §6a showed Suncoast uses these ambiently.
- Edit-history scrubbing beyond first re-scan.
- Forum-topic-aware behaviour. Deletes work per-message; threads are transparent.
- Channel-post moderation (`channel_post` updates). Our chats are supergroups; channels not in scope.

## 4. Design

### 4.1. Lexicon — TS constants

`src/core/chatModeration.ts` exports two constants. No JSON parsing, no boot-time loader.

**`PHRASES`** — empirically derived from four chat exports (~24k messages). Each entry appeared 0–4 times in 2,565 Suncoast messages but dozens in the abuse corpus. ~36 entries, alphabetised:

```ts
export const PHRASES: ReadonlyArray<string> = [
  "briar", "buying", "come thru", "dm me", "drop off", "f2f",
  "front", "got some", "got the", "hit me up", "hmu", "holding",
  "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
  "pickup", "pm me", "selling", "session", "signal me", "sold",
  "stocked", "threema", "tic", "tick", "what for", "what's the price",
  "what u sell", "wickr", "wickr me", "wtb", "wts", "wtt",
];
```

**`REGEX_PATTERNS`** — format-perfect artefacts (4 entries):

```ts
export const REGEX_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "tme_invite",    re: /t\.me\/\+|t\.me\/joinchat|telegram\.me\/\+/i },
  { name: "phone",         re: /\b\+?\d[\d\s\-]{7,}\d\b/ },
  { name: "crypto_wallet", re: /\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b/ },
  { name: "email",         re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
];
```

**Drug names are excluded by design.** A test (§6) asserts none of the empirically-known false-positive vocabulary (`bud / fire / k / mdma / pingas / caps / weed / kush / molly / xan / tabs / acid`) leaks into `PHRASES`. The list is alphabetised; another test asserts that, to keep diffs reviewable.

### 4.2. Normaliser

Before phrase matching, the message text is normalised:

1. Lowercase.
2. Decode common leet substitutions: `0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `8→b`, `@→a`, `$→s`.
3. Collapse runs of non-alphanumeric characters to a single space.
4. Trim and collapse whitespace.

Phrases match on the normalised text using space-padded `includes()` for word-boundary safety. Regex patterns match on the **original** (non-normalised) text — format-perfect matching is the point.

### 4.3. Strike count — derived from `admin_audit_log`, no new table

Every moderation hit writes one row to `admin_audit_log` with `command='chat_moderation:delete'` via the existing `recordAdminAction` helper (no parallel insert path).

Strike count for a `(chat_id, telegram_id)` pair:

```sql
SELECT count(*)
FROM admin_audit_log
WHERE command = 'chat_moderation:delete'
  AND target_chat_id = $1
  AND admin_telegram_id = $2
  AND created_at > now() - interval '30 days'
  AND denied = false
  AND (reason IS NULL OR reason NOT LIKE '%(admin_exempt)%');
```

(`admin_telegram_id` carries the offender's id for moderation rows — the column-overload pattern documented in v1.1 §4.7. The `reason NOT LIKE '%(admin_exempt)%'` clause excludes admin-exempt rows from contributing to anyone's count, even though admins shouldn't accumulate counts at all.)

The count returned **includes the just-recorded hit** because the audit row insert is awaited before the count query.

**DB error handling:** the count query is wrapped in try/catch. On failure, the handler logs warn, **skips enforcement** (no mute/ban), and returns. The delete already happened (it's the action least likely to fail and the most important to land). The next hit will count this one's audit row plus the new one, restoring the ladder.

**No reset command.** Manual reset is documented in OPSEC §6b: psql `DELETE FROM admin_audit_log WHERE command='chat_moderation:delete' AND admin_telegram_id=<id> AND target_chat_id=<chat>`.

### 4.4. Strikes ladder

| Strike count after this hit | Action |
|---|---|
| 1 | `deleteMessage` + DM the offender once: warn |
| 2 | `deleteMessage` + `restrictChatMember(can_send_messages: false, until_date: now+24h)` + DM: 24h mute |
| 3+ | `deleteMessage` + `banChatMember` (permanent) + DM: ban |

**Pure decision function** `decideStrikeAction(count: number): StrikeAction` is the single source of truth for the count→action mapping. Unit-tested in isolation.

**Admin exemption:** if `isAdmin(message.from?.id)` returns true, the audit row is written with reason suffixed `(admin_exempt)` and **enforcement is skipped**. (Admins don't accumulate counts because their rows are excluded by the SQL filter in §4.3.)

**Bot exemption:** if `message.from?.is_bot === true` OR `message.via_bot` is set, **moderation is skipped entirely** (no audit row, no delete). This prevents the bot from moderating its own vouch posts and prevents inline-bot relays from being treated as member content.

### 4.5. What gets scanned

- `message.text` from `message` updates in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`.
- `message.caption` from photo / video / document / animation messages.
- `edited_message.text` and `edited_message.caption`.

Text and caption are joined with `\n` for scanning. Phrases that would straddle the join are vanishingly unlikely (phrases are ≤4 words). Acceptable.

DMs to the bot are **not scanned** — the lexicon is for public chat. The vouch DM flow has its own validators per v1.1.

`channel_post` updates are not scanned — this bot operates on supergroups, not channels. Forum topics work transparently — `deleteMessage` deletes the specific message regardless of `message_thread_id`.

### 4.6. Multi-group behaviour

Every chat ID in `TELEGRAM_ALLOWED_CHAT_IDS` is moderated by the same handler. Strikes are **per-chat** (audit-log query filters on `target_chat_id`).

### 4.7. Boot-time admin-rights visibility

Once at process startup, the bot calls `getChatMember(chat, bot_id)` for each chat in `TELEGRAM_ALLOWED_CHAT_IDS` and logs the bot's status (`administrator` / `creator` / `member` / etc.). If status is anything other than `administrator` or `creator`, log at `warn` level — moderation will silently fail in that chat.

**Fire-and-forget:** the admin-status check runs in a `void`-prefixed promise after webhook setup, so a slow/unreachable Telegram API does not block boot. Errors per chat log at `warn` and don't propagate.

**Location:** `src/server.ts` after the webhook is registered. The function `logBotAdminStatusForChats` is exported from `chatModeration.ts`.

### 4.8. Member-facing copy update

The welcome and pinned guide gain a chat-moderation block under the rules:

> **Chat moderation**
> Posts that look like buy/sell arrangements are auto-removed. Three removals in 30 days = ban.
> **Tap the bot below and send /start once** so the bot can DM you when one of your messages is auto-removed.

The deliberate-but-vague wording does not leak the lexicon to evaders. The /start instruction closes the **first-warning-DM-silent-fails** edge case discovered in simulation: Telegram blocks bot-initiated DMs to users who have never DM'd the bot. Without the /start prompt, a first-time offender sees their message vanish with no explanation; with it, they have a one-time path to enable warnings.

The `archiveUx.test.ts` V3-locked test assertions are updated in the same commit (per CLAUDE.md V3-lock policy).

### 4.9. Username-layer chat-phrase evasion

A vouch target's @username is published in the bot's vouch heading. If a member submits a vouch with target `@pm_me_now`, the published post contains the phrase `pm_me_now` which normalises to `pm me now`. Even though the bot's own posts are not moderated (they don't reach the bot via webhook), **a hostile reporter could screenshot the vouch and report it to Telegram with "the bot is publishing arrangement-shaped content"** — which is half true.

To close this, the v1.1 `MARKETPLACE_USERNAME_SUBSTRINGS` deny-list is extended with the chat-moderation phrase tokens that could plausibly appear in a username:

```
"pm_", "_pm", "selling", "_selling", "selling_",
"buying", "_buying", "buying_", "wickr", "wickr_",
"_wickr", "threema", "_threema", "wtb_", "_wtb",
"wts_", "_wts", "wtt_", "_wtt", "hmu_", "_hmu",
```

Adding these to the existing constant (no new module). The deny-list rejects targets at vouch submission time. Members can't vouch a username matching any of these substrings.

### 4.10. Bot-id belt-and-braces

In addition to `message.from?.is_bot === true`, the orchestration also checks `message.from?.id === botTelegramId` (the actual bot's id, looked up at boot via `getMe`). If for any reason the `is_bot` flag is missing on a message from the bot itself, the id check still skips moderation. The bot's id is passed into `runChatModeration` from the boot context — no per-message `getMe` call.

## 5. Architecture

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `src/core/chatModeration.ts` | Lexicon, normaliser, scanner, ladder decision, audit-derived count, orchestration, boot-time admin-status check | message + isAdmin + logger | `{ deleted: boolean }` + side effects |
| `src/core/chatModeration.test.ts` | Unit tests for `normalize`, `findHits`, `decideStrikeAction`, `PHRASES` shape | inputs | pass/fail |
| `src/core/tools/telegramTools.ts` | + `restrictChatMember`, `banChatMember`, `getChatMember` | chat_id + user_id | API result |
| `src/telegramBot.ts` | Call `runChatModeration` first in group + edited-message branches | webhook update | side effects |
| `src/server.ts` | Trigger `logBotAdminStatusForChats` after webhook setup (fire-and-forget) | boot | log lines |
| `src/core/archive.ts` | + chat-moderation line in welcome / pinned guide; updated by V3-locked spec authorisation | (config) | text |
| `src/core/archiveUx.test.ts` | V3-locked test updated to match new welcome/pinned wording | inputs | pass/fail |
| `package.json` | Append `chatModeration.test.ts` to `scripts.test` | (config) | (config) |
| `docs/runbook/opsec.md` | + §6b admin reference | (docs) | (docs) |
| `DEPLOY.md` | + §14 enablement | (docs) | (docs) |

**No migration. No new schema. No JSON. No new admin command.**

## 6. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`. New tests in one file (`chatModeration.test.ts`) covering:
   - Normaliser (lowercase, leet, punctuation collapse, whitespace).
   - `findHits` (literal phrase match, leet-decoded match, word-boundary safety, regex matches against original text, `tme_invite` / `phone` / `crypto_wallet` / `email`).
   - `decideStrikeAction` (1=warn, 2=mute, 3+=ban, 0 throws).
   - `PHRASES` shape: non-empty, all lowercase, alphabetised, contains no known-false-positive drug names.
   - `STRIKE_DECAY_DAYS === 30` and `MUTE_DURATION_HOURS === 24` (constants drift guard).
   - The orchestration `runChatModeration` is **not** unit-tested — it integrates DB + Telegram and is verified by the manual e2e checklist below.
2. **End-to-end (manual, post-deploy):**
   - Set group to "members can post text" + slow-mode 30s + restrict media in Telegram.
   - Member posts "pm me about this" → bot deletes within ~1s, member receives warning DM, audit row visible.
   - Same member posts "selling 2g" within 30 days → bot deletes, member muted 24h.
   - Same member, after mute auto-expires, posts "wickr me" within 30 days → bot deletes, member banned.
   - Member with one hit, no further hits for 31 days, posts again → warn (audit window dropped the old hit).
   - Admin posts the same content → no enforcement; audit row written with `(admin_exempt)` suffix.
   - Bot's own vouch posts are NOT moderated (bot self-skip).
   - Edit a clean message into a dirty one → bot deletes the edit; strike applies.
   - Caption on a photo with a phone number → bot deletes; strike applies.
   - Boot logs show admin status for every allowed chat. If bot lacks admin in any chat, a `warn` line appears.
   - Force a DB outage briefly: a member posts a hit, the count query fails — message is deleted, audit row was recorded, no enforcement runs. Next post by the same member counts both audit rows correctly.

## 7. Risks / accepted tradeoffs

- **Sub-second window** between post and delete. Same as v1–v3.
- **No drug-name blocking** — empirically false-positive prone in target community.
- **30-day decay window** allows patient attackers to space attacks. Per-attempt cost is enough to be visibly unproductive.
- **Per-chat strike independence** — multi-group spammer hits each group separately.
- **First DM to user fails** if they've never DM'd the bot (Telegram constraint: bot can't initiate). Mitigated by the /start instruction in the welcome / pinned guide (§4.8). For members who ignore that instruction, the delete + mute/ban still applies; only the warning DM is silently lost.
- **`admin_audit_log.admin_telegram_id` overload** — documented in v1.1 §4.7.
- **Bot lacks admin rights in a chat** → moderation silently fails. Boot log surfaces this; runtime changes (admin demotes the bot mid-session) are not detected until the next restart.
- **DB read failure during count query** → enforcement skipped for that hit; delete + audit still apply. Next hit catches up.
- **Lexicon update friction** — edit TS + push + Railway deploy. Operator is the developer, so this is normal flow.
- **Telegram API change to `getChatMember` / `restrictChatMember`** would break the tool wrappers. All API calls go through `callTelegramAPI` so the surface is small.
- **Edit-during-delete-window race.** A member could post a dirty message and edit it to clean before the bot's delete fires (~100–500ms window). The bot deletes the now-clean message. False-positive; member can re-post. Rare; accepted.
- **Concurrent-webhook double-mute race.** Two messages from the same user arriving simultaneously can both fire `restrictChatMember` if both audit-row inserts beat both count queries. The second restrict call is effectively a no-op (same end-time mute); member receives two mute DMs. Harmless; accepted.
- **Polls and stickers carrying text** are not scanned (no `text` or `caption` field on those message types). Group settings can disable poll posting; stickers are non-textual. Accepted gap.
- **Forwarded messages** are scanned the same as authored messages — a forward of "pm me" content from another chat counts as a hit. Member should not be forwarding marketplace content into the group; treat as a strike.

## 8. Out of scope (explicit)

- New `chat_strikes` table.
- `data/moderation_lexicon.json`.
- `/clear_strikes` admin command.
- Bot-relay posting.
- Cold-start period.
- Per-chat rules.
- ML / external APIs.
- Admin UI.
- Image/voice moderation.
- Hot-reload.
- Cross-chat strike aggregation.
- Drug-name vocabulary blocking.
- Strike-action customisation.
- Forum-topic-aware logic.
- Channel-post moderation.

## 9. Forward compatibility

This spec inherits v1.1 §10's multi-group contract:
- Handler runs on every chat in `TELEGRAM_ALLOWED_CHAT_IDS`.
- No `chat_role` differentiation needed.
- Future role-mapping spec leaves moderation untouched.
- Approach B (bot-relay) sits in front of this moderation if ever built — same lexicon, no rework.

## 10. Approach B — deferred upgrade path

If 30 days of running v4 shows successful hit-and-run takedowns despite the lexicon + strikes ladder, the upgrade is bot-relay (member submits via DM → bot scans → bot posts on behalf if clean). Build only if v4 demonstrably fails.

## 11. Considerations & gaps closed in static audit (v3 → v4 first pass)

Sixteen specific issues identified in a static review of v3:

1. **Bot self-skip.** §4.4 — `is_bot` and `via_bot` short-circuit moderation.
2. **Reuse `recordAdminAction`** instead of a parallel custom insert. §4.3 + §5.
3. **`isAdmin` type signature** matches existing `(id: number | null | undefined) => boolean`. §5.
4. **DB count-query error handling.** §4.3 — try/catch, fail-safe to delete-only.
5. **Boot-admin-rights check location** specified: `src/server.ts` after webhook registration, fire-and-forget. §4.7.
6. **Drop runChatModeration unit test.** Pure helpers tested; orchestration via manual e2e. §6.
7. **Welcome/pinned chat-moderation line** added. §4.8.
8. **First-DM-fails caveat** documented. §7.
9. **Drug-name guard test** added. §6.
10. **V3-locked test sync** for welcome/pinned changes. §4.8 + §5.
11. **Forum topics + channel posts** explicitly out of scope. §4.5 + §3.
12. **`via_bot` skip.** §4.4.
13. **Admin-exempt count exclusion** via SQL `reason NOT LIKE '%(admin_exempt)%'`. §4.3.
14. **Boot check fire-and-forget** explicit. §4.7.
15. **Allowlist-check duplication** for edited_message accepted as small. §4.5.
16. **Text + caption join semantics** documented. §4.5.

## 12. Simulation-driven additions (v4 second pass — 20 user-journey walk-throughs)

After the static audit, six additional issues surfaced from imagining real members using the bot:

17. **First-warning DM is undeliverable** when a member has never `/start`-ed the bot. Telegram blocks bot-initiated DMs. Without this fix, first-time offenders see their messages vanish with zero context — they may keep trying and burn through the strikes ladder without ever knowing why. **Fix in §4.8**: welcome and pinned guide now instruct members to `/start` the bot once. Doesn't eliminate the gap (members may ignore the instruction) but materially reduces it.

18. **Username-layer chat-phrase evasion.** A member submits a vouch with target `@pm_me_now`. The bot publishes `<b>POS Vouch &gt; @pm_me_now</b>` to the group. The bot doesn't moderate its own posts (correct), but a hostile reporter screenshots the vouch and Reports it to Telegram alleging "the bot is publishing arrangement-shaped content." The phrase is in the bot's published artefact regardless of the chat-moderation layer. **Fix in §4.9**: extend `MARKETPLACE_USERNAME_SUBSTRINGS` (v1.1 deny-list) with the chat-moderation phrase tokens that could plausibly appear in usernames (`pm_`, `_pm`, `selling`, `wickr`, `wtb`, `wts`, etc.). Closes the evasion at the vouch-submission gate.

19. **Bot-id belt-and-braces.** `message.from?.is_bot` is the primary self-skip; if Telegram ever omits the `is_bot` flag on a malformed update or a future API change shifts the field, the orchestration also checks `message.from?.id === botTelegramId`. Bot id is passed into `runChatModeration` from boot context — no per-message API call. **Added in §4.10.**

20. **Edit-during-delete-window race** acknowledged as a rare false-positive. **Added to §7.**

21. **Concurrent-webhook double-mute race** acknowledged as harmless. **Added to §7.**

22. **Polls / stickers / forwards** behaviour explicitly documented. **§7.**
