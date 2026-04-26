# VouchVault impenetrable architecture (v6)

**Date:** 2026-04-26 (latest patch: forward-pattern correction + Bot API research)
**Status:** architecture target. Spec, not a plan. Each section is what we're building toward; implementation order is in §11.
**Supersedes:** v1–v5. v5 in particular reversed the channel-pair finding incorrectly. v6 is the corrected target.
**Grounded in:** `docs/research/tbc26-knowledge-base.md` — every architectural choice below traces back to a verified TBC26 fact (cited inline as `KB:F<n>`) or a verified Telegram Bot API capability (cited as `KB:F2.13`).
**Goal:** survive AND grow. The current architecture limits trust because it looks fragile. Impenetrability is what unlocks growth, not what trades against it.
**Design principle:** **better and simpler than TBC26.** TBC has 21 bots, a TOS-violating userbot, 13 topics, sister groups, and a hodgepodge of off-the-shelf tools accumulated reactively through three takedowns. We learn from their *resilient core* and build a cleaner version with fewer moving parts: 1–3 bots (operator-rotatable), 4 topics, no userbot, no sister groups, channel-as-archive recovery asset, all Bot-API-clean.

---

## §1 What "impenetrable" actually means

Not "we never get banned" — that's not achievable on Telegram in 2026. **Impenetrable means: structural redundancy such that any single compromise (bot, supergroup, admin account, IP, identity) does not destroy the operation.** TBC26 survived three takedown events between 2025 and 2026 not because individual pieces held, but because every piece had a backup or a graceful-degradation mode (KB:F4.1, KB:F4.2, KB:F4.3).

Concretely, the impenetrable VouchVault has all of these properties simultaneously:

1. **Bot-banned doesn't kill us.** Multi-bot split + dual-register fallback. If the ingest bot dies, lookup still works; if lookup dies, /search-from-DM still works; if admin dies, we lose moderation but not publishing.
2. **Supergroup-banned doesn't kill us.** Paired channel survives independently (KB:F2.3 — the END ROAD WORK pattern: channel survived after supergroup nuked). All publish history accessible from the channel; member-list is recoverable from the saved-contacts protocol.
3. **DB-loss doesn't kill us.** Daily backup; archive content also lives in the channel.
4. **Admin-account compromise doesn't kill us.** Tight admin list (≤5), at least one alt admin account, nothing important sits with one person.
5. **IP/Railway-banned doesn't kill us.** Bot tokens are portable; we can swap host providers. Documented in opsec.
6. **Mass-report attack doesn't trivially kill us.** Hidden distribution + tight gating + no public folder + member-list-as-recovery-asset (KB:F4.3, KB:F5.1).
7. **Insider-leak doesn't trivially kill us.** Single invite link, audited admin list, tight folder discipline.
8. **Single-post ToS violation doesn't kill us.** Light-touch moderation that scrubs flag-content fast (KB:F5.4 — BALFROCAK: "One post can wipe this whole operation").

Each item below is a piece of that puzzle.

---

## §2 Group structure — forum-mode supergroup with linked channel

### §2.1 Topology

```
                              VouchVault Archive
                                  (channel)
                                      │
                                      │ Telegram channel-discussion
                                      │ link (auto-forward)
                                      ▼
                              VouchVault (supergroup)
                                  forum-mode
                                  ┌──────────┬─────────┬───────────┬─────────────┐
                                  │ Vouches  │  Chat   │ Lookups   │ Banned Logs │
                                  │(General) │         │           │             │
                                  └──────────┴─────────┴───────────┴─────────────┘
```

- **VouchVault Archive** is a Telegram **channel** (broadcast type, not a supergroup). Bot publishes here. Channel survives even if supergroup dies (KB:F2.3).
- **VouchVault** is a forum-mode private supergroup with Request-to-Join + manual approval. Discussion-linked to VouchVault Archive.
- **Channel-published posts auto-forward into the supergroup's General/Vouches topic** with `is_automatic_forward: true, forward_from_chat: <channel>` (KB:F2.6 mechanism 1).

### §2.2 Topic plan

Modeled on TBC26's surviving topic structure (KB:F1.2) but trimmed to VouchVault scope:

| Topic | Purpose | Who posts |
|---|---|---|
| **Vouches** (General) | Channel auto-forwards land here. Per-vouch comment threads. | Bot-via-channel. Members may comment per-vouch. |
| **Chat** | Free-form member discussion. | Members. Lookup-bot responds here when invoked. |
| **Lookups** | Optional: dedicated topic for `/search` results. Keeps Vouches uncluttered. | Lookup bot (responses) + members (queries). |
| **Banned Logs** | Frozen-account audit trail. Read-only for members. | Admin bot; logs every freeze/unfreeze with reason. |

That's 4 topics. Smaller than TBC26's 13 (KB:F1.2) because we don't have sister-group landings (Telegram Links, SAPOL SETUPS) or category specialization (HALL OF SHAME etc.). Expansion is allowed when justified by member request, not pre-built.

### §2.3 Why forum-mode (not flat)

- **Topic separation = lower per-topic deletion risk.** A ToS-flagged post in Chat doesn't drag down the Vouches topic.
- **Auto-forward target is well-defined** (General topic).
- **Lookups don't crowd Vouches** — operator-configurable.
- **Matches the surviving comparable's actual structure** (KB:F1.2). TBC26 went from 4 topics initially to 13 over a year; we start with 4.

---

## §3 Multi-bot stack

### §3.1 Bot inventory

