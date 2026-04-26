# Chat moderation v3 — set-and-forget edition

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1) and `docs/runbook/opsec.md` §6a (lexicon reference)
**Revision:** v3 supersedes the v2 sketch in earlier git history. v3 trims a new DB table, a new JSON file, and a new admin command in favour of deriving state from the existing `admin_audit_log`.

## 1. Context

VouchVault's host group is currently bot-only-post. We want to **enable member chat in any allowed group** without exposing the system to a deliberate self-incriminate-and-report attack:

> A hostile member joins, posts incriminating content (commerce-shape phrases, off-platform comm references, contact artefacts), then immediately reports their own post (or coordinates an accomplice report). Telegram's automated review sees the post + the report and tears the group down.

The countermeasure scans every member message on receipt, deletes anything matching a hardened lexicon, and applies a strikes ladder so a hostile actor exhausts the chat-attack vector within ≤3 messages. After three strikes their account is banned and they cannot post again.

This bot runs unattended on Railway. **The architecture must minimise moving parts** — every new table, JSON file, scheduled job, or admin command is another failure mode. v3 is designed for set-and-forget.

## 2. Goals

1. **Hostile post never settles.** Within sub-second of webhook receipt, any message matching the lexicon is deleted. The visible group state stays clean for any subsequent T&S review.
2. **Repeat attackers exhaust quickly.** Three strikes within 30 days = ban. A hostile account gets one shot per identity.
3. **No new tables, no new commands, no new state stores.** Strike count derives from the existing `admin_audit_log` (each hit already needs an audit row; the count is `SELECT count(*) WHERE …`).
4. **No JSON files.** Lexicon is a single TypeScript constant. Updating means editing one array and pushing — Railway auto-deploys.
5. **One new module total.** `src/core/chatModeration.ts` carries the lexicon, normaliser, scanner, ladder, and orchestration. Single test file alongside.
6. **Multi-group by default.** Same handler for every chat in `TELEGRAM_ALLOWED_CHAT_IDS`.

## 3. Non-goals

- New database tables. (v2 had `chat_strikes`; v3 does not.)
- New admin commands. (v2 had `/clear_strikes`; v3 does not — 30-day decay is automatic, Telegram-native unban handles override.)
- New JSON or config files. (v2 had `data/moderation_lexicon.json`; v3 keeps it inline.)
- Bot-relay posting (Approach B from earlier brainstorm). Captured in §10 as the upgrade path; not built.
- Cold-start period for new joiners. Telegram's slow-mode + the strikes ladder cover this.
- Per-group rule sets.
- ML / external moderation APIs.
- Admin review queue UI.
- Image content moderation. Captions are scanned; image bytes are not.
- Edit-history scrubbing beyond first re-scan.
- Hot-reload of the lexicon at runtime.
- Drug-name vocabulary blocking. The empirical scan in §6a showed Suncoast uses these ambiently — false-positive risk too high.

## 4. Design

### 4.1. Lexicon — TS constants in the module

`src/core/chatModeration.ts` exports two constants. No JSON parsing, no boot-time loader, no version field, no schema validation.

**`PHRASES`** — empirically derived from the four chat exports (~24k messages). Each entry appeared 0–4 times in 2,565 Suncoast messages but dozens in 9,713 abuse-corpus messages. ~36 entries, flat array, alphabetised:

```ts
const PHRASES: ReadonlyArray<string> = [
  "briar", "buying", "come thru", "dm me", "drop off", "f2f",
  "front", "got some", "got the", "hit me up", "hmu", "holding",
  "how much", "in stock", "inbox me", "meet up", "owe me", "p2p",
  "pickup", "pm me", "selling", "session", "signal me", "sold",
  "stocked", "threema", "tic", "tick", "what for", "what's the price",
  "what u sell", "wickr", "wickr me", "wtb", "wts", "wtt",
];
```

**`REGEX_PATTERNS`** — format-perfect artefacts. 4 entries:

```ts
const REGEX_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "tme_invite",    re: /t\.me\/\+|t\.me\/joinchat|telegram\.me\/\+/i },
  { name: "phone",         re: /\b\+?\d[\d\s\-]{7,}\d\b/ },
  { name: "crypto_wallet", re: /\b(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})\b/ },
  { name: "email",         re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
];
```

Adding a new phrase = edit the array, push. Railway redeploys, the new container has the new lexicon. No migration, no config reload, no admin command.

