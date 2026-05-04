# VouchVault v9 — simplification toward TBC shape

**Date:** 2026-04-27
**Status:** spec, not a plan. Sign off before implementation.
**Supersedes:** v6 §3 (DM-wizard publish flow), v6 §4.1 (templated channel-relay publish), v8.0 wizard-flow scope.
**Preserves:** v6 §1 (impenetrability properties), v6 §2 (group/channel topology), v6 §4.5 (recovery via `replay:to-telegram`), v8.0 channel-pair backup posture, v8.1 §18–§20 OPSEC posture.
**Grounded in:** `docs/research/tbc26-knowledge-base.md` — KB:F2.5, F2.6, F2.7, F2.8 (curated-relay = the survival publish architecture).

---

## §1 Why v9

v8.x assumes the bot is the publisher: reviewer DMs the bot, wizard collects target/result/tags, bot generates a templated `POS Vouch > @target / From: / Tags: / #id` post, sends it to the group (and optionally to a paired channel that auto-forwards back via discussion-link).

That is **not** how TBC runs. KB:F2.5 documents TBC's actual publish architecture: members write freely in topics, admins curate by forwarding selected member messages into structured archive topics. Anonymous-admin or userbot identity preserves attribution while shielding the curator. **Zero templated bot-authored posts.** The 86.8% `from: TBC26` share on the 9,585 forwards is anonymous-admin/userbot relay of member content, not bot-generated text.

VouchVault's templated-publish path is an architectural divergence from the survivor. Even at low volume, fixed-grammar bot output is a classifier-fingerprintable shape — the same family of risk that took down V3 at scale. Owner's stated goal is to *strip* complexity and converge on TBC's shape, while keeping a backup mechanism so a group takedown does not lose the archive.

v9 strips the bot's publish role and reorients the bot as a **search + admin + moderation tool only.** Members post vouches as normal group messages. Bot mirrors group messages into a backup channel via `forwardMessage`. Legacy V3 archive stays accessible via DM `/lookup`.

---

## §2 Architecture (one diagram)

```
        Member                         Vouch Group                       Backup Channel
          │                                  │                                  │
          │  posts vouch as plain msg        │                                  │
          ├─────────────────────────────────▶│                                  │
          │                                  │                                  │
          │                          ┌───────┤                                  │
          │                          │ Bot reads (privacy-OFF)                  │
          │                          │ ─ runs lexicon moderation               │
          │                          │ ─ forwardMessage to channel ───────────▶│
          │                          │ ─ optional: writes DB row*              │
          │                          └───────┤                                  │
          │                                  │                                  │
          │  /lookup @user (DM to bot)       │                                  │
          ├─▶ Bot ──▶ DB ──▶ DM reply        │                                  │
          │       (legacy V3 archive)        │                                  │
```

`*` DB row writing for new vouches is **out of scope for v9 v1**. Discuss in §7 (deferred).

---

## §3 What gets deleted

All of the following are removed:

- **DM wizard state machine** — the multi-step prompts that collect target, result, tags, prose. Files: most of the wizard logic in `telegramBot.ts`, all wizard-prompt builders in `archive.ts`.
- **Templated publish path** — `buildArchiveEntryText`, `fmtVouchHeading`, `buildPreviewText`, `buildPublishedDraftText`, `buildChannelPostBody`. The on-the-wire `POS Vouch > @target / From: / Tags: / #id` shape ceases to exist.
- **Wizard-flow welcome/pinned-guide copy** — `buildWelcomeText` and `buildPinnedGuideText` get rewritten to describe the new flow ("post vouches as normal messages"). `buildBotDescriptionText` and `buildBotShortDescription` get rewritten to describe the bot's reduced role.
- **`/start` wizard entry-point** — DM `/start` now responds with a brief explainer ("post vouches in @<group>; DM `/lookup @user` to search legacy archive") instead of starting a wizard.
- **Channel-relay templated publish** — `relayPublish.ts`'s send-to-channel-as-templated-post is replaced by forward-of-group-message (§4).
- **Wizard-related callbacks** — anything in `callbackData.test.ts` covering wizard buttons can be deleted.
- **Wizard tests** — `archiveUx.test.ts` tests covering wizard prose, preview, and published-draft text.

Estimated diff: ~30% reduction in `telegramBot.ts`; ~50% reduction in `archive.ts`; full deletion of wizard-prompt files.

---

## §4 What gets repurposed — backup channel via `forwardMessage`

`relayPublish.ts` is repurposed (or replaced) to do one job: **mirror group messages into the backup channel.**

