# VouchVault — Full Redesign & Hardening Spec

_Date: 2026-04-25. Author: Claude Opus 4.7 with jbot-bit. Status: DRAFT for user review._

This document is the single source of truth for the next round of work on VouchVault. It covers every user-facing surface, every edge case I could enumerate, the legacy-replay improvements that never landed, and the platform migration. It is designed to be implementable as one cohesive plan via the `writing-plans` skill.

All Telegram facts cited below come from the official docs at `core.telegram.org/bots/*`. Non-official claims are explicitly labelled.

---

## 1. Goals & non-goals

**Goals**

1. Make the live bot UX feel professional and predictable — every message follows one tone, every button does what its label says, every error tells the user what to do next.
2. Align every Bot API call with Telegram's official guidelines (formatting, rate limits, callback acks, allowed updates, secret-token verification).
3. Land the legacy-replay improvements Replit prototyped (numeric `from_id` fallback, expanded sentiment patterns, bot-sender filter, throttle, `--max-imports`).
4. Migrate hosting from Replit to Railway. The repo, server, schema, and scripts already work on any Postgres + Node 20 host; this is a deploy-doc + secret-management swap.
5. Surface every cross-cutting failure mode as a deliberate code path (bot blocked, bot kicked, Telegram 429, DB outage, webhook timeout, deleted account selected as target, etc.).

**Non-goals**

- Renaming `src/mastra/` (cosmetic, deferred per HANDOFF.md).
- Switching from `node --experimental-strip-types` to a build step.
- Building a Web App / Mini App. Inline keyboards + reply keyboards remain the only UI primitives.
- Pinning dependency versions (separate, low-priority follow-up).

---

## 2. Bot identity

Telegram exposes three text fields per language; current state vs. proposed:

| Field | Limit (official) | Where it surfaces | Current | Proposed |
|---|---|---|---|---|
| Name (`setMyName`) | 0–64 | Header in chat list / profile | unset (BotFather default) | `Vouch Hub` |
| About (`setMyShortDescription`) | 0–120 | Profile page, share preview, suggestions | "Vouch hub for local businesses. Submit in DM from the group launcher. Lawful use only." (118 chars) | "Vouch Hub — log and verify local-business service experiences. Open from the group launcher." (~95 chars) |
| Description (`setMyDescription`) | 0–512 | Empty-chat splash before first `/start` | One paragraph, ~370 chars | Three short lines (see §2.1) — easier to scan on a phone |

Sources: `core.telegram.org/bots/features` (description ≤ 512, about ≤ 120). Name length is industry-known 0–64; verify at `core.telegram.org/bots/api#setmyname`.

### 2.1 Proposed description copy

```
Log and verify local-business service experiences with the community.

How it works: tap Submit Vouch in the group → DM the bot one @username → choose result + tags → I post a clean entry back to the group.

Lawful use only — follow Telegram's Terms of Service.
```

### 2.2 Bot picture

Out of scope for this spec (deferred, BotFather upload). Note this in handoff.

---

## 3. Commands by scope

Telegram supports per-scope command lists via `setMyCommands` (`scope.type` = `default`, `all_private_chats`, `all_group_chats`, `all_chat_administrators`, `chat`, `chat_administrators`, `chat_member`). Source: `core.telegram.org/bots/features#commands`.

Telegram explicitly recommends supporting `/start`, `/help`, `/settings` "where applicable" (`bots/features`).

### 3.1 Final command matrix

| Command | Default | Private | Group (member) | Group (admin) | Description |
|---|---|---|---|---|---|
| `/start` | — | hidden¹ | — | — | (deep-link entry only; does not appear in command menu) |
| `/vouch` | — | ✓ | — | — | Start a new vouch entry |
| `/help` | ✓ | ✓ | ✓ | ✓ | How the Vouch Hub works |
| `/recent` | ✓ | ✓ | ✓ | ✓ | Show the 5 most recent entries |
| `/lookup` | — | ✓² | — | ✓ | Look up entries for an @username |
| `/cancel` | — | ✓ | — | — | Cancel your in-progress draft |
| `/freeze` | — | — | — | ✓ | Freeze an @username (no new entries) |
| `/unfreeze` | — | — | — | ✓ | Unfreeze an @username |
| `/remove_entry` | — | — | — | ✓ | Remove an entry by id |

¹ `/start` is the Telegram-default entry point and does not need to be in the menu — Telegram already routes `t.me/<bot>?start=<payload>` to it. (`bots/features#deep-linking`.)

² **Bug found in current code** (`src/telegramBot.ts:267`): `/lookup` is exposed in the private command list but the handler does not gate on `isAdmin()` — only the **error string** says "limited to admins." Decision: `/lookup` is **public to anyone in DM**, public to admins in groups. The error message will be rewritten to remove the false claim.