### 4.2. Normaliser

Before phrase matching, the message text is normalised:

1. Lowercase.
2. Decode common leet substitutions: `0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `8→b`, `@→a`, `$→s`.
3. Collapse runs of non-alphanumeric characters to a single space.
4. Trim and collapse whitespace.

Phrases are matched on the normalised text using space-padded `includes()` for word-boundary safety. Regex patterns are matched on the **original** (non-normalised) text — format-perfect matching is the point.

### 4.3. Strike count — derived from `admin_audit_log`, no new table

Every moderation hit writes one row to `admin_audit_log` with `command='chat_moderation:delete'` (existing infra; we already write these for the v1.1 vendetta-resistant work).

Strike count for a `(chat_id, telegram_id)` pair is then a single SQL query at decision time:

```sql
SELECT count(*)
FROM admin_audit_log
WHERE command = 'chat_moderation:delete'
  AND target_chat_id = $1
  AND admin_telegram_id = $2
  AND created_at > now() - interval '30 days'
  AND denied = false;
```

(`admin_telegram_id` carries the offender's id for moderation rows — the column-overload pattern documented in v1.1 §4.7.)

The count returned **includes the current hit** (we record the audit row first, then count). So:

- 1st hit in 30d → count=1 → warn
- 2nd hit in 30d → count=2 → mute
- 3rd hit in 30d → count=3 → ban

**Decay is automatic and free.** A user with 2 hits 31 days ago whose 3rd hit lands today queries 1 row in the 30-day window → count=1 → warn. The query window is the decay logic.

**No reset command needed.** Admins wanting to manually clear strikes can:
- `DELETE FROM admin_audit_log WHERE …` via psql (rare, documented in OPSEC §6b)
- Wait 30 days
- Use Telegram-native unmute/unban

### 4.4. Strikes ladder — three steps, automatic

| Strike count after this hit | Action |
|---|---|
| 1 | `deleteMessage` + DM the offender once: *"Your message in `<group>` was removed. Two more removals in 30 days will mute you for 24 hours."* |
| 2 | `deleteMessage` + `restrictChatMember(can_send_messages: false)` for **24 hours** + DM: *"Second removal in 30 days. You are muted in `<group>` for 24 hours."* |
| 3+ | `deleteMessage` + `banChatMember` (permanent until admin unbans) + DM: *"Third removal in 30 days. You have been removed from `<group>`. Contact an admin if you believe this is an error."* |

**Admins are exempt.** If the sender's `telegram_id` is in the configured admin list, the audit row is written with `reason` suffixed `(admin_exempt)` and no enforcement runs.

### 4.5. What gets scanned

- `message.text` from `message` updates in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`.
- `message.caption` from photo / video / document / animation messages in those chats.
- `edited_message.text` and `edited_message.caption` — re-scan on edit.

DMs to the bot are **not scanned** — the lexicon is for public chat. The vouch DM flow has its own validators per v1.1.

### 4.6. Multi-group behaviour

Every chat ID in `TELEGRAM_ALLOWED_CHAT_IDS` is moderated by the same handler. Strikes are **per-chat** (the audit-log query filters on `target_chat_id`), so one group's behaviour doesn't ban a user from another group.

### 4.7. Boot-time admin-rights visibility

On startup, the bot logs (info level) for each chat in `TELEGRAM_ALLOWED_CHAT_IDS`: *"Bot admin status in `<chat>`: `<status>`"* via `getChatMember(chat, bot_id)`. If the bot lacks admin rights in any allowed chat, this is the only signal — moderation will silently fail to delete/restrict/ban there. Operator sees the log, fixes the permissions in Telegram.

This is a one-line `info` log per chat at boot. No retry loop, no failure path; if the call itself fails, log a warning and continue.

## 5. Architecture

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `src/core/chatModeration.ts` | Lexicon constants, `normalize`, `findHits`, `decideStrikeAction`, `runChatModeration` | message + bot context | `{ deleted: boolean }` + side effects |
| `src/core/chatModeration.test.ts` | Unit tests for everything in the above (no DB; mock the side-effect calls) | inputs | pass/fail |
| `src/core/tools/telegramTools.ts` | Add `restrictChatMember`, `banChatMember`, `getChatMember` wrappers (mirror existing `deleteTelegramMessage`) | chat_id + user_id | API result |
| `src/telegramBot.ts` | Call `runChatModeration` first in group-message and edited-message branches; emit boot-time admin-rights log | webhook update | side effects |