### §4.1 Trigger
- Every `message` update in the configured vouch group(s) where `from.is_bot === false` and `via_bot` is unset.
- Optionally skip messages flagged by `runChatModeration` (already-deleted lexicon hits should not be archived).
- Skip the bot's own messages (already excluded by `is_bot` check).

### §4.2 Mechanism
- Bot calls `forwardMessage(from_chat_id=<group>, to_chat_id=<channel>, message_id=<id>)`.
- `forwardMessage` preserves attribution: the channel post displays `forwarded from <member>` with the original timestamp and message body intact. **No bot-authored text.**
- Recommended over `copyMessage`: forward-shape is the survival pattern per KB:F2.5; copy-shape (anonymized) gives up the classifier-friendly forward fingerprint for no real privacy gain (the member already posted publicly in the group).

### §4.3 Failure handling
- 429: standard `withTelegramRetry` already covers this.
- 403 (bot kicked from channel): log, alert via `/healthz`, do not block the message in the group.
- Channel-gone: same as 403; bot keeps running, mirror is degraded.

### §4.4 Idempotency
- Mirror is best-effort. If the same group message is processed twice (webhook retry), Telegram will create two channel forwards. Track `(chat_id, message_id) → channel_message_id` in a new table `mirror_log` with a unique constraint to skip duplicates.

### §4.5 Volume
- Real-time, one-call-per-group-message. Volume = group activity. No bulk publishing ever. Structurally cannot reproduce the V3 vector.

---

## §5 What gets unlocked — `/search` for members (v9.x amendment)

> **v9.x amendment (2026-05-04):** Group `/search` (and its alias `/lookup`)
> opens to members alongside DM. NEG counts and entries are visible to all
> viewers — only `private_note` (admin-attached note) stays admin-only.
> The group reply is summary-only; the "View full" expansion always
> renders in the bot DM via a `t.me/<bot>?start=…` deep-link, so detail
> never lands in the group chat. Original v9 spec said group stayed
> admin-only and members were filtered out of NEG visibility — that
> shape is superseded by this amendment.

- **Group `/search`** — opens to members. Member-scope view (private_note
  hidden); admins keep the full audit when they hit the same surface.
  Reply is summary-only; expansion buttons are URL deep-links into the
  bot DM, so detail (POS / MIX / NEG rows) never appears in the group.
  If the bot username can't be resolved (transient lookup failure), the
  expansion button is omitted entirely — never a callback fallback.
- **DM `/search`** — opens to all users. Reply is also summary-only by
  default; the "View full N vouches" callback button expands to the full
  list inside the same DM. Returns:
  - All published vouches for the target (POS, MIX, NEG)
  - Tags, sentiment, reviewer @handle, date
  - **Excludes** `private_note` (admin-only)
- Member rate-limit: 1 lookup per 5 seconds per user (token-bucket already exists in tooling). Prevents scraping spikes; not a hard wall.

The DB rows backing this are the legacy V3 import (already correct: `status='published'`, `published_message_id IS NULL`). As the new group fills with native member posts, group native search (top-of-group bar) covers the new content; `/lookup` covers legacy + cross-references.

> **v9.x amendment (2026-05-04, /guide):** `/guide` is now a member-facing surface alongside `/search`, `/me`, `/forgetme`, `/policy`. DM-only how-to (4 categories × 4 leaves), navigated by inline-keyboard with edit-in-place. Group `/guide` replies with a single deep-link button into the DM. Cross-linked from the auto-delete warn DM (`📖 Why? →` → `/start guide_grp_posts`) and the empty-result `/search` footer. Welcome / pinned / bot-profile copy adds one line each. No DB, no admin gate.

> **v9.x amendment (2026-05-04, vouch_* lexicon removal):** `chatModerationLexicon.ts` previously carried three regexes (`vouch_heading`, `vouch_for_username`, `vouch_shorthand`) inherited from the v6 architecture, when the DM wizard was the only sanctioned vouch-publish path. v9 inverted that rule — members post vouches as plain group messages, that's the load-bearing product. The regexes auto-deleted exactly the content the welcome instructs members to post. Removed 2026-05-04, with a regression-guard test asserting member-typed `Pos vouch @x` / `Neg vouch @y` / `+vouch @z` shapes do NOT match the lexicon. The lexicon now only catches marketplace claims, scam phrases, off-platform contact, and price/quantity shapes — not the act of vouching.

---

## §6 What stays unchanged