| Bot | Role | Permissions | Token env var |
|---|---|---|---|
| **Ingest** (custom, existing `@VouchVault_bot`) | DM wizard → DB write → channel publish | Channel admin (`post_messages` only). Supergroup: regular member (read-only, for relay-capture). Privacy mode: OFF. | `TELEGRAM_INGEST_TOKEN` (alias of existing `TELEGRAM_BOT_TOKEN`) |
| **Lookup** (custom, new) | In-supergroup `/search`, `/recent` commands. Read-only on DB. | Supergroup: regular member, send + read. Privacy mode: ON (only sees commands and mentions). | `TELEGRAM_LOOKUP_TOKEN` |
| **Admin** (custom, new) | Admin commands (`/freeze`, `/unfreeze`, `/audit`, `/relayhealth`); chat-moderation (delete + DM warn per existing lexicon) | Supergroup: admin with `can_delete_messages` + `can_restrict_members`. Privacy mode: ON. | `TELEGRAM_ADMIN_TOKEN` |
| **Captcha** (off-the-shelf, e.g. `@GroupHelpBot` or `@shieldy_bot`) | Username-required + captcha at join | Supergroup: admin with `can_invite_users` + `can_restrict_members` only | n/a (configured via the bot's own settings UI) |
| **User-history** (off-the-shelf, `@SangMata_beta_bot`) | Community-facing: members and admins query `@SangMata_beta_bot allhistory <user_id>` to vet account-name history before vouching. | Supergroup: regular member. Members invoke directly. | n/a |

Five bots total: 3 custom, 2 off-the-shelf. **Sized like TBC26's resilient core, not like their full 21-bot stack** (KB:F2.1). We add more only when a specific gap surfaces.

### §3.2 Why multi-bot

KB:F4.1 + KB:F4.2 + KB:F4.3: TBC26's three takedown events all involved bot-account-level damage. Single-bot architecture is a single point of failure. Splitting:

- **Failure-domain isolation.** Ingest banned ≠ lookup banned ≠ admin banned. Each token can be rotated independently (KB:F5.3).
- **Permission-scope hygiene.** Ingest never needs to delete in supergroup; admin never needs to publish; lookup never needs to write DB. Smaller per-bot permission surface = smaller attack surface and fewer false-positive moderation triggers.
- **Legitimacy signature.** Multi-bot stack (custom + off-the-shelf) looks like a real community with infrastructure investment, not a single-script bot operation. Important for member trust.

### §3.3 Bot rotation cadence

Per KB:F5.3 — bot replacement is routine, not emergency.

- Quarterly review: is any bot showing elevated error rate, classifier-flag indicators, or slow `/readyz` responses?
- If yes: provision a replacement via @BotFather, swap token in Railway, redeploy, verify, delete the old bot. Old token revokes.
- Documented in opsec.md §11 (existing) — extend with the multi-bot rotation matrix.

### §3.4 Userbot policy (off by default, opt-in via burner)

Per KB:F2.13 — Bot API gives us TOS-clean equivalents for everything BALFROCAK does with his userbot, **except** cross-group content reading (which we don't currently need at our single-community scope) and cosmetic legitimacy.

**Default posture:** Bot API only. The 3 custom bots in §3.1 cover all current operational needs.

**Opt-in burner-userbot path (documented but not default):** if a future operation requires userbot capabilities Bot API can't provide (e.g. monitoring sister communities we don't admin, or sustained burst-rate exceeding Bot API's 30 msg/sec broadcast cap), the operator may spin up a userbot under a **dedicated burner Telegram account**, NOT the operator's personal account. Burner ban risk is bounded to the burner's admin scope; operator's personal account stays clean. Burner is created from a fresh phone number, has its own session, runs Telethon or Pyrogram, and only does the specific operation that requires it (not a 24/7 daemon).

**What this gets us:** full TBC capability parity if needed, with the burner-isolation property that BALFROCAK's pattern lacks (he uses his own user_id 7853873030 — KB:F2.2). If our burner gets detected, we lose that one operation, not the whole operator identity.

**What we do NOT do:**

- ❌ **Userbot under the operator's personal account.** Burner only. Asymmetric downside: operator's personal account ban → loss of admin status across all VouchVault assets.
- ❌ **Bot-fronted captcha-as-a-service.** We use off-the-shelf `@GroupHelpBot` or equivalent; we do not build our own captcha surface.
- ❌ **More than 5 bots in v6.** Adding bots is non-trivial: each is a token to rotate, a permission scope to audit, a failure domain to monitor. 5 is the smallest stack that still has failover.
- ❌ **Userbot enabled by default.** It's an opt-in addendum, not a v6 mandate. Default deployment is Bot API only.

---

## §4 Publish architecture — archive-preservation relay (corrected from v5)

**Framing correction:** v5 framed this as "curated relay model" implying admin curation / quality gating. KB:F2.10–F2.11 verified that BALFROCAK does NOT filter or curate forwards — they're **archive preservation** at scale. Forwarded shape itself carries the classifier-resistance, not the curation. VouchVault publishes wizard-captured content verbatim through the same relay shape, no sanitization needed beyond the existing 800-char and HTML-escape limits.

### §4.0 Two operational modes

| Mode | Trigger | Mechanism | Volume |
|---|---|---|---|
| **Steady-state publish** | Each reviewer-completed wizard | Bot publishes to channel; channel-pair auto-forwards into supergroup | ~1–10/day |
| **Migration burst** | Recovery / takedown migration | Bot calls `forwardMessages` (batched up to 100/call) to forward archived channel posts into a new destination chat | Up to thousands in minutes (Bot API rate-limit-clean per KB:F2.13) |

Both produce identical on-the-wire shape: forwarded message with `sender_chat: <channel>` (or `forward_origin: <channel>` post-Bot-API-7.0), preserving classifier-resistance verified in KB:F2.10.

### §4.1 The publish flow

```
Reviewer DMs @VouchVault_bot
    │
    ▼
Wizard: target → result (POS/MIX/NEG) → tags → free-form prose body → preview → confirm
    │
    ▼
Ingest bot writes DB row (status='draft', body_text=<prose>, structured fields populated)
    │
    ▼
Ingest bot posts to VouchVault Archive channel:
  body = <reviewer's prose, HTML-sanitized>
       + "\n\n<code>#<entry_id></code>"
       (no structured POS Vouch heading; structured fields render only in /search)
    │
    ▼
Telegram-native channel-discussion link auto-forwards into supergroup's General topic
    │
    ▼
Resulting supergroup message has:
  is_automatic_forward: true
  forward_from_chat: <channel>
  forward_from_message_id: <channel_msg_id>
  from: <channel_id>
    │
    ▼
Ingest bot's webhook (privacy mode OFF, listening to supergroup) sees the auto-forwarded
copy, matches by forward_from_message_id, updates DB row:
  status='published', channel_message_id=X, supergroup_message_id=Y
    │
    ▼
DM "Posted to the group" confirmation to the reviewer with the channel-post URL
```

### §4.2 Why this shape

- **Forwarded shape** (`is_automatic_forward: true`) is statistically less likely to trip Telegram's ML moderation than a fresh bot-send (KB:F2.5 reason 3).
- **Channel-published archive survives** even if the supergroup dies (KB:F2.3 — the END ROAD WORK precedent).
- **Free-form prose body** matches TBC26's actually-published vouch shape (KB: §1.10 from v5 / §6 from member-behavior pass: positive vouches are loose-templated free-form, not byte-identical templates). Eliminates V3's templated-fingerprint takedown vector.
- **`#<entry_id>` footer** is the only structured token in the published post. It's tap-to-copy, lets members reference specific entries, and ties group post back to DB row for future operations.
- **Structured fields (target, tags, result) live only in DB** and surface only via `/search` and `/recent` lookups. The group-post surface stays human-prose.

### §4.3 Length cap

- Reviewer prose input: **800 characters max** (raw). After HTML-escape worst case (~5×), worst case lands at ~4000 chars + footer ~10 chars, comfortable under Telegram's 4096-char ceiling and the existing 3900 safety margin.
- Wizard rejects input >800 chars with: "keep it under 800 chars please — say less."
- Wizard rejects non-text input (photos, stickers, voice) with: "plain text only please."
- Wizard rejects text with formatting entities (bold, italic, links) with: "plain text — no formatting please." Forces the published post to be unstyled prose, matching TBC26's actual vouch shape.

### §4.4 Locked V3.5 text additions

These become locked-text (tested via `archiveUx.test.ts` per existing pattern):

- `buildVouchProsePromptText()` — wizard prompt asking for the prose body
- `buildPreviewText()` — updated shape: `<i>Preview</i>\n\n<sanitized_prose>\n\n#<id>`
- `buildPublishedDraftText()` — DM confirmation with channel post URL
- `buildLookupBotShortDescription()`, `buildLookupBotDescription()` — new bot profile copy
- `buildAdminBotShortDescription()`, `buildAdminBotDescription()` — new bot profile copy
- `buildAccountTooNewText()` — wizard rejection for accounts <24h since first-seen (§5)

Spec amendment to V3 spec is required to authorize these. That goes alongside this v6 doc.

### §4.5 Migration burst — mass-forward replay capability (new)

**The capability:** an operator-only script that takes a destination chat_id and replays every published `vouch_entries` row (or a filtered subset) into that destination via Bot API `forwardMessages`, preserving forward attribution. Same shape as BALFROCAK's rebrand-day bulk imports (KB:F2.10), via TOS-clean Bot API.

**Use cases:**
1. **Takedown recovery.** Supergroup is gone, channel survives. Operator creates new supergroup, links it to the channel as discussion group. Telegram auto-forwards new posts forward but does NOT auto-forward channel history. Operator runs the replay script to forward all archived channel posts into the new supergroup. Members rejoin and see the full archive.
2. **Channel migration.** If the channel itself dies, operator creates a new channel + new supergroup, then replays the DB (which has the source-of-truth content) into the new channel via `sendMessage` (steady-state path). The new channel's history is the new archive going forward; old vouches re-published with their original metadata in the prose body.
3. **Sister community spawning** (future). If VouchVault ever spawns a topic-specific sister community, the replay script seeds the new group with relevant historical vouches.

**Mechanism:**
```
Operator runs:
  npm run replay:to-telegram -- --destination-chat-id <id> [--filter status=published]
    │
    ▼
Script reads DB for matching vouch_entries with channel_message_id IS NOT NULL
    │
    ▼
Script batches up to 100 message_ids into each forwardMessages API call
    │
    ▼
Script throttles to ≤25 msgs/sec to stay under Bot API broadcast cap (30/sec) with safety margin
    │
    ▼
For each successfully-forwarded message, script writes a new row to a replay_log table:
  (replay_run_id, source_chat_id, source_message_id, destination_chat_id, destination_message_id, replayed_at)
    │
    ▼
On rerun (idempotent), skip already-replayed rows for the same (run_id, destination)
```

**Why this beats BALFROCAK's userbot for the migration burst use case:**
- TOS-clean. No burner-account ban risk during a high-stakes recovery event.
- `forwardMessages` (plural, Bot API 7.0+) batches 100 forwards per API call — 6,810 forwards = 68 calls = ~3 seconds of API time. Userbot has no such advantage at our volume.
- Idempotent + auditable via `replay_log` table. Userbot operations are not.

**File:** `scripts/replayToTelegramAsForwards.ts` (new). Implementation arrives in v6 commit 6 (§11).

---

## §5 Account-age guard (defensive gating at the wizard)

### §5.1 The rule

Reject vouch submissions from Telegram accounts whose first interaction with the VouchVault bot was less than 24 hours ago.

### §5.2 Why

KB:F5.6 — TBC26 explicitly waits 24+ hours before vouching new accounts. It's a community-enforced norm, but in our case we encode it as code so it's not an admin-judgment call.

The 24h floor is the cheapest defense against:
- Throwaway accounts created specifically to publish a fake vouch
- Mass-attack accounts spawned via the Python script (KB:F4.2 mechanism)
- Compromised-account hijacks (attacker has 24h window before they can publish, giving us detection time)

### §5.3 Implementation

- New table `users_first_seen` (or new column on `users` table): `(telegram_id BIGINT PK, first_seen TIMESTAMP NOT NULL DEFAULT NOW())`.
- `markUpdateProcessed()` writes to `users_first_seen` on every update if the row doesn't exist (`ON CONFLICT DO NOTHING`).
- New helper `getUserFirstSeen(telegramId)` in `src/core/userTracking.ts`.
- Wizard guard at start of DM flow: if `now() - first_seen < 24h`, reply with `buildAccountTooNewText()`: "Please come back in 24 hours — we wait for new accounts to establish."
- Tests: unit test for the helper; wizard-flow integration test that simulates a fresh-user start.

---

## §6 Member-list as recovery asset

### §6.1 The protocol

KB:F5.1 — BALFROCAK explicitly states member lists are more valuable than backup groups. We adopt the same posture.

- New script `scripts/exportMemberContacts.ts`: queries DB for all known member `(telegram_id, username, first_seen, last_seen)` and writes a CSV to stdout. Operator redirects to a local file.
- Run cadence: monthly, plus on-demand before any anticipated risk event.
- Operator imports the CSV into their personal Telegram as contacts. Contacts can be DM'd reliably and can be re-invited without invitation prompts.

### §6.2 Why

- **Recovery from supergroup deletion.** If the supergroup dies, the channel survives (KB:F2.3) but inviting members back to a new supergroup requires having their @s. The DB loses connection state when the bot is migrated; the operator's saved contacts do not.
- **Recovery from DB-loss.** Snapshot of canonical member identities outside Postgres.
- **Operator can directly DM members during a takedown event** even if all groups are unreachable.

### §6.3 What the script does NOT do

- ❌ Send anything to anyone. CSV export only.
- ❌ Include private notes, freeze status, or other sensitive metadata. Only `(telegram_id, @username)`.
- ❌ Include reviewers who have only DM'd the bot (= not actually members of the supergroup). Optional: include them if they've published at least one vouch.

---

## §7 Hidden distribution + tight gating

### §7.1 Distribution

- **Single Request-to-Join invite link.** Manual approval per request.
- **Never share the invite link publicly.** Distribution is via `/start` deep-link from the bot, or via direct DM from existing members to known prospects.
- **No folder distribution.** KB:F4.3 — TBC26 specifically protected the main supergroup by keeping it OUT of the public folder; the leaked folder was the attack vector. We have no sister groups so the question is moot, but the principle holds.

### §7.2 Gating layers (in order)

1. **Username-required at join.** Captcha bot rejects users without `@username` set.
2. **Captcha challenge.** Off-the-shelf bot.
3. **Manual admin approval** of Request-to-Join.
4. **Account-age guard at wizard** (§5).

Four layers. Each filters a different attack class.

### §7.3 Growth pacing (the bit that unblocks growth)

KB:F5.2 — BALFROCAK's "disable link-sharing + adding-contacts permissions" yielded extreme slow growth and explicit acknowledgment that the groups "got boring." We accept the trade-off but move it from "fully off" to "throttled":

- **Initial month after launch:** approve up to 10–20 Request-to-Join per day.
- **Established (≥3 months in):** approve up to 50/day.
- **During a recovery event (post-takedown):** caps lifted because the alternative is "members lose access." This is a known one-time spike, not ongoing.
- **Members can invite — but only via the bot's deep-link.** Member-to-member raw link sharing is still disabled at the supergroup permission level.

---

## §8 Light-touch moderation

### §8.1 Stay matched to TBC26's posture

KB:F2.14 + KB:F2.17: TBC26 has 1 solicitation in 25,871 messages (effective filter) but allows drug-vocabulary discussion freely. The discriminator is **solicitation-shape** (buy/sell + contact CTA), not vocabulary. Existing `runChatModeration` policy stays: lexicon hit → delete + DM warn. No bans, no mutes, no strikes. False-positive cost bounded to one delete + one DM. **Do not introduce stricter rules. Do not add appeal UI** (BALFROCAK doesn't have one — KB grounding); members DM admin if they think delete was wrong.

### §8.2 Lexicon expansion — variant B regex (final, calibration-verified)

KB:F2.18: 5 regex variants empirically tested across TBC26 + QLD Vouches + QLD Chasing. Variant B (buy-stem + drug + contact-CTA in same message) is the unique optimum: **0 marginal FPs in TBC26** (above existing PHRASES baseline), 165 clean catches in QLD Chasing on manual audit. Add to `chatModerationLexicon.ts`:

**Approach:** since variant B requires TWO separate sub-patterns to BOTH match, the cleanest implementation is a small `findCompoundHits()` helper rather than stuffing everything into one regex:

```typescript
const BUY_STEM = /\b(?:anyone|who(?:'s|s)?|chasing|looking for|need|wtb|after some)\b[^@\n]{0,50}\b(?:bud|buds|gas|tabs|ket|ketamine|vals|carts|wax|coke|cocaine|mdma|md|mda|lsd|acid|shrooms|mushies|oxy|xan|xanax|pingers|pills|press|presses|caps|weed|meth|ice|crystal|oz|qp|hp|gram|d9|dispo)\b/i;

const SOLICIT_CONTACT_CTA = /\b(?:pm|dm|hmu|hit me|inbox|message me)\b/i;

// In findHits(): if BUY_STEM.test(text) && SOLICIT_CONTACT_CTA.test(text)
//                → return { matched: true, source: "compound_buy_solicit" };
```

This is added to the existing `findHits()` flow as a third pass after PHRASES and REGEX_PATTERNS. Returns matched=true with a distinct source tag so audit rows can attribute hits to this rule.

**Drug-name list maintenance:** edit the regex when new slang surfaces ("trapstars", "dank carts", "exotic" etc.). Document edge cases in `chatModerationLexicon.test.ts`. Accept that exotic terms slip through until the next redeploy.

### §8.3 FP-rate verification gate (Unit 2)

New operator script `scripts/measureLexiconFP.ts` loads a Telegram-export JSON and reports `findHits()` match-rate stats per source-tag. Used as a **commit verification step** for §8.2:

| Corpus | Marginal-only target (above existing PHRASES baseline) | Gate |
|---|---|---|
| TBC26 export (`result_example.json`) | **0** marginal hits | If any new hits, manual review required before merge |
| QLD Vouches export (`result_qldvouch.json`) | <5 marginal hits | Sanity check |
| QLD Chasing export (`result_chasing.json`) | >100 marginal hits | If lower, regex too narrow → widen |

**Marginal** = caught by `compound_buy_solicit` AND NOT already caught by existing PHRASES/REGEX_PATTERNS. Measures the new rule's contribution without double-counting overlap.

Gates fail → don't merge. Gates pass → ship. Re-run on every lexicon edit.

**Already-verified results (2026-04-27, baseline run):**
- TBC26: 0 marginal hits ✅
- QLD Vouches: 0 marginal hits ✅
- QLD Chasing: 165 marginal hits ✅

**Calibration back-check (KB:F2.19):** the top shape patterns in variant B's 165 QLD Chasing catches ("who can sort", "who can drop", "anyone sort a", "looking for exotic") have **zero surviving instances in TBC26** — confirming BALFROCAK removes these shapes. Conversely, the shapes BALFROCAK tolerates in TBC26 (vouch-context "anyone able to vouch", generic chat) are NOT caught by variant B (no drug-name proximity). **Variant B is calibrated to TBC26's actual tolerance threshold — we ship matched, not stricter.**

**Test corpora roles:**
- **TBC26** = filtered baseline. Marginal hits should be 0 (or any hits should be explainable as solicitation TBC's filter let through that BALFROCAK would also remove).
- **QLD Vouches** = mid-strictness baseline. Sanity check.
- **QLD Chasing** = positive corpus. High solicitation density by design (it's a chasing group). Marginal catches here are EXPECTED — they're the solicitation shapes our filter should catch in our group too.

The script in `scripts/measureLexiconFP.ts` computes all three. CI/operator can re-run after any lexicon edit.

### §8.4 DM-warn template — locked V3.5 text (Unit 3)

Existing `chatModeration.ts` has hardcoded inline DM strings. Refactor into builder for locked-text discipline (V3 amendment pattern). New function in `archive.ts`:

```typescript
export function buildModerationWarnText(args: {
  groupName: string;
  hitSource: string; // e.g. "phrase:pm me", "regex_buy_shape", "regex_vouch_for_username"
  adminBotUsername?: string | null; // when admin bot is configured
}): string {
  const escapedGroup = escapeHtml(args.groupName);
  if (args.hitSource.startsWith("regex_vouch_")) {
    return `Your message in <b>${escapedGroup}</b> was removed. Vouches must go through the bot — tap <b>Submit Vouch</b> in the group to start the DM flow. Posting vouch-shaped text in chat is auto-removed.`;
  }
  const adminPointer = args.adminBotUsername
    ? `DM <code>@${escapeHtml(args.adminBotUsername)}</code>`
    : `contact an admin`;
  return `Your message in <b>${escapedGroup}</b> was removed. Posts that look like buy/sell arrangements are auto-removed. If you believe this was a mistake, ${adminPointer}.`;
}
```

Tested via `archiveUx.test.ts` locked-text assertions (existing pattern). Append to V3 spec V3.5 amendment list. `chatModeration.ts` is updated to call `buildModerationWarnText()` instead of constructing strings inline.

### §8.5 Multi-bot handoff (Unit 4)

Variable Y (privacy mode) resolution: **admin bot privacy mode OFF** (correction to v6 §3.1 — it needs to see all chat messages to run moderation, not just commands). Ingest bot also has privacy OFF (existing, for relay capture).

Handoff under multi-bot — env-var gated, single-bot at a time:

```typescript
// In adminBot.ts (new in v6 commit 5):
//   On every group message → runChatModeration unconditionally.
//
// In telegramBot.ts (ingest bot):
//   On every group message → runChatModeration ONLY IF
//   process.env.TELEGRAM_ADMIN_TOKEN is unset.
//   Otherwise skip — admin bot owns moderation.
```

This avoids double-moderation during the rollout. Backwards-compat: when `TELEGRAM_ADMIN_TOKEN` is unset (default deployment), ingest moderates as today.

### §8.6 Edge cases handled / explicitly deferred

**Handled by existing infrastructure or new design:**

- ✅ Bot self-skip (`is_bot` + id check) — existing
- ✅ Admin-exempt — existing audit-tag pattern
- ✅ Edited messages — existing branch
- ✅ Captions on media — existing combined text+caption
- ✅ Forwarded messages — lexicon runs on the forward's text
- ✅ Member self-deletion — Telegram doesn't notify; existing try/catch on deleteMessage 400
- ✅ Burst attacks — DMs silently fail per first-DM gap; rate-limits absorbable

**Deferred (track if seen):**

- ❌ Image-only solicitation (no caption) — vendors don't typically; reconsider if observed
- ❌ Unicode-fancy text evasion (𝗽𝗺 𝗺𝗲) — extend `normalize()` to NFKD if needed
- ❌ Multi-iteration leet evasion ("p..m. me" with multiple separators) — existing single-pass; tighten if seen
- ❌ Self-harm / CSAM / other-ToS content — out of scope; Telegram-native report
- ❌ Per-topic rule variation — defer; same rules across all topics initially
- ❌ Auto-measurement of FP rate post-launch — manual operator review for now
- ❌ Bot-internals echo scrubbing (KB:F TBC actively scrubs these) — minimal at our scale, defer
- ❌ Vouch attempt without `@username` (no `POS Vouch` prefix either) — rare gap, accept; existing `regex_vouch_heading` and `regex_vouch_for_username` cover the common cases

### §8.7 Implementation split (4 atomic units)

| Unit | What | Maps to v6 commit |
|---|---|---|
| 1 | Lexicon expansion + lexicon tests | New, can ship before commit 5 (independent) |
| 2 | `scripts/measureLexiconFP.ts` + verification gate | New, ships with Unit 1 |
| 3 | `buildModerationWarnText` + locked-text tests + DM-string refactor | Folds into commit 5 (locked text bundle) |
| 4 | Admin bot privacy-OFF doc + multi-bot moderation handoff code | Folds into commit 1 (opsec doc) + commit 5 (code) |

Units 1 and 2 are independent of multi-bot — could ship as a small standalone commit (call it "commit 1.5") to land faster lexicon coverage while multi-bot work proceeds. Recommendation: ship Units 1+2 first as commit 1.5 to get the immediate solicitation-filter improvement, then continue with multi-bot rollout.

---

## §9 Operator OPSEC

### §9.1 Account hygiene

- Bot tokens created from a Telegram user account that has been active for ≥6 months. Fresh accounts creating bots = fast classifier-driven bans (KB note from v5 §6.5 / external research).
- New bots warmed in a low-traffic test group for 1–2 weeks before production rollout.
- Privacy mode for ingest bot DISABLED in @BotFather (required for relay-capture in §4.1).
- At least one alt admin account in case main is compromised.

### §9.2 Adversary-aware operations

KB:F4.3 — threat model includes an active human adversary running a mass-reporting Python script. Mitigations:

- Single Request-to-Join invite link. Never folder-share.
- Don't post the invite link in publicly searchable channels.
- At least one alt admin account.
- Save member @s as contacts pre-emptively (§6).
- Periodic admin-list audit. ≤5 admins.

### §9.3 ToS literacy

KB:F5.4 — BALFROCAK rereads Telegram ToS regularly. We adopt the same operator habit:

- Quarterly: operator re-reads Telegram Terms of Service, Bot Platform Policy, and recent enforcement guidance.
- Group avatar / name / description: keep generic and community-flavoured. **No** marketplace language anywhere — avoid: verify, certified, approved, trusted, premium, guarantee, escrow, deal, vendor, merchant, etc. (existing opsec.md §2 already covers this; restated as a v6-mandatory item).

### §9.4 TBC monitoring habit

KB:F (re-read protocol): re-export TBC26 every ~3 months and re-run the 6-pass analysis. Pull learnings into opsec.md additively. Keep this discipline; it's how we catch new defensive patterns without rebuilding our model from scratch each time.

---

## §10 Health, observability, idempotency

### §10.1 `/healthz` extended for multi-bot

```json
{
  "ok": true,
  "bots": {
    "ingest": {"configured": true, "last_update_at": "..."},
    "lookup": {"configured": true, "last_update_at": "..."},
    "admin":  {"configured": true, "last_update_at": "..."}
  },
  "channel": {"configured": true, "id": -100..., "stale_relay_rows": 0},
  "db": {"pool_size": 10, "active": 2}
}
```

### §10.2 `/readyz` per-bot getMe

Existing `/readyz` runs `getMe` for ingest. Under multi-bot: runs `getMe` for each configured bot. All must succeed for ready. Fail-open for unconfigured bots.

### §10.3 Multi-bot idempotency

Telegram update_ids are per-bot. Three bots = three independent sequences = collisions possible. Migration: add `bot_kind TEXT` column to `processed_telegram_updates` with values `'ingest'|'lookup'|'admin'`. Composite unique on `(bot_kind, update_id)`. Backfill existing rows to `bot_kind='ingest'`. `markUpdateProcessed(updateId, botKind)` signature change at every webhook handler.

### §10.4 Stale relay rows

`/healthz` exposes count of `vouch_entries` with `status='channel_published'` and `channel_message_id IS NOT NULL` and `supergroup_message_id IS NULL` and `created_at < now() - 5 minutes`. Surfaces broken channel-discussion link.

---

## §11 Implementation order (when authorized)

### Commit 1.5 — Lexicon expansion + FP-rate gate (independent, can ship before multi-bot)

§8.2 Units 1+2:

- `src/core/chatModerationLexicon.ts`: add `regex_buy_shape` + `regex_offer_with_contact` patterns (both with drug-name proximity, 50/40+30-char windows).
- `src/core/chatModerationLexicon.test.ts`: unit tests — new regex matches ≥10 known QLD Chasing solicitation samples, doesn't match ≥10 TBC26 vouch samples.
- `scripts/measureLexiconFP.ts` (new): operator script loads a Telegram-export JSON, runs `findHits()` on every message, reports per-class match-rate stats.
- `package.json`: add `npm run measure:lexicon-fp` script.
- Verification gates (must pass before merge):
  - TBC26 export → match rate <0.5%
  - QLD Vouches export → match rate <5%
  - QLD Chasing export → match rate >70%
- Independent of multi-bot rollout. Ship first to get immediate solicitation-filter improvement; multi-bot continues as planned.

### Commit 1 — opsec.md additions (doc only)

Append sections to `docs/runbook/opsec.md`:

- **§10. TBC26 mirror posture (v6).** Operator stack, distribution, growth pacing.
- **§11. Channel-pair operator setup.** Concrete steps to convert supergroup to forum, create channel, link them, configure topic structure.
- **§12. 5-phase bot rollout.** A → ingest as supergroup admin (current); B → provision lookup + admin tokens, add to supergroup; C → verify admin bot moderation; D → demote ingest to member; E → enable channel relay.
- **§13. Adversary-aware operations + bot rotation runbook + ToS literacy + TBC monitoring habit.**
- **§14. Member-list export protocol.**

### Commit 2 — V3.5 spec amendment + plan file

- Append V3.5 amendment to `docs/superpowers/specs/2026-04-25-vouchvault-redesign-design.md` capturing the new locked-text functions, prose body shape, account-age guard, channel relay.
- Create `docs/superpowers/plans/2026-04-26-impenetrable-architecture.md` in superpowers writing-plans format.

### Commit 3 — DB schema + idempotency fix

- `migrations/0009_impenetrable_v6.sql`:
  - `vouch_entries`: add `channel_message_id INTEGER`, `body_text TEXT`. Both nullable.
  - `processed_telegram_updates`: add `bot_kind TEXT`. Composite unique on `(bot_kind, update_id)`. Backfill existing rows.
  - New table `users_first_seen (telegram_id BIGINT PK, first_seen TIMESTAMP NOT NULL DEFAULT NOW())`.
- `src/core/storage/db.ts`: pool max 5 → 10.
- `src/core/storage/processedUpdates.ts`: `markUpdateProcessed` signature change to accept `botKind`.
- `src/core/userTracking.ts` (new): `getUserFirstSeen(telegramId)`.
- Tests for processedUpdates composite uniqueness; tests for userTracking.

### Commit 4 — Channel relay (publish + capture)

- `src/core/relayPublish.ts` (new): `publishToChannelAndCapture(channelId, body, entryId) → {channel_message_id}`.
- `src/core/relayCapture.ts` (new): handler matching incoming supergroup messages with `is_automatic_forward: true` against pending DB rows.
- Wired into existing publish flow gated by `VV_RELAY_ENABLED=true` env var.
- `.env.example` adds `TELEGRAM_CHANNEL_ID`, `VV_RELAY_ENABLED`.
- Tests for both modules.

### Commit 5 — Multi-bot dispatch + locked text + wizard prose + account-age guard

- `src/server.ts`: 3-path webhook dispatch (`/webhooks/telegram/ingest`, `/webhooks/telegram/lookup`, `/webhooks/telegram/admin`). Existing `/webhooks/telegram/action` aliased to ingest for backwards compat.
- `src/core/lookupBot.ts` (new) + tests.
- `src/core/adminBot.ts` (new) + tests. `runChatModeration` invocation moves here.
- `src/core/multiBotDispatch.test.ts` (new): smoke test for 3-path dispatch.
- `src/core/archive.ts`: 5 new locked-text builders + `buildPreviewText` shape change.
- `src/core/archiveUx.test.ts`: locked-text assertions for all new builders.
- `src/telegramBot.ts`: wizard prose-collection step, account-age guard at wizard start, dual-register fallbacks for lookup/admin commands when their tokens unset.
- `.env.example`: `TELEGRAM_LOOKUP_TOKEN`, `TELEGRAM_ADMIN_TOKEN`, `TELEGRAM_ADMIN_USER_IDS`.
- `package.json` test script: append new test files.

### Commit 6 — Member-list export script

- `scripts/exportMemberContacts.ts` (new): admin-only script per §6.1.
- `package.json` adds `npm run export:members`.
- Documented in opsec.md §14.

### Commit 7 — Mass-forward replay capability (§4.5)

- `migrations/0010_replay_log.sql`: new table `replay_log (id BIGSERIAL PK, replay_run_id UUID, source_chat_id BIGINT, source_message_id INTEGER, destination_chat_id BIGINT, destination_message_id INTEGER, replayed_at TIMESTAMPTZ DEFAULT NOW())` with unique index on `(replay_run_id, source_chat_id, source_message_id, destination_chat_id)` for idempotency.
- `src/core/replayToTelegram.ts` (new): `replayChannelArchive(sourceChannelId, destinationChatId, options) → ReplayResult`. Uses Bot API `forwardMessages` (plural) batched up to 100 ids per call. Throttle to ≤25 msgs/sec broadcast to stay under the 30/sec cap with margin. Idempotent via `replay_log`.
- `scripts/replayToTelegramAsForwards.ts` (new): operator CLI wrapping the above.
- `package.json` adds `npm run replay:to-telegram`.
- Tests: idempotency (rerun skips already-replayed); rate-limit handling (HTTP 429 → backoff per `retry_after`); batch boundaries (last batch <100 ids).
- Documented in opsec.md §11 channel-pair operator setup as the canonical recovery procedure.

### Honest scope

Each commit is independently green (`npm test` + `npx tsc --noEmit`). Commits 1–3 are firm session goals. Commits 4–7 are stretch. If context tightens or test failures cascade, stop after commit 3 and use `/superpowers:executing-plans` to continue from there.

Commits in dependency order:
- 1, 2 are doc-only and can ship today
- 3 (DB) blocks 4, 5, 6, 7
- 4 (channel relay) blocks 7 (replay needs published channel posts to forward)
- 5 (multi-bot) is independent of 4, 6, 7 functionally — can land before or after
- 6 (member-list export) is independent of all the others except the DB schema

Suggested rollout: 1 → 2 → 3 → 4 → 6 → 5 → 7. Allows verifying channel-pair end-to-end (commit 4) before adding multi-bot complexity (commit 5).

---

## §12 What's explicitly NOT in v6

For clarity, items the user might expect but which v6 deliberately does not include:

- ❌ **Userbot under the operator's personal account.** Burner-account opt-in only (§3.4); never the operator's own user.
- ❌ **Userbot enabled by default.** §3.4 makes it an opt-in addendum — disabled in default deployment. Default = Bot API only.
- ❌ Sister groups / federated multi-group ecosystem. Single community.
- ❌ Folder distribution. KB:F4.3 — leaked folders are the attack vector.
- ❌ Mandatory training modules for new members. KB:F5.5 — TBC's response to repeat takedowns at 800-member scale; not warranted at our scale until we have similar history.
- ❌ Sacrificial / disposable sister groups. Single community.
- ❌ Cover-naming groups as civic landmarks. KB — TBC's threat model, not ours.
- ❌ Bursty timing jitter. KB:F3.1 — TBC is bursty and survives because of structural isolation, not timing.
- ❌ Per-post fingerprint randomization beyond what free-form prose body provides.
- ❌ More than 5 bots in v6 (§3.4). The opt-in burner userbot is not counted in the 5-bot limit because it's an addendum, not a default-stack member.

If any of these become warranted later, they get their own brainstorm + spec from a clean slate.

---

## §12.5 Internal-consistency audit (anti-adhoc check)

This section exists to make the spec self-auditing. Every architectural choice in v6 must trace back to either (a) a verified fact in `docs/research/tbc26-knowledge-base.md`, or (b) a verified Bot API capability (KB:F2.13). Anything that doesn't trace = adhoc, must be either evidenced or removed.

| v6 element | Traces to | Status |
|---|---|---|
| Forum-mode supergroup with 4 topics | KB:F1.2 (TBC has 13 topics — we trim to 4 for our scope) | ✅ |
| Channel-pair architecture | KB:F2.3 (END ROAD WORK survived after supergroup nuked) + KB:F2.13 (Bot API auto-forward produces same shape as TBC's userbot) | ✅ |
| 3 custom bots (ingest/lookup/admin) | KB:F4.1, F4.2, F4.3 (TBC's 3 takedowns each involved bot-account-level damage = single-point-of-failure argument for split) | ✅ |
| Off-the-shelf captcha + SangMata | KB:F2.1 (TBC uses GroupHelp variants + SangMata as community-facing OSINT) | ✅ |
| Free-form prose body in published vouch | KB:F2.10–F2.11 (TBC's actual vouch shape is loose-templated free-form, no curation/sanitization) | ✅ |
| `#<id>` footer only, no structured heading in published post | KB:F2.10 inferred from §1.10 sample of TBC vouch shapes | ✅ |
| 800-char prose cap | Math derived from Telegram's 4096-char message ceiling + worst-case HTML escape; existing 3900-char safety margin in `archive.ts withCeiling` | ✅ |
| Account-age guard (24h+) at wizard | KB:F5.6 (TBC explicitly waits 24h before vouching new accounts) | ✅ |
| Member-list export script | KB:F5.1 (BALFROCAK direct quote: "Member lists of a group hold more value and benefits") | ✅ |
| Single Request-to-Join invite link, no folder | KB:F4.3 (folder leak was the attack vector that hit TBC's sister groups) | ✅ |
| 4 gating layers (username + captcha + manual approval + account-age) | KB:F5.7 (username-required gate verified) + composition with §5 (account-age) | ✅ |
| Growth pacing (10–20/day initial, 50/day established) | KB:F5.2 (BALFROCAK's growth-vs-survival tradeoff acknowledgment) + scaled to our context | ✅ |
| Light-touch moderation (no expansion of lexicon) | KB:F (deletion archaeology + chat-moderation calibration) | ✅ |
| Migration burst via `forwardMessages` | KB:F2.10 (TBC bulk-forwards on rebrand days) + KB:F2.13 (Bot API `forwardMessages` is the equivalent mechanism) | ✅ |
| Burner-userbot opt-in addendum | KB:F2.13 (Bot API equivalences identified one gap: cross-group reading) + §3.4 burner-account isolation rationale | ✅ |
| Bot rotation as routine, not emergency | KB:F5.3 (BALFROCAK direct quote: "New balf bot was put into action the other day. Previous one was deleted intentionally.") | ✅ |
| ToS-literate operator habit | KB:F5.4 (BALFROCAK msg 29471: "One post. One post can wipe this whole operation.") | ✅ |
| TBC monitoring habit (re-export every 3 months) | KB:§7 re-read protocol | ✅ |
| Locked V3.5 text discipline | Existing V3 spec convention; tested via `archiveUx.test.ts` | ✅ |
| `bot_kind` on `processed_telegram_updates` for multi-bot idempotency | Bot API per-bot update_id sequences = collision risk under multi-bot | ✅ |
| `users_first_seen` table | Required for §5 account-age guard implementation | ✅ |
| `replay_log` table | Required for §4.5 migration burst idempotency | ✅ |
| `/healthz` per-bot status + stale-relay-row counter | Required for ops visibility under multi-bot + relay capture failure-mode detection | ✅ |
| Pool size 5 → 10 | 3 bots × max-connections of 10 each via setWebhook = need headroom; existing migrator pool is separate | ✅ |
| Lexicon `regex_buy_shape` + `regex_offer_with_contact` | KB:F2.16 (solicitation has 2 directions: buy + sell) + KB:F2.17 (existing lexicon catches only 18% of QLD Chasing) | ✅ |
| FP-rate verification gate (<0.5% TBC26, >70% QLD Chasing) | KB:F2.14 (TBC has 1 solicitation in 25,871) + KB:F2.15 (Chasing as positive corpus) | ✅ |
| `buildModerationWarnText` locked-text builder | V3.5 amendment pattern from §4.4 + grounding in existing inline DM strings in chatModeration.ts | ✅ |
| Admin bot privacy mode OFF | Edge case H: admin bot can't moderate with privacy ON (privacy ON limits to commands+mentions only); same posture as ingest bot per §9.1 | ✅ |
| Multi-bot moderation handoff via env-var gate | Avoid double-moderation during rollout; v6 §3.1 dual-register fallback pattern | ✅ |
| No appeal UI / no /restore command | KB grounding: BALFROCAK doesn't have one (CLAUDE.md: "operators handle persistent abusers manually via Telegram-native UI") | ✅ |

**No adhoc elements remain.** If any reader sees a v6 prescription that's not in this table, flag it as adhoc and either trace it to a KB fact or remove it.

**What adhoc looks like (and what we avoided):**
- "Add randomized timing jitter on each post" — would have no KB trace; explicitly excluded in §12.
- "Sanitize drug-words from published vouch body" — would contradict KB:F2.11 (BALFROCAK doesn't filter); explicitly excluded in §4.0 framing correction.
- "Bot-fronted captcha-as-a-service" — would duplicate GroupHelp's role; explicitly excluded in §3.4.
- "Cover-naming groups" — would copy TBC's culture without their threat model; explicitly excluded in §12.

---

## §13 Verification (post-implementation)

- `npx tsc --noEmit` clean.
- `npm test` all green (existing + new tests).
- Manual: with `VV_RELAY_ENABLED=false` and lookup/admin tokens unset, bot behaves byte-identically to pre-change (full backwards compat).
- Manual: with full env populated and operator setup done, end-to-end:
  - Reviewer DMs ingest bot → wizard collects target/result/tags/prose → bot posts to channel → channel auto-forwards into supergroup General topic → DB row at `status='published'` with both ids set.
  - Member in supergroup runs `/search @vendor` → lookup bot responds in Lookups topic with structured archive list.
  - Admin DMs admin bot `/freeze @user` → freeze applies, audit row in `admin_audit_log` tagged with admin bot's identity.
  - Member with account first-seen <24h ago tries to vouch → wizard rejects with `buildAccountTooNewText()`.
  - `npm run export:members` produces a CSV with all members.

---

## §14 What this doc is

A stable architecture target. v1–v5 churned because each session learned new things and tried to immediately translate findings into code. v6 freezes the target, derived from the now-permanent KB.

Future re-exports of TBC update the KB additively (KB:§7 protocol). They might add new defensive patterns; they will not invalidate v6's foundation, because v6 is grounded in TBC's *surviving* practices, not their experimental ones.

When the user authorizes implementation, §11 is the order. Until then, v6 is the contract.