Admin commands (`/freeze`, `/unfreeze`, `/remove_entry`, `/frozen_list`, `/admin_help`) **continue to work in DM** for whitelisted admins (per `TELEGRAM_ADMIN_IDS`), but only appear in the command menu under the `all_chat_administrators` group scope. Telegram has no per-user-DM scope mechanism without explicitly enumerating each admin's private chat by id, which is operationally fragile — admins memorising the commands (or using `/admin_help`) is the simpler path.

### 3.2 Edits vs. current

- Add `/cancel` (currently no in-text way to cancel without tapping the inline Cancel button).
- Drop `/verify` from the threaded-launcher reply set in `telegramUx.ts:7` — it's never registered as a command but the bot replies to it, which is misleading.
- Add `/admin_help` so admins don't have to memorise the admin command list.

---

## 4. DM flow

### 4.1 Happy path (4 messages, all same DM)

1. **Entry**: user taps **Submit Vouch** in the group (URL deep link `t.me/<bot>?start=vouch_<chatId>`). Telegram opens DM and pre-fills `/start vouch_<chatId>`.
2. **Step 1/3 — Target**: bot replies with target prompt + reply-keyboard `request_users` button labelled **Choose Target**. User can either tap the button (Telegram-native user picker) or type `@username`.
3. **Step 2/3 — Result**: bot edits the prompt message in place to show three result buttons (Positive / Mixed / Negative) plus Cancel.
4. **Step 3/3 — Tags**: bot edits to show the 4 tags allowed for that result, multi-select (✓ prefix), Done, Cancel.
5. **Preview**: bot edits to show preview + Publish + Cancel.
6. **Posted confirmation**: bot edits to show "✓ Posted to the group" + Start Another Vouch button.
7. **In-group**: a fresh `Entry #N` message appears, the previous launcher is deleted, a new launcher message replaces it under the new entry.

Per Telegram's official UX guidance ("edit your keyboard when the user toggles a setting button or navigates to a new page – this is both faster and smoother than sending a whole new message", `bots/features`), the entire DM flow operates on **one bot message** that is edited at each step.

### 4.2 Reply markup choices

- **Step 1 (target)**: reply keyboard with `KeyboardButtonRequestUsers` (`request_users`, `user_is_bot=false`, `max_quantity=1`, `request_username=true`). Shows under the input. `one_time_keyboard=true`. This is unchanged from current.
- **Steps 2–4 (result/tags/preview)**: inline keyboard attached to the edited bot message. No reply keyboard visible. `buildReplyKeyboardRemove()` is sent **once** in step 2 alongside the inline keyboard so the reply keyboard from step 1 disappears (verify the current code does this; if not, add it — the reply keyboard will otherwise remain stuck on screen).
- **Confirmation**: inline keyboard with **Start Another Vouch** + (new) **View this entry** URL button that links to the published group message via `t.me/c/<chatPart>/<messageId>`. Useful for users who want to share or screenshot.

### 4.3 Edge cases enumerated

