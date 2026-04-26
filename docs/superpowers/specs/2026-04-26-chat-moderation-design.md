# Chat moderation v2 — auto-delete + strikes ladder

**Date:** 2026-04-26
**Audience:** maintainers
**Builds on:** `docs/superpowers/specs/2026-04-26-vendetta-resistant-posture-design.md` (v1.1) and `docs/runbook/opsec.md` §6a (lexicon reference)

## 1. Context

VouchVault's host group is currently bot-only-post: members cannot send messages. The vouch flow is unaffected by this design; it stays as-is.

We want to **enable member chat in any allowed group** without exposing the system to a deliberate self-incriminate-and-report attack:

> A hostile member joins, posts incriminating content (commerce-shape phrases, off-platform comm references, contact artefacts), then immediately reports their own post (or coordinates an accomplice report). Telegram's automated review sees the post + the report and tears the group down.

The countermeasure is **structural, not after-the-fact**: the bot scans every member message on receipt, deletes anything matching a hardened lexicon, and applies a strikes ladder so a hostile actor exhausts the chat-attack vector within ≤3 messages. After three strikes their account is banned and they cannot post again.

The lexicon is **empirically derived** from four chat exports (~24,000 messages across two communities) — peer-group "Queensland Approved" (drug-trade circuit, training data: shows the patterns abusers use) and "Suncoast Vouches" original + V3 (the operator's own communities, target-community baseline: shows what legitimate members type). Phrases that appear ≥10× more often in the abuse corpus than in Suncoast's normal chat are the high-precision discriminators (see §4.1).

## 2. Goals

1. **Hostile post never settles.** Within sub-second of webhook receipt, any message matching the lexicon is deleted. The visible group state stays clean for any subsequent T&S review.
2. **Repeat attackers exhaust quickly.** Three strikes within 30 days = ban. A hostile account gets one shot per identity; replacement accounts have their own friction (Telegram's account-age scoring).
3. **Multi-group by default.** The same handler applies to every chat in `TELEGRAM_ALLOWED_CHAT_IDS`. No per-chat configuration. Adding a new group is one env-var change.
4. **Smallest diff.** One new module, one new tiny table, one JSON data file, one new wrapper around `restrictChatMember` / `banChatMember`. ~150 LoC including tests. Set-and-forget.
5. **Lexicon as data.** Editable in `data/moderation_lexicon.json` without code changes; reloaded on deploy.

## 3. Non-goals

- Bot-relay posting (member submits in DM, bot posts on their behalf). Captured in §10 as the upgrade path if v2 proves inadequate; not built now.
- Cold-start period for new joiners. Telegram's own slow-mode + the strikes ladder cover this.
- Per-group rule sets. Every allowed chat moderates the same way.
- ML / context-aware moderation. External APIs are off-limits per project DNA.
- Admin review queue. Hit events go to `admin_audit_log` for after-the-fact inspection; no proactive UI.
- Image / voice moderation. Captions are scanned; image content is not. Strict-text-only is enforced via Telegram's group settings, not bot code.
- Edit-history scrubbing beyond first re-scan. If a member edits a passed message into a dirty one, the bot scans the edit and deletes; no further escalation logic.
- Hot-reload of the lexicon. JSON ships with each deploy.

## 4. Design

### 4.1. Lexicon — empirically derived, JSON-loaded

Lives at `data/moderation_lexicon.json`. Loaded at boot into a `Set<string>` (phrases) and a compiled `RegExp[]` (patterns). Reloaded on container restart only.

**Phrase list (≈25 entries).** Word-boundary matched after normalisation (see §4.2). Each phrase appeared **0–4 times in 2,565 Suncoast messages** but **dozens in 9,713 abuse-corpus messages**:

| Cluster | Entries |
|---|---|
| Direct-message redirect | `pm me`, `hit me up`, `hmu`, `dm me`, `inbox me`, `wickr me`, `signal me` |
| Commerce verbs | `selling`, `buying`, `sold`, `wts`, `wtb`, `wtt` |
| Pricing solicitation | `how much`, `what for`, `what's the price`, `what u sell` |
| Logistics | `pickup`, `drop off`, `meet up`, `f2f`, `p2p`, `come thru` |
| Stock claims | `got the`, `got some`, `stocked`, `in stock`, `holding` |
| Debt arrangements | `tic`, `tick`, `front`, `owe me` |
| Off-platform comm names | `wickr`, `threema`, `session`, `briar` |

**Regex list (4 entries).** Format-perfect artefacts that should never appear in chat:

| Name | Pattern (escaped) | Catches |
|---|---|---|
| `tme_invite` | `t\.me/\+\|t\.me/joinchat\|telegram\.me/\+` | private-group invite splatter |
| `phone` | `\b\+?\d[\d\s\-]{7,}\d\b` (≥9 digits with optional separators) | phone numbers in any common format |
| `crypto_wallet` | `\b(bc1[a-z0-9]{20,90}\|[13][a-km-zA-HJ-NP-Z1-9]{25,34}\|0x[a-fA-F0-9]{40}\|T[1-9A-HJ-NP-Za-km-z]{33})\b` | BTC / ETH / TRC addresses |
| `email` | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` | email addresses |

**Drug-name vocabulary is deliberately excluded.** The empirical scan showed Suncoast members use `bud / fire / k / mdma / pingas / caps` ambiently in normal chat. Blocking these would create false-positives at non-trivial rates. The commerce-shape phrasing is the high-precision signal; vocabulary alone is not. (Documented in `docs/runbook/opsec.md` §6a.)

**JSON shape:**

```json
{
  "version": "1",
  "phrases": ["pm me", "hit me up", "hmu", "..."],
  "regex": [
    { "name": "tme_invite", "pattern": "t\\.me/\\+|t\\.me/joinchat|telegram\\.me/\\+" },
    { "name": "phone", "pattern": "\\b\\+?\\d[\\d\\s\\-]{7,}\\d\\b" },
    { "name": "crypto_wallet", "pattern": "..." },
    { "name": "email", "pattern": "..." }
  ]
}
```

### 4.2. Normaliser

Before phrase matching, the message text is normalised:

1. Lowercase.
2. Replace common leet substitutions: `0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `8→b`, `@→a`, `$→s`.
3. Collapse runs of non-alphanumeric characters to a single space (`p.m. me`, `p_m_me`, `p-m-me` all become `p m me`).
4. Trim and collapse whitespace.

The phrase Set is matched against the normalised text using simple `text.includes(" "+phrase+" ")` semantics (with leading/trailing space padding to ensure word-boundary safety).

The regex list is applied to the **original** (non-normalised) message text — format-perfect matching is the point.

A hit returns `{ matched: true, source: "phrase" | "regex_<name>" }`. Caller doesn't need the specific phrase; the action is the same regardless. (Generic delete + warn message; we never echo what was matched, to avoid giving an attacker an oracle.)

### 4.3. Strike state — one small table

```sql
CREATE TABLE chat_strikes (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  chat_id BIGINT NOT NULL,
  telegram_id BIGINT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_strike_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reason TEXT,
  CONSTRAINT chat_strikes_unique UNIQUE (chat_id, telegram_id)
);
```

One row per `(chat_id, telegram_id)` pair. `count` is the strike count within the active window. `last_strike_at` is the timestamp of the most recent hit.

**Strike decay:** when recording a new hit, if `last_strike_at < now() - INTERVAL '30 days'`, treat `count` as 0 and reset to 1 on this hit (the user got a clean slate after a month). Otherwise increment.

This avoids a separate `strike_events` audit table. Each hit is independently captured in `admin_audit_log` (§4.7) for forensic review; the `chat_strikes` row is the lightweight "what's the user's current standing" lookup.

### 4.4. Strikes ladder — three steps, automatic

| Strike count after this hit | Action |
|---|---|
| 1 | `deleteMessage` + DM the offender once: *"Your message in `<group>` was removed. The Vouch Hub has rules against arrangement-shaped chat. Two more removals in 30 days will mute you for 24 hours."* |
| 2 | `deleteMessage` + `restrictChatMember(can_send_messages: false)` for **24 hours** + DM: *"Second removal in 30 days. You are muted in `<group>` until `<UTC time>`."* |
| 3 | `deleteMessage` + `banChatMember` (no `until_date`, permanent until admin unbans) + DM: *"Third removal in 30 days. You have been removed from `<group>`. Contact an admin if you believe this is an error."* |

**Admins are exempt from strikes.** If `admin_telegram_ids` includes the sender, the hit is logged but no action is taken. (Admin posting commerce-shape content is presumably context-aware; if they shouldn't have, they delete it themselves.)

**The bot is exempt** by definition — it never matches its own output.

### 4.5. What gets scanned

- `message.text` from `message` updates in any chat in `TELEGRAM_ALLOWED_CHAT_IDS`.
- `message.caption` from photo / video / document / animation messages in those chats.
- `edited_message.text` and `edited_message.caption` — re-scan on edit.

Scanning runs **before any other handler**. If a hit triggers a delete, no other handler sees the message (it was for a deleted message anyway).

DMs to the bot are **not scanned** — the lexicon is for public chat protection. The vouch DM flow has its own validators (§v1.1 spec).

### 4.6. Multi-group behaviour

Every chat ID in `TELEGRAM_ALLOWED_CHAT_IDS` is moderated by the same handler. No per-chat config:

- If the chat has Telegram-side member-posting disabled, no member messages arrive, the moderator simply has nothing to do.
- If the chat has member-posting enabled, the moderator scans every member message in real time.
- The strikes ladder is **per-chat**, not global: a user with 2 strikes in chat A and 2 strikes in chat B is at strike 2 in each, not 4 overall. This avoids one chat's behaviour banning a user from a different chat where they've been clean.

The OPSEC runbook §10 multi-group future (sales group, chat group, vouch hub) inherits this behaviour automatically. No `chat_role` config needed for moderation.

### 4.7. Audit log — every hit recorded

Each delete + strike writes one row to `admin_audit_log`:

| Column | Value |
|---|---|
| `command` | `chat_moderation:delete` |
| `target_chat_id` | the offending chat |
| `target_username` | the offender's @username (if available) |
| `admin_telegram_id` | the offender's telegram_id (the field stores the *actor* generally; here the actor was the offender — see note below) |
| `reason` | the matched source (`phrase` or `regex_tme_invite` etc.) |
| `denied` | `false` (a successful enforcement) |

(Naming note: `admin_audit_log.admin_telegram_id` is the column name, but for moderation rows it carries the offender's id. The schema doesn't change for this — overload the column. If admins want a clearer query later, a view filtering `command LIKE 'chat_moderation:%'` works.)

The audit row is the per-hit forensic record. The `chat_strikes` row is the lightweight current-standing lookup. They serve different purposes — both are kept.

### 4.8. Admin overrides

One new admin command:

- `/clear_strikes @username` — In the host group. Deletes the offender's row in `chat_strikes` for the chat the command was invoked in. Audited as `command="/clear_strikes"`. Useful when an admin manually unbans someone or wants to reset a strike count after a manual review.

Mutes and bans applied by `restrictChatMember` / `banChatMember` are reversible via Telegram's native group-admin UI — no new bot commands needed for unmute/unban.

## 5. Architecture

| Unit | Purpose | Inputs | Outputs |
|---|---|---|---|
| `data/moderation_lexicon.json` | Phrases + regex source of truth | (config) | (config) |
| `src/core/chatModeration.ts` | Loads lexicon, exposes `findHits(text): HitResult` | message text | `{ matched: true, source } \| { matched: false }` |
| `src/core/chatStrikesStore.ts` | DB round-trip for strike state | `(chat_id, telegram_id, reason)` | new strike count after recording |
| `src/core/tools/telegramTools.ts` | Add `restrictChatMember` and `banChatMember` wrappers (mirroring `deleteTelegramMessage`) | chat_id + telegram_id + duration | API response |
| `src/telegramBot.ts` group/message branch | Run `findHits` on member messages + edits; on hit, delete + apply strike action + audit | webhook update | side effects |
| `migrations/0009_chat_strikes.sql` | Create the `chat_strikes` table | (DDL) | (DDL) |
| Tests (alongside source files) | Lexicon unit tests, normaliser tests, strike-ladder tests | inputs | pass/fail |

No new commands, no new keyboards, no new launcher buttons, no new state machine. One JSON, one module, one store, one migration, two telegram-tool wrappers, one handler hook, four test files.

## 6. Verification

1. **Type check + tests:** `npx tsc --noEmit` and `npm test`. New tests (append to `package.json` `test` script):
   - `src/core/chatModerationNormaliser.test.ts` — normaliser output for leet, punctuation, mixed-case.
   - `src/core/chatModerationFindHits.test.ts` — phrase matching against normalised text; regex matching against original; both cleared and dirty inputs.
   - `src/core/chatStrikesStore.test.ts` — first hit creates row at count=1; subsequent hit increments; hit after 30-day-old `last_strike_at` resets to 1.
   - `src/core/chatModerationLadder.test.ts` — count→action mapping (1=warn, 2=mute, 3=ban). Mocks the telegram tool wrappers; asserts the right wrapper is called per count.
2. **End-to-end (manual):**
   - Set group to "members can post text" in Telegram. Member posts "pm me about this" → bot deletes within ~1s, member receives warning DM, strike row at count=1.
   - Same member posts "selling 2g" → bot deletes, member receives mute DM, member is restricted for 24h, strike row at count=2.
   - Same member, after the mute auto-expires, posts "wickr me" → bot deletes, member is banned, strike row at count=3.
   - Member with strike row 1, no further hits for 31 days → posts "pm me" → strike row resets to count=1 (warn, not mute).
   - Admin posts the same content → no action taken; audit row written with `denied=false` and a special `reason="admin_exempt"` for visibility.
   - `/clear_strikes @user` from an admin → strike row deleted; user can post afresh.
   - Edit a clean message into a dirty one → bot deletes the edit; strike applies.
   - Caption on a photo with a phone number → bot deletes; strike applies.
   - Same member is at strike 2 in chat A. They join chat B and post one hit — they are at strike 1 in chat B, not strike 3.
3. **Idempotency / race regression:**
   - Telegram occasionally redelivers the same `update_id`. The existing `processedTelegramUpdates` short-circuits before any handler runs. New handler sits behind that gate.
   - `chat_strikes` row writes use `INSERT ... ON CONFLICT DO UPDATE` so concurrent webhook deliveries can't double-count.

## 7. Risks / accepted tradeoffs

- **Sub-second window.** A hit-and-run report-the-bot attack inside webhook latency (~100ms–2s) leaves a brief artefact. Telegram's own classifier sees a deleted message at review time; the surrounding chat is bot-clean. We accept this as the practical limit of after-the-fact moderation. Approach B (bot-relay) closes it; not built now per §10.
- **No drug-name blocking.** Determined attackers using only drug names (no commerce verbs) get through. The empirical data says drug names alone don't differentiate marketplace activity from social chat in the target community. Drug names + commerce phrasing together → blocked (the commerce phrase fires).
- **Strike-decay window of 30 days.** A patient attacker could space attacks 31 days apart and never escalate past warning. Acceptable: the per-attack cost (delete + DM warning) is enough to make the attempt visibly unproductive, and admins watching the audit log can manual-ban a recidivist.
- **Per-chat strike independence.** A multi-group spammer hits each group separately. Acceptable: better than a global counter that bans someone from a clean chat because of behaviour in another. The audit log gives admins the cross-chat picture if they want it.
- **Lexicon staleness.** Phrases evolve. The JSON file is in version control; updating it is a normal commit + deploy. Admins watch `admin_audit_log` for hit patterns that suggest a new phrase should be added.
- **JSON parse failure at boot.** If `moderation_lexicon.json` is malformed, the bot fails to start. This is preferable to silently running with no moderation. Boot validation should reject on parse error.

## 8. Out of scope (explicit)

- Bot-relay posting (Approach B from the brainstorm).
- Cold-start period for new joiners.
- Per-chat rule sets.
- ML / external moderation APIs.
- Admin review queue UI / dashboards.
- Image content moderation.
- Hot-reload of the lexicon at runtime.
- A `/strikes @username` admin lookup command. Admins query the table via SQL if needed; not common enough to justify a command.
- Mute/ban duration tuning per chat.
- Cross-chat strike aggregation.
- Drug-name vocabulary blocking.

## 9. Forward compatibility

This spec inherits the multi-group contract from v1.1 §10 without code changes:

- The handler runs on every chat in `TELEGRAM_ALLOWED_CHAT_IDS`. Adding a chat is one env-var edit.
- No `chat_role` differentiation needed. The bot moderates wherever member messages arrive.
- When the future spec lands the role-mapping concept (`vouch_hub | sales_group | chat_group`), this moderation is unchanged. The role mapping is for *vouch publication targeting*; moderation is universal.
- If/when Approach B (bot-relay) is needed, it sits *in front of* this moderation: relay accepts message → runs the same `findHits` → publishes if clean. Same lexicon, same store, no rework.

## 10. Approach B as the upgrade path (deferred)

If 30 days of running v2 shows successful hit-and-run takedowns despite the lexicon + strikes ladder, the upgrade is bot-relay (member submits via DM → bot scans → bot posts on behalf if clean). The cost is a new launcher → DM flow → posting pipeline (~250-400 LoC). Build only if v2 demonstrably fails. Until then, v2 is the answer.