**Two new files. One existing file extended. One existing file modified.** No migration. No JSON. No new admin command. No new database table.

## 6. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`.
   - One new test file: `src/core/chatModeration.test.ts`. Append to `package.json` `test` script.
   - Tests cover: normaliser (leet, punctuation, mixed-case), `findHits` (phrase + regex hits and misses, word-boundary safety), `decideStrikeAction` (count → action mapping with admin-exempt branch).
   - Strike-count-from-audit-log is integration-tested manually (no DB in unit tests); a small fake audit-log query function is dependency-injected for the unit test of `runChatModeration`.
2. **End-to-end (manual, post-deploy):**
   - Set group to "members can post text" in Telegram.
   - Member posts "pm me about this" → bot deletes within ~1s, member receives warning DM, audit row visible in SQL.
   - Same member posts "selling 2g" within 30 days → bot deletes, member muted 24h.
   - Same member, after mute auto-expires, posts "wickr me" within 30 days → bot deletes, member banned.
   - Member with one hit, no further hits for 31 days, posts again → warn (audit window dropped the old hit).
   - Admin posts the same content → no enforcement; audit row written with `(admin_exempt)` suffix.
   - Edit a clean message into a dirty one → bot deletes the edit; strike applies.
   - Caption on a photo with a phone number → bot deletes; strike applies.
   - Boot logs show admin status for every allowed chat.

## 7. Risks / accepted tradeoffs

- **Sub-second window.** Hit-and-run report-the-bot inside webhook latency leaves a brief artefact. Same as v2; same trade. Approach B closes it; not built.
- **No drug-name blocking.** Determined attackers using only drug names (no commerce verbs) get through. Empirically, drug names alone don't differentiate.
- **30-day window** allows a patient attacker to space attacks 31 days apart. Acceptable; per-attack cost of warn + delete is enough to be visibly unproductive, and admins watching the audit log can manually ban a recidivist via Telegram-native UI.
- **Per-chat strike independence.** Multi-group spammer hits each group separately. Acceptable.
- **Lexicon staleness.** Updating means editing the TS constant + pushing. Railway auto-deploys. The lexicon is mostly stable — commerce-shape phrases don't evolve quickly.
- **DM delivery to offenders may fail** if they've never DM'd the bot or have blocked it. The delete + mute/ban still applies; the warning DM is best-effort. Logged at info level.
- **`admin_audit_log.admin_telegram_id` overload.** Carries the offender's id for moderation rows. Documented in v1.1 §4.7. A view filter on `command LIKE 'chat_moderation:%'` separates moderation rows from real admin actions when admins want clean queries.
- **Bot lacks admin rights in a chat** → moderation silently fails. Mitigated by the boot-time log (§4.7); operator notices on the next deploy.
- **Audit-log query on every member message.** One small SELECT against an indexed table. Negligible overhead; the `admin_audit_log` table doesn't grow large enough in this volume to matter. If it ever does, the existing `created_at` index + a future archival job handles it.

## 8. Out of scope (explicit)

- New `chat_strikes` table.
- `data/moderation_lexicon.json` file.
- `/clear_strikes` admin command.
- Bot-relay posting (Approach B).
- Cold-start period for new joiners.
- Per-chat rule sets.
- ML / external moderation APIs.
- Admin review queue UI.
- Image / voice content moderation.
- Hot-reload of the lexicon.
- Cross-chat strike aggregation.
- Drug-name vocabulary blocking.
- Strike-action customisation (durations, count thresholds).

## 9. Forward compatibility

This spec inherits the multi-group contract from v1.1 §10:
- Handler runs on every chat in `TELEGRAM_ALLOWED_CHAT_IDS`. Adding a chat is one env-var edit.
- No `chat_role` differentiation needed.
- When the future spec lands the role-mapping concept, this moderation is unchanged.
- If/when Approach B (bot-relay) is needed, it sits *in front of* this moderation: relay accepts message → calls `findHits` → publishes if clean. Same lexicon, no rework.

## 10. Approach B as the upgrade path (deferred)

If 30 days of running v3 shows successful hit-and-run takedowns despite the lexicon + strikes ladder, the upgrade is bot-relay (member submits via DM → bot scans → bot posts on behalf if clean). The cost is a new launcher → DM flow → posting pipeline. Build only if v3 demonstrably fails.