| # | Scenario | Current behaviour | Proposed |
|---|---|---|---|
| E01 | User has no public `@username` | "You need a public Telegram @username to create a vouch entry." (no recovery) | Same message + a brief inline tip: "Set one in Telegram → Settings → Username, then tap Start Another Vouch." |
| E02 | User shares a target with no `@username` via the user picker | "The selected account needs a public @username." with the picker still open | Keep behaviour, but also add a fallback message after 2 failed picks: "Or send the @username as text." |
| E03 | User types something that isn't a username | Re-prompt with parser error string + button | Keep, but make sure the parser error string itself is consistent (currently `parseTypedTargetUsername` returns terse codes; surface a single line: "Send only one @username — letters/digits/underscore, 5–32 chars.") |
| E04 | User self-targets | "Self-vouching is not allowed." + button | Keep |
| E05 | Target is frozen | "<@target> is currently frozen and cannot receive new archive entries." + button | Keep, drop the word "archive" — call them "vouches" everywhere user-facing |
| E06 | Reviewer already vouched same target within 72h | "You already posted a recent archive entry for that target. Try again later." | Show **when** they can try again: "Cooldown active — you vouched <@target> on YYYY-MM-DD. Try again after YYYY-MM-DD." |
| E07 | Draft expired (24h) | "Your last draft expired. Start again." + Start Another Vouch button | Keep |
| E08 | User taps a button on an old preview after a different draft was started | The current code refetches `latestDraft` for tag/done/confirm; result/cancel may use stale state | Always refetch the draft inside the lock and validate `step` matches the action — if not, answer the callback with "This draft is no longer current" and edit the old message to match new draft state |
| E09 | User taps Publish on a draft whose target group is no longer in `TELEGRAM_ALLOWED_CHAT_IDS` | Already handled (`isAllowedGroupChatId` check) — alert + restart prompt | Keep |
| E10 | Bot is blocked by the user mid-flow | `sendTelegramMessage` throws (403) and the webhook returns 500; Telegram retries forever | Add a typed error from `telegramTools` (`TelegramForbiddenError`); on `forbidden` from `bot blocked by user`, swallow + clear the user's draft + log info, do not retry |
| E11 | Bot is kicked / demoted from the target group between draft start and Publish | Publish currently posts to the group via Bot API, which returns 400 "chat not found" or 403 "bot is not a member"; we don't catch | Catch group-level `forbidden` / `bad_request`, alert the user "I lost access to the group. Notify an admin and try again later.", do not delete the draft so an admin can republish later |
| E12 | Telegram returns 429 mid-flow | Throws; webhook 500; Telegram retries | Wrap every Bot API call in a single throttle/retry helper. On 429, sleep `retry_after` seconds then retry once. If second attempt 429s, surface a friendly "Telegram is rate-limiting us — try again in a minute" callback alert. |
| E13 | Postgres outage | Webhook 500; Telegram retries | Keep (Telegram retries are correct behaviour — we do not want to lose updates) |
| E14 | User opens deep link from group A's launcher but the launcher button still embeds an old, demoted chat ID | Draft is created with a stale `targetGroupChatId`; Publish later fails with E11 | At deep-link time, validate against the live allowlist; if invalid, message "That launcher is from an old group — open the current launcher in <group name>." (admin freeze workflow can leverage this) |
| E15 | Two parallel users share a target user simultaneously | `withReviewerDraftLock` is per-reviewer, not per-target — independent draft state survives, both can publish, the second one trips duplicate cooldown only if it's the same reviewer; otherwise both publish | Keep — this is correct behaviour. Two reviewers vouching the same target is fine. |
| E16 | User's `@username` changes between draft start and Publish | Draft stores `reviewerUsername` snapshot; we re-derive at publish from `callbackQuery.from.username`; if it changed, we use the new one | Keep, but also write to the `users` table on every update so the latest username is persisted |
| E17 | User selects a bot account as target via the picker | `request_users` already filters with `user_is_bot=false` | Keep |
| E18 | User selects a deleted/anonymous account via the picker | Picker returns `username: null` for the shared user | Already handled — "needs a public @username" |
| E19 | Two callbacks fire on the same draft within milliseconds (e.g. user double-taps Publish) | `withReviewerDraftLock` is `SELECT FOR UPDATE`-style; second one queues; second one sees `step=preview` still and may publish a duplicate | After publish success we `clearDraftByReviewerTelegramId` inside the lock — second call should see `null` draft and exit gracefully. Verify and add a test. |
| E20 | User edits a target message that they sent (Telegram allows edits) | We don't subscribe to `edited_message` updates so we ignore | Keep — `allowed_updates` will not include `edited_message`, documented choice |
| E21 | User sends a photo or sticker as their target | `text` is empty, we return early | Keep |
| E22 | Draft cleanup fails after a successful publish | Logged as warn; user sees Posted; their next action will fall through to "Use the buttons in your current draft" | Acceptable. Add a periodic janitor to nuke expired drafts (already exists via `runArchiveMaintenance` every 200 updates). |
| E23 | User opens deep link with payload `vouch_<id>` for a chat ID they're not a member of | Bot still creates the draft (we don't verify membership) — Publish later may succeed if the chat is in `TELEGRAM_ALLOWED_CHAT_IDS` | This is fine — VouchVault is meant for one or a few groups; allowlist gating is sufficient. Document this. |
| E24 | Callback `data` longer than 64 bytes (Telegram's hard limit, `bots/api#inlinekeyboardbutton`) | Current longest is `archive:start:-100<19-digit chat id>` = ~33 bytes. Safe. | Keep, but add a unit test that asserts every callback we generate is ≤64 bytes |

### 4.4 Decision points (require user input before plan)

- **D1**: Should `/cancel` also be a button on every step's keyboard? Currently Cancel is on Step 2/3/Preview. Adding to Step 1 too is trivial — recommend yes.
- **D2**: Should the Posted confirmation include a deep link to the published group message? (Requires storing the published `message_id`, which we already do.) Recommend yes — adds a small UX win.
- **D3**: Should `/recent` show 5 entries (current) or 10? Recommend 10 — fits in a single Telegram message and gives more context. Also: `/recent` could optionally accept `--positive` / `--negative` filters; recommend skip for v1.

---

## 5. Group flow

### 5.1 Pinned guide message

Currently `scripts/configureTelegramOnboarding.ts` posts a pinned message with HTML body + Submit Vouch URL button. The body uses HTML formatting (good — Telegram explicitly recommends HTML or MarkdownV2 over legacy Markdown, `bots/api#formatting-options`).

**Issue**: pinning sends a service message ("Bot pinned a message") which spams the chat unless `disable_notification: true` is set. Verified — current code does set `disable_notification: true` on both `sendMessage` and `pinChatMessage`. Keep.

### 5.2 Launcher message lifecycle

After every published entry, `refreshGroupLauncher`:
1. Deletes the previous launcher (`deleteMessage`)
2. Sends a new launcher with the Submit Vouch URL button

This is a **2-message-per-entry** group cost (delete + send). Telegram's per-group limit is **20 messages/minute** (`core.telegram.org/bots/faq`). With the entry message itself as a 3rd message, a sustained burst above ~6 entries/min trips the cap.

**Final approach**: keep delete-then-send (we want the launcher visually "below" the latest entry), but **debounce**. Track `launcher.updated_at` per chat; if a new entry arrives within 30 sec of the prior launcher refresh, skip the delete-and-resend (the prior launcher is still at the bottom). After 30 sec idle, the next entry gets a fresh launcher. This keeps the "always-at-bottom" UX while halving group write volume during bursts.

### 5.3 Group commands

| Command | Behaviour | Edge cases |
|---|---|---|
| `/start`, `/help`, `/vouch` | Threaded silent reply with launcher prompt + URL deep-link button | Privacy mode caveat (`bots/features`): privacy-mode-on bots only receive replies + commands explicitly addressed to them. We require privacy mode **off** OR every command must be `/cmd@yourbot`. The current code uses `command.split("@")[0].toLowerCase()`, so it tolerates both. Recommend: ask the user to set the bot's privacy mode **off** in BotFather (`/setprivacy → Disable`) since the group is locked, this is acceptable. |
| `/recent` | Threaded silent reply showing recent entries | Keep |
| `/lookup @x` | Threaded silent reply showing 5 entries for `@x` | Keep |
| `/freeze`, `/unfreeze`, `/remove_entry` | Admin-gated, threaded silent reply | Keep |

### 5.4 Group edge cases

| # | Scenario | Proposed |
|---|---|---|
| G01 | Bot is removed from the group | Webhook still receives `my_chat_member` updates if we opt in. We do not currently. **Decision**: subscribe to `my_chat_member` to record bot kicks and stop trying to refresh launchers in dead groups. |
| G02 | Group is deleted/archived | Same as G01 |
| G03 | Group converted to broadcast channel | We don't support channels. Reject in `handleGroupMessage`. |
| G04 | Group is migrated to supergroup | `migrate_to_chat_id` arrives in the message payload; we currently ignore. **Add**: persist the new chat ID and update `TELEGRAM_ALLOWED_CHAT_IDS` automatically (or at least surface a clear admin alert). |
| G05 | Topic groups (forum) | `message_thread_id` is in messages; we strip it. Recommend keeping launcher in the General topic. Document it. |
| G06 | User says `@vouchhubbot` without slash | Privacy mode + lack of trigger means we do nothing. Correct. |
| G07 | Bot mentioned but not commanded | Same — ignore. |

---

## 6. Admin flow

### 6.1 Current admin commands

- `/freeze @x`, `/unfreeze @x` — toggle a `business_profiles.is_frozen` boolean. Frozen targets reject new vouches.
- `/remove_entry <id>` — soft-deletes the entry, deletes the published Telegram message, refreshes the launcher.

### 6.2 Issues

- Admin gate uses `TELEGRAM_ADMIN_IDS` env var, **not** the actual group chat administrator list. Means a Telegram group admin who isn't in the env var has no powers. **Decision**: keep env-var gating (deliberate — the group can have many admins, only a curated subset get bot powers).
- No `/freeze` reason note. Recommend adding `/freeze @x reason text here` and storing it; show in lookup output.
- No way to view the list of currently-frozen profiles. Recommend `/frozen_list` (admin-only, group + DM).
- `/remove_entry` deletes the published message; if the message was already deleted by a Telegram admin manually, the API call 400s; we warn + continue. Keep.

### 6.3 New admin commands

| Command | Behaviour |
|---|---|
| `/freeze @x [reason...]` | Now accepts an optional reason, stored on the profile |
| `/unfreeze @x` | Unchanged |
| `/frozen_list` | Lists currently-frozen profiles with their reasons + freeze date |
| `/admin_help` | Shows the admin-only command list (so admins don't have to memorise) |

### 6.4 Admin edge cases

| # | Scenario | Proposed |
|---|---|---|
| A01 | Non-admin runs admin command in group | Threaded silent reply: "Admin only." |
| A02 | Admin runs admin command in DM | Same |
| A03 | Admin command applies to a profile that doesn't exist yet | `getOrCreateBusinessProfile` upserts — works fine |
| A04 | `remove_entry` against a non-existent id | "Entry #N not found." |
| A05 | `remove_entry` against an already-removed entry | Currently `markArchiveEntryRemoved` is idempotent — confirm and add a regression test |

---

## 7. Message formatting standard

Telegram supports `HTML`, `MarkdownV2`, and legacy `Markdown` (`bots/api#formatting-options`). Telegram does not state a preference between HTML and MarkdownV2, but **HTML is operationally simpler** for arbitrary user content (only `<`, `>`, `&` need escaping vs. MarkdownV2's 18-character escape table).

**Decision**: HTML mode everywhere, single `escapeHtml()` helper applied to every dynamic substitution (already in place). Add lint rule via a unit test that scans for raw template substitution of user input outside `escapeHtml`.

Allowed tags (per `bots/api#formatting-options`): `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<strike>`, `<del>`, `<a href="">`, `<code>`, `<pre>`, `<pre><code class="language-...">`, `<tg-spoiler>`, `<blockquote>`, `<blockquote expandable>`. No others.

### 7.1 Tone & content rules

- **Sentence case**, not Title Case, except the entry-card heading "Entry #N".
- One-line per-step prompts where possible; max 4 short lines.
- No emoji except the entry-card 🧾 (already in use). Drop the ✓ on Posted confirmation — too cute.
- No "please." Direct instructions.
- Every error ends with a recovery action ("tap Start Another Vouch" / "send /vouch" / "open the group launcher").

---

## 8. Rate-limit handling

### 8.1 Documented Telegram limits (`bots/faq`)

- **Per chat (any)**: ~1 msg/sec sustainable; bursts tolerated until 429.
- **Per group**: ≤ 20 msg/min (the binding constraint when sending into a single group).
- **Per bot global**: ~30 msg/sec (free tier).
- 429 responses include `parameters.retry_after` (seconds) — official guidance is to honour exactly.

### 8.2 Implementation

- Add `withTelegramRetry(fn, { maxAttempts: 2 })` wrapper around every Bot API call in `tools/telegramTools.ts`. On 429, sleep `retry_after`s, retry once. On second 429, throw a typed error.
- Add a per-chat token-bucket throttle for the legacy replay (3.0 sec / send, 1 token max) — 20 msg/min / 60 sec = 1 every 3 sec. Cite the FAQ in code comments.
- Live bot does **not** need pre-emptive throttling at typical user volume; reactive 429 retry is sufficient. Document this.

### 8.3 Edge cases

| # | Scenario | Proposed |
|---|---|---|
| R01 | Single-chat 429 mid-publish | Retry once after `retry_after`. If user-visible: callback alert "Telegram is busy — try again in a minute." |
| R02 | Global 30/sec ceiling hit | Should never happen at this volume. Log `warn` if we get a global 429 from a non-publish path. |
| R03 | Replay run hits 429 | The 3-sec throttle should prevent this. If it happens, `retry_after` is honoured and the throttle interval doubles for 60s ("circuit-half-open"). |

---

## 9. Webhook & delivery

### 9.1 Setup (already correct)

- `setWebhook` with `secret_token` (1–256 chars, charset `A-Z a-z 0-9 _ -`). Server verifies `X-Telegram-Bot-Api-Secret-Token` header; mismatched requests get 403. (`bots/api#setwebhook`.)
- HTTPS required, ports `443/80/88/8443` only.
- TLS 1.2+; CN matches domain.

### 9.2 Improvements

- **`allowed_updates`**: currently empty (default). The Bot API default **excludes** `chat_member`, `message_reaction`, `message_reaction_count`. We want `message`, `callback_query`, `my_chat_member` (for G01). We do **not** want `edited_message` (E20), `inline_query`, `chosen_inline_result`, `poll`, `poll_answer`, `chat_join_request`, `chat_member`, etc. Set `allowed_updates: ["message", "callback_query", "my_chat_member"]` explicitly. (`bots/api#setwebhook`.)
- **`max_connections`**: default 40. For our throughput, drop to 10 to reduce concurrent webhook handlers and align with our DB pool. (`bots/api#setwebhook`.)
- **`drop_pending_updates`**: pass `true` on every redeploy via the `telegram:webhook` script — no point processing stale updates after a code change.

### 9.3 Webhook handler hardening (server.ts)

- 200 OK as fast as possible. Telegram retries until ack — but slow handlers compound rate limits.
- Already idempotent via `processed_updates` table. Keep.
- Add request-level timeout: if the handler exceeds 25s, return 200 anyway (Telegram retries our slow updates would create a duplicate-update flood). Verify current code's behaviour against the existing `processed_updates` reservation.

---

## 10. Legacy replay improvements

### 10.1 Parser changes (`src/mastra/legacyImportParser.ts`)

Required changes:

1. **Numeric reviewer ID fallback.** When no string `@username` field resolves but the export has `from_id` as a string like `"user6812728770"` (tdesktop format — confirmed against `Telegram/SourceFiles/export/output/export_output_json.cpp` `wrapPeerId`), parse the numeric suffix and synthesise a reviewer handle of the form `user<id>` (matching `normalizeUsername`'s `[A-Za-z][A-Za-z0-9_]{4,31}` constraint — `user` + at least 1 digit ≥ 5 chars total). Use the real Telegram numeric ID as `reviewerTelegramId` instead of the synthetic FNV hash.

   Edge cases:
   - `from_id` prefix `chat`/`channel` → skip as a non-user sender (anonymous group admin posts come through as `channel<id>`).
   - `from_id` missing entirely → skip as `missing_reviewer` (current behaviour).
   - `from` field is JSON `null` (deleted account) → still synthesise from `from_id`.

2. **Bot-sender filter.** Add a `BOT_SENDER_USERNAMES` set (config-driven, defaulting to known group-help bots like `groupanonymousbot`, `combot`, `grouphelpbot`). When the resolved reviewer handle matches, skip with a new `bot_sender` reason in a new `bot_sender` summary bucket.

3. **Sentiment patterns expanded.** Adding to `POSITIVE_PATTERNS`:
   - `\bpos\s+vouch\b`
   - `\b(huge|big|mad|high|highly|solid)\s+vouch\b`

   Adding to `NEGATIVE_PATTERNS`:
   - `\bneg\s+vouch\b`
   - `\bscam(?:mer|med|ming|s)?\b`
   - `\bripped\b`, `\bdodgy\b`, `\bsketchy\b`, `\bshady\b`
   - `\bghost(?:ed|ing)?\b`
   - `\bsteer\s+clear\b`
   - `\bdon'?t\s+trust\b`

   Excluded (per D10): `legend`, `king` — too high false-positive risk in the group's register.

   Each pattern goes through the existing `(?<!not\s)` negation guard. Add a unit test per pattern: a positive sample and a negated sample.

4. **Multiple-targets handling**. Current behaviour: skip with `multiple_targets` reason → bucket `missing_target`. Replit found 486 such messages. Decision: keep skipping, but split bucket out (`bucket: "multiple_targets"`) so the operator sees them separately and can hand-review. Do **not** auto-split into multiple entries — the `(source_chat_id, source_message_id)` unique index in the DB enforces 1 entry per source message.

5. **Service messages**: already filtered (`type !== "message"`).

### 10.2 Replay script changes (`scripts/replayLegacyTelegramExport.ts`)

1. **`--max-imports N` flag** — stop after N successful imports. Used to do tiny live batches (5, 50) before unleashing the full set.
2. **`--throttle-ms N` flag**, default `3100` (3.1 sec, slightly above the 3.0 sec/send limit). Per-call sleep before each `sendMessage` to the live group.
3. **Honour 429 `retry_after`** in the publish loop. On 429, sleep `retry_after + 100` ms, retry once, log loudly. If second attempt 429s, abort and persist a checkpoint so the next run resumes.
4. **Resume from checkpoint** is already implemented; verify `--max-imports` interaction (if you stop at 50 with 1950 left, the checkpoint must record position so the next run picks up at 51).

### 10.3 Replay edge cases

| # | Scenario | Proposed |
|---|---|---|
| L01 | Export contains messages where `from_id` is `channel<id>` (anonymous admin posts) | Skip with new `bot_sender`-ish bucket; document |
| L02 | Two messages have the same `(source_chat_id, source_message_id)` (shouldn't happen, but…) | Unique index rejects; log + skip |
| L03 | `text` is an array of segments | `flattenLegacyMessageText` already collapses |
| L04 | Sentiment matches BOTH positive and negative | Already returns `result: null`; goes to `unclear_sentiment` |
| L05 | Negated sentiment ("not legit") | Existing `(?<!not\s)` guard; verify with test for every new pattern |
| L06 | Telegram 429 during replay | Honour `retry_after`; if persistent, persist checkpoint and exit |
| L07 | DB write fails mid-replay | Persist checkpoint at `currentIndex - 1`; next run resumes |

---

## 11. Hosting migration to Railway

### 11.1 Why Railway

Per official-doc comparison done in research (sources: railway.com/pricing, render.com/pricing, fly.io/docs/about/pricing, replit pricing):

- Railway Hobby: $5/mo flat with $5 included usage credit. Always-on (no sleeping by default). Native GitHub auto-deploy. Native managed Postgres at usage-cost (~few $/mo). Reference variables wire `${{Postgres.DATABASE_URL}}` automatically.
- Render: $7/mo + $6/mo Postgres = $13/mo minimum; first-paid web tier required to avoid 15-min sleep.
- Fly.io: cheapest in raw pricing but requires GitHub Actions for deploy and self-managed Postgres for the cheap path.
- Replit: $25 Core + $10 Reserved VM = $35/mo minimum for parity.

**Recommendation: Railway.** Lowest-friction match for plain Node + Postgres + webhook.

### 11.2 Deploy doc rewrite

`DEPLOY_REPLIT.md` → `DEPLOY.md`. Steps:

1. Sign in to Railway with the `jbot-bit` GitHub account, subscribe to Hobby ($5/mo).
2. Install Railway GitHub app, grant access to `jbot-bit/vouchvault`.
3. New project → Deploy PostgreSQL template.
4. Same project → New service → GitHub Repo → `jbot-bit/vouchvault`.
5. Service Settings → set `NIXPACKS_NODE_VERSION=22`, leave Build Command empty, set Start Command to `npm start`.
6. Variables tab → add (use `${{Postgres.DATABASE_URL}}` for the DB URL):
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_IDS`
   - `TELEGRAM_ADMIN_IDS`
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN` (generate with `openssl rand -hex 32`)
   - `PUBLIC_BASE_URL` (set after step 7)
   - `TELEGRAM_BOT_USERNAME` (optional — saves a `getMe` call at boot)
7. Settings → Networking → Generate Domain. Copy the URL to `PUBLIC_BASE_URL`. Service auto-redeploys.
8. From local shell with the same env vars: `npm run telegram:webhook`. This must call `setWebhook` with `allowed_updates: ["message","callback_query","my_chat_member"]`, `max_connections: 10`, `drop_pending_updates: true`.
9. `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide`.
10. Smoke test: tap launcher in group, complete a vouch in DM, verify entry appears + launcher refreshes.

### 11.3 Migration edge cases

| # | Scenario | Proposed |
|---|---|---|
| M01 | Postgres on Railway is fresh; existing data is on Replit | One-time `pg_dump` + `psql` restore. Document in DEPLOY.md. |
| M02 | Webhook switch leaves a window where Telegram has both URLs queued | `setWebhook` is atomic from Telegram's side — only one URL is active at a time. Drop the Replit deployment **after** Railway smoke test passes. |
| M03 | DNS propagation for custom domain | Railway issues `*.up.railway.app` immediately; custom domain is optional follow-up |
| M04 | Replit secrets not migrated | Document the full env-var list in `.env.example` and in DEPLOY.md |
| M05 | `node --experimental-strip-types` Node version drift | Pin `NIXPACKS_NODE_VERSION=22` (TS-strip is stable from 22.6+) |

---

## 12. Observability

Current state: bare `console.info` / `console.warn` / `console.error`. Per HANDOFF.md "Known gaps", structured logging is wanted.

### 12.1 Proposed

- Switch to `pino` (smallest dep, structured JSON, zero runtime overhead). Single helper `createLogger()` returns a child logger per request with `update_id` bound.
- Log levels: `info` for happy-path lifecycle, `warn` for recovered errors (E10/E11), `error` for unrecovered.
- Add a request-id header pass-through so Railway logs can be correlated.
- Add a single metric counter table or counter file (out of scope — note as future).

### 12.2 Health endpoints

- `/healthz` → `{"ok": true}` (already exists). Keep.
- Add `/readyz` → asserts Postgres pool is responsive. Returns 503 if not. Useful for Railway healthchecks.

---

## 13. Testing approach

### 13.1 What's already covered (22/22 passing)

- `archiveUx.test.ts` — archive entry rendering, preview, welcome copy, telegram UX helpers
- `legacyImport.test.ts` — parser positive/negative/conflict/negation/no-target/multi-target/no-sender/self
- `telegramBotInput.test.ts` — `parseTypedTargetUsername` accepts/rejects

### 13.2 New tests (TDD-first per superpowers conventions)

For each new behaviour:

- **`legacyImportParser.test.ts`** (or extend existing): one positive + one negated sample for every new sentiment pattern; numeric `from_id` synthesis; bot-sender filter; multi-target bucket split; deleted-account (`from: null`) handling.
- **`telegramRateLimit.test.ts`** (new): mock fetch, simulate 429 with `retry_after`, assert single retry honours the delay; assert second 429 throws typed error.
- **`telegramBot.test.ts`** (new): integration-style tests with a mock store/transport — full happy path; E08 stale-callback; E11 group-not-accessible; E10 user-blocked-bot; cancel-then-restart.
- **`callbackData.test.ts`** (new): assert every callback string we build is ≤64 bytes for any input chat ID.
- **`replayThrottle.test.ts`** (new): assert `--throttle-ms 3100` enforces the gap; assert `--max-imports 5` stops after 5; assert checkpoint resumes correctly.

### 13.3 Smoke test (manual)

- After deploy: tap launcher → complete vouch → see entry in group → see launcher refresh under it.
- `/recent` in DM and group shows latest 5/10 entries.
- `/lookup @x` in DM works; in group requires admin.
- `/freeze @x reason` then re-attempt vouch → blocked. `/unfreeze @x` then re-attempt → succeeds.
- `/remove_entry N` → published message disappears, launcher refreshes.

---

## 14. Implementation order

Each row is a discrete chunk that ends in green tests + a deployable state.

| # | Chunk | Why this order |
|---|---|---|
| 1 | Parser improvements + tests (§10.1) | No deploy required, low blast radius, validates approach |
| 2 | Replay script throttle/max-imports + tests (§10.2) | Same |
| 3 | Bot identity copy + commands (§§2,3) — code change to text-builders + onboarding script | No infra change; test via dry-run + manual |
| 4 | DM flow polish (§4) — error wording, reply-keyboard removal in step 2, callback-data length test, draft-step revalidation (E08), block-publish-on-stale-target (E14) | Pure code |
| 5 | Group flow (§5) — launcher debouncing, `my_chat_member` subscription, supergroup migration handling | Pure code; webhook needs `allowed_updates` updated when this ships |
| 6 | Admin flow (§6) — `/freeze` reason, `/frozen_list`, `/admin_help` | Pure code |
| 7 | Rate-limit handling (§8) — `withTelegramRetry`, replay 429-aware | Pure code |
| 8 | Webhook hardening (§9) — `allowed_updates`, `max_connections`, `drop_pending_updates`; `/readyz` endpoint | Code + a `setWebhook` rerun on deploy |
| 9 | Observability (§12) — pino swap | Pure code |
| 10 | Railway migration (§11) — DEPLOY.md rewrite, secret migration, db dump/restore, webhook switchover | Infra; do **last** so all the above is on `main` first |
| 11 | Run legacy replay (§10) — first 5 with `--max-imports 5`, then full | After deploy stable |

---

## 15. Open decisions (need user sign-off before plan)

These are the points I made a recommendation on but want you to confirm or override before I write the implementation plan:

- **D1**: Cancel button on Step 1/Target. _Recommend: yes._
- **D2**: Posted confirmation includes "View this entry" deep link. _Recommend: yes._
- **D3**: `/recent` shows 10 entries, no filters. _Recommend: yes._
- **D4**: BotFather privacy mode set to **Disable** (so the bot sees `/cmd` without `@yourbot` in the group). _Recommend: yes._
- **D5**: `/freeze @x [reason]` — store reason. _Recommend: yes._
- **D6**: New `/frozen_list` and `/admin_help` commands. _Recommend: yes._
- **D7**: Pino for structured logs. _Recommend: yes._ (Tiny dep, no perf penalty.)
- **D8**: Allowed updates set to `message`, `callback_query`, `my_chat_member`. _Recommend: yes._
- **D9**: Bot name in BotFather: `Vouch Hub`. _Recommend: yes._ (Or your preferred name.)
- **D10**: Sentiment patterns to include `legend` and `king` as positive. _Recommend: NO — high false-positive risk in this register. Exclude._

---

## 16. Appendix: official-source citations

Every Bot API claim above is traceable to one of:

- `core.telegram.org/bots` — overview
- `core.telegram.org/bots/features` — commands, deep links, menu button, privacy mode, keyboards (`request_users`)
- `core.telegram.org/bots/api` — endpoint reference
- `core.telegram.org/bots/api#formatting-options` — HTML / MarkdownV2
- `core.telegram.org/bots/api#setwebhook` — secret_token, allowed_updates, max_connections, drop_pending_updates
- `core.telegram.org/bots/api#inlinekeyboardbutton` — callback_data 64-byte limit
- `core.telegram.org/bots/faq` — rate limits (1/sec/chat, 20/min/group, 30/sec global)
- `core.telegram.org/bots/webhooks` — TLS, ports, source IPs

Tdesktop export schema citations: `github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_json.cpp` (`wrapPeerId`, `pushFrom`, `SerializeText`, `SerializeMessage`).

Hosting comparison citations: `railway.com/pricing`, `docs.railway.com/guides/postgresql`, `docs.railway.com/guides/github-autodeploys`, `docs.railway.com/guides/variables`, `docs.railway.com/reference/app-sleeping`, `nixpacks.com/docs/providers/node`, `render.com/pricing`, `render.com/docs/free`, `fly.io/docs/about/pricing/`, `fly.io/docs/launch/autostop-autostart/`, `docs.replit.com/cloud-services/deployments/about-deployments`.