- **Webhook + idempotency** (`processed_telegram_updates`, `reserveTelegramUpdate` / `completeTelegramUpdate`) — unchanged.
- **Retry + typed errors** (`withTelegramRetry`, `typedTelegramErrors`) — unchanged.
- **Logging + redaction** (pino `createLogger`) — unchanged.
- **Chat moderation lexicon** (`chatModeration.ts`, `chatModerationLexicon.ts`) — unchanged. Still privacy-OFF (mirror needs message visibility too — same scope).
- **Admin commands + audit log** (`/freeze`, `/unfreeze`, `/lookup`, `recordAdminAction`) — unchanged.
- **Legacy import** (`replayLegacyTelegramExport.ts`) — unchanged. Still DB-only, never publishes.
- **v6 recovery tool** (`replay:to-telegram`) — unchanged. Now even more important: if the group dies, the **backup channel** is the source the recovery tool forwards into a new group. Channel-pair survival pattern.
- **`/healthz` and `/readyz`** — `/healthz` adds a `mirror.last_forward_at` field; `/readyz` adds a check that bot has post permission in the backup channel.
- **OPSEC posture v8.1 §18–§20** — unchanged.

---

## §7 Deferred (out of scope for v9 v1)

These are real questions but explicitly **not** in this spec. Each gets its own decision later:

- **DB row creation for new (member-posted) vouches.** Without a wizard, target/result/tags don't get parsed automatically. Options:
  - Admin curate command: admin replies to a member's vouch with `/archive`, bot extracts target (first `@username`) + sentiment heuristic + writes DB row tagged `admin_curated`. Cheap. Worth it once new-vouch volume justifies.
  - LLM extraction: bot parses vouch shape from natural language. Heavier; defer until volume + budget justifies.
  - Do nothing: `/lookup` only ever returns legacy V3 data. Acceptable v9 v1 posture.
- **Topic-based group structure** (KB:F2.6 forum-mode supergroup with multiple topics: NEW VOUCHES / SCAMMER REPORTS / DISCUSSION). v6 §2.1 specs this; v9 inherits the open question. Not blocking v9 v1.
- **Multi-bot split** (v6 §3.2: ingest / lookup / admin separation). The reduced bot surface in v9 weakens the case for splitting; revisit when surface grows.

---

## §8 Risk delta vs current

| Risk | Current (v8.x) | v9 |
|---|---|---|
| Templated-bulk-publish vector (V3) | Closed for replay; live wizard still produces templated posts at low volume | **Structurally impossible.** No bot-authored posts. |
| Classifier fingerprint of bot output | Bot output every wizard publish (low volume but fixed grammar) | None. Bot only forwards. |
| Group takedown loses archive | Channel-pair backup exists | Channel-pair backup exists, populated by `forwardMessage` instead of templated send |
| Member archive scraping | Admin-only `/lookup`, no member access | Member DM `/lookup` rate-limited; new exposure surface but data was already public in group |
| `/lookup` DB out-of-date | DM wizard kept DB current | DB stale for new vouches until §7 deferred decision; legacy data unchanged |
| Lexicon moderation | Working | Unchanged |
| Recovery from group takedown | Operator-driven via `replay:to-telegram` | Same path; backup channel is source as before |

Net: **v9 reduces takedown surface by deleting the templated-publish vector entirely**, at the cost of losing structured-tag DB updates for new vouches (deferred per §7).

---

## §9 Implementation order (high-level — full plan in a separate doc)

1. **Mirror-first, wizard-still-on.** Add `mirror_log` table + `forwardMessage` mirror path. Keep wizard alive. Verify backup channel populates correctly. (Reversible if `forwardMessage` behaves unexpectedly.)
2. **Open DM `/lookup` to members** + add rate-limit. Verify legacy data is searchable end-to-end.
3. **Delete wizard.** Remove DM-wizard state machine, templated builders, wizard tests, wizard callback prefixes. Update welcome/pinned-guide copy. Delete `relayPublish.ts`'s templated-send branch (mirror-via-forward replaces it).
4. **Update OPSEC + DEPLOY runbooks.** §18 (group type), §19 (privacy), §20 (audit) — ensure they reflect "members post; bot mirrors + searches + moderates."
5. **CLAUDE.md updates.** Remove "DM flow state machine," "wizard," "preview/draft" terminology. Add "member-post + bot-mirror" architecture summary.

Each step is a separate PR. Merge order is the order above; each merge leaves the system in a working state.

---

## §10 Decisions locked (2026-04-27)

- **Mirror mechanism: `forwardMessage`** — preserves member identity, matches TBC's survival shape (KB:F2.5). `copyMessage` rejected; data was already public in the group, no privacy gain.
- **DB rows for new (member-posted) vouches: not in v9 v1.** `/lookup` returns legacy V3 archive only. Native group search handles new content. Admin `/archive` curate command deferred per §7 until member-vouch volume justifies it.

Both calls follow the smallest-diff principle: ship the simplification, observe, add the curate command later only if needed.
