# VouchVault — Full Redesign & Hardening Spec (v2)

_Date: 2026-04-25. Status: locked for implementation. Supersedes v1 of the same date._

This document is the single source of truth for the next round of work on VouchVault. v2 closes gaps from v1 (schema cleanup, project layout, local dev, admin audit, copy enumeration, more admin controls). All decisions previously labelled "recommend" are now **locked**.

All Telegram facts cited here come from `core.telegram.org/bots/*`. Tdesktop export schema facts come from `github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_json.cpp`. Hosting facts come from each provider's pricing/docs page (cited inline in §11).

---

## 1. Goals & non-goals

**Goals**

1. Make the live bot UX feel professional and predictable — every message follows one tone, every button does what its label says, every error tells the user what to do next.
2. Align every Bot API call with Telegram's official guidelines (formatting, rate limits, callback acks, allowed updates, secret-token verification, retries on 429).
3. Land the legacy-replay improvements that never reached `main` (numeric `from_id` fallback, expanded sentiment patterns, bot-sender filter, throttle, `--max-imports`, 429 handling).
4. Clean up dead schema and code from the pre-cutover Mastra/reputation-bot era and rename the misleading `src/mastra/` folder.
5. Migrate hosting from Replit to Railway and adopt drizzle-kit migrations instead of ad-hoc DDL at boot.
6. Add admin **control surfaces** (pause/unpause, freeze with reason, audit log, frozen list, profile lookup) so the bot is operable without DB access.
7. Surface every cross-cutting failure mode as a deliberate code path.

**Non-goals**

- Building a Web App / Mini App. Inline + reply keyboards remain the only UI.
- Localisation. English-only.
- A dispute/appeal flow. Targets DM an admin; admin uses `/remove_entry`.
- Reputation aggregation as a competitive feature (totals shown via `/profile`, no rankings).
- Pinning runtime dep versions. Separate, lower-priority follow-up — but **dev** deps for new tools (pino, drizzle-kit) get pinned at adoption time.
- A separate Sentry-style error tracker. Pino + Railway log search is sufficient at this scale.

---

## 2. Bot identity

Telegram exposes three text fields per language; current state vs. proposed:

| Field | Limit | Where it surfaces | Current | Proposed |
|---|---|---|---|---|
| Name (`setMyName`) | 0–64 | Header in chat list / profile | unset | `Vouch Hub` |
| About (`setMyShortDescription`) | 0–120 | Profile page, share preview | "Vouch hub for local businesses…" (118 chars) | "Vouch Hub — log and verify local-business service experiences. Open from the group launcher." (~95) |
| Description (`setMyDescription`) | 0–512 | Empty-chat splash | one paragraph, ~370 chars | three short lines (§2.1) |

Sources: `core.telegram.org/bots/features` (description ≤ 512, about ≤ 120). Name limit and `setMyName` exact range from the Bot API page.

### 2.1 Locked description copy

```
Log and verify local-business service experiences with the community.

How it works: tap Submit Vouch in the group → DM the bot one @username → choose result + tags → I post a clean entry back to the group.

Lawful use only — follow Telegram's Terms of Service.
```

### 2.2 Bot picture

Out of scope (manual BotFather upload). Note in handoff.

---

## 3. Commands by scope

Telegram supports per-scope command lists via `setMyCommands` `scope.type` (`default`, `all_private_chats`, `all_group_chats`, `all_chat_administrators`, `chat`, `chat_administrators`, `chat_member`). Source: `bots/features#commands`. Telegram explicitly recommends supporting `/start`, `/help`, `/settings` "where applicable".

### 3.1 Final command matrix

| Command | Default | Private | Group (member) | Group (admin) | Description |
|---|---|---|---|---|---|
| `/start` | — | hidden | — | — | Deep-link entry only |
| `/vouch` | — | ✓ | — | — | Start a new vouch entry |
| `/cancel` | — | ✓ | — | — | Cancel your in-progress draft |
| `/help` | ✓ | ✓ | ✓ | ✓ | How the Vouch Hub works |
| `/recent` | ✓ | ✓ | ✓ | ✓ | Show the 10 most recent entries |
| `/profile` | — | ✓ | — | ✓ | `/profile @username` — entry totals + last 5 entries |
| `/lookup` | — | ✓ | — | ✓ | `/lookup @username` — full entry list (admin in group) |
| `/admin_help` | — | — | — | ✓ | Admin command reference |
| `/freeze` | — | — | — | ✓ | `/freeze @x [reason]` — block new entries for a target |
| `/unfreeze` | — | — | — | ✓ | Unfreeze an @username |
| `/frozen_list` | — | — | — | ✓ | List currently-frozen profiles |
| `/remove_entry` | — | — | — | ✓ | `/remove_entry <id>` — soft-delete + delete in group |
| `/recover_entry` | — | — | — | ✓ | `/recover_entry <id>` — clear stuck "publishing" status |
| `/pause` | — | — | — | ✓ | Pause new vouch submissions group-wide |
| `/unpause` | — | — | — | ✓ | Resume vouch submissions |

Notes:

- `/start` does not appear in the menu (Telegram routes deep links automatically).
- `/lookup` and `/profile` differ: `/profile @x` is a user-friendly summary (totals + last 5); `/lookup @x` is the full audit list. Both admin-gated in group; both available in DM (any user can self-lookup).
- Admin commands work in DM for whitelisted admins (`TELEGRAM_ADMIN_IDS`) but only appear in the menu under `all_chat_administrators` scope. `/admin_help` covers memorisation.

### 3.2 Edits vs. current

- **Add**: `/cancel`, `/profile`, `/admin_help`, `/frozen_list`, `/recover_entry`, `/pause`, `/unpause`.
- **Drop**: `/verify` from `THREADED_LAUNCHER_COMMANDS` (`telegramUx.ts:7`) — never registered as a real command.
- **Fix bug**: `/lookup` error string falsely says "limited to admins" when not admin-gated in DM (`telegramBot.ts:267-285`). Rewrite the error string.
- **Bump**: `/recent` from 5 to 10 entries (`MAX_RECENT_ENTRIES`).

---

## 4. DM flow

### 4.1 Happy path

1. **Entry**: user taps **Submit Vouch** in the group (URL deep link `t.me/<bot>?start=vouch_<chatId>`). Telegram opens DM and pre-fills `/start vouch_<chatId>`.
2. **Step 1/3 — Target**: bot replies with target prompt + reply-keyboard `request_users` button **Choose Target**. User can tap or type `@username`.
3. **Step 2/3 — Result**: bot **edits the same message** to show three result buttons (Positive / Mixed / Negative) + Cancel. Reply keyboard from step 1 is removed in this same step (`reply_markup: { remove_keyboard: true }` sent on a transient confirmation send, then deleted; or persisted on the next send).
4. **Step 3/3 — Tags**: bot edits to show 4 tags allowed for that result (multi-select with ✓ prefix), Done, Cancel.
5. **Preview**: bot edits to show the rendered preview + Publish + Cancel.
6. **Posted confirmation**: bot edits to show "Posted to the group" + **Start Another Vouch** + **View this entry** (URL button to `t.me/c/<chatPart>/<messageId>`).
7. **In-group**: a fresh `Entry #N` message appears, the previous launcher is debounced or replaced.

Per Telegram's official UX guidance ("edit your keyboard when the user toggles a setting button or navigates to a new page – this is both faster and smoother than sending a whole new message", `bots/features`), the entire DM flow operates on **one bot message** that is edited at each step.

### 4.2 Reply markup choices

- **Step 1 (target)**: reply keyboard with `KeyboardButtonRequestUsers` (`request_users`, `user_is_bot=false`, `max_quantity=1`, `request_username=true`). `one_time_keyboard=true`. Unchanged.
- **Step 2**: a brief transient send with `reply_markup: { remove_keyboard: true }` (1 line, "Result?"), immediately deleted, so the reply keyboard from step 1 disappears. Or simpler: send the inline result-keyboard message with `reply_markup: { remove_keyboard: true }` riding it (Telegram accepts only one `reply_markup` per send though, so we use the transient + delete pattern). **Decision**: send an extra ephemeral message in step 2 that says "Result?" with `remove_keyboard: true`, then delete it after the inline message is sent. Costs +2 API calls but is the only API-correct way per `bots/api`.
- **Steps 3–5**: inline keyboard attached to the edited bot message.
- **Confirmation**: inline keyboard — Start Another Vouch (callback) + View this entry (URL).

### 4.3 Edge cases enumerated

| # | Scenario | Behaviour |
|---|---|---|
| E01 | User has no public `@username` | "You need a public Telegram @username to vouch. Set one in Telegram → Settings → Username, then send /vouch." |
| E02 | User shares a target with no `@username` via picker | Re-prompt; after 2 failed picks add fallback "Or send the @username as text." |
| E03 | User types something that isn't a username | Re-prompt with single line: "Send only one @username — letters/digits/underscore, 5–32 chars." |
| E04 | User self-targets | "Self-vouching is not allowed." + button |
| E05 | Target is frozen | "@target is frozen and cannot receive new vouches right now." + button |
| E06 | Reviewer already vouched same target within 72h | "You vouched @target on YYYY-MM-DD. Cooldown ends YYYY-MM-DD." + button |
| E07 | Draft expired (24h) | "Your last draft expired. Start again." + button |
| E08 | User taps a button on an old preview after a different draft was started | Inside the lock, refetch draft and validate `step` matches the action; if not, callback alert "This draft is no longer current" + edit old message to "Use the buttons in your current draft." |
| E09 | User taps Publish on a draft whose target group is no longer allowed | Already handled. Keep. |
| E10 | Bot blocked by user mid-flow | Throw a typed `TelegramForbiddenError` from `callTelegramAPI`; on `forbidden: bot was blocked by the user`, swallow + clear the user's draft + log info. **Do not** retry. |
| E11 | Bot kicked / demoted between draft start and Publish | Catch group-level `forbidden` / `bad_request: chat not found`; alert user "I lost access to the group. Notify an admin and try again later." Keep the draft for admin republish. |
| E12 | Telegram returns 429 | `withTelegramRetry` wrapper sleeps `retry_after`s, retries once. Second 429 → typed error → callback alert "Telegram is busy — try again in a minute." |
| E13 | Postgres outage | Webhook returns 500; Telegram retries. Correct. |
| E14 | Stale launcher (group removed from allowlist after launcher posted) | Validate at deep-link time; if invalid, "That launcher is from an old group — open the current launcher in <group name>." |
| E15 | Two parallel reviewers vouching same target | Independent; both publish. Correct. |
| E16 | User's `@username` changes between draft start and Publish | Use latest username at publish. Persist to `users` table on every update. |
| E17 | User selects a bot account as target | `request_users` filters with `user_is_bot=false`. Correct. |
| E18 | User selects deleted/anonymous account | Picker returns `username: null` → handled as E02. |
| E19 | Double-tap Publish | `withReviewerDraftLock` serialises; second call sees draft cleared → "This draft is already posted." |
| E20 | User edits text mid-flow | `edited_message` not in `allowed_updates` → ignored. |
| E21 | User sends photo/sticker as target | Empty `text` → re-prompt with the type-only error. |
| E22 | Draft cleanup fails after publish | Logged warn; janitor (`runArchiveMaintenance`, every 200 updates) catches expired drafts. Keep. |
| E23 | Deep-link payload for a chat the user isn't a member of | Allowlist gating is sufficient — multi-group support is intentional. Document. |
| E24 | Callback `data` length > 64 bytes | Add a unit test asserting every callback we generate is ≤ 64 bytes for any input chat ID (worst case `archive:start:-1009999999999999999` = 33 bytes). Safe. |
| E25 | Reviewer floods 6+ vouches in 24h | Rate-limit: ≤ **5 vouches per reviewer per 24h** (rolling window). On 6th, refuse with "Daily limit reached. Try again after YYYY-MM-DD HH:MM." |
| E26 | Bot is paused (admin `/pause`) | DM flow shows "Vouching is paused. An admin will lift this when ready. Use /recent to see the archive." Group launcher still posts but the deep-link DM rejects new drafts. |
| E27 | Network blip mid-API-call | `withTelegramRetry` retries on `fetch` network errors once; after second failure, surface to the caller. |
| E28 | Webhook handler exceeds 25 sec | Log error, still return 200 to Telegram (avoid duplicate-update flood). Idempotency in `processed_updates` handles the case where Telegram retried before our 200. |
| E29 | Target's Telegram `@username` changes after entries exist | Existing entries reference the historical username; lookup by new handle won't find them until they re-vouch (which creates a new `business_profiles` row). Mitigation: when target is selected via the user picker, persist their Telegram numeric ID on `business_profiles.telegram_id` (new col, §12.2) so a future `/profile @newname` could resolve back via ID. v1 documents the limitation; the schema is forward-compatible. |
| E30 | User sends sticker / voice / photo / animation / location as target | `text` is empty → re-prompt with E03. |
| E31 | User forwards a message into the bot DM | Treat the forward's `text` (or `caption`) as the user's input — i.e. if the forwarded body is just `@username`, accept; else E03. |
| E32 | User sends a string > 64 chars containing an `@` somewhere | `parseTypedTargetUsername` extracts the first valid handle if it stands alone; with extra words it returns E03 ("Send only one @username..."). Confirmed by existing tests. |
| E33 | `setWebhook` fails during initial deploy | DEPLOY.md step 8 includes a verify (`getWebhookInfo`); if `last_error_message` is non-empty, instructions say re-run `npm run telegram:webhook`. |
| E34 | Bot tries to DM an admin (e.g. for G04 supergroup-migration alert) but admin has the bot blocked | `TelegramForbiddenError` swallowed + warn logged; admin sees the alert next time they DM the bot (queued in `admin_audit_log`). |
| E35 | "View this entry" deep link tapped from outside the group (user not a member) | Telegram silently fails to navigate; no error from us. Documented as a known UX limitation; chat link still works for members. |

---

## 5. Group flow

### 5.1 Pinned guide

`scripts/configureTelegramOnboarding.ts` posts a pinned HTML message + Submit Vouch URL button. `disable_notification: true` already set on both the send and the pin. Keep.

### 5.2 Launcher message lifecycle (debounced)

After every published entry, `refreshGroupLauncher` currently does delete-then-send (2 group writes per entry). Telegram's per-group cap is **20 msg/min** (`bots/faq`). With the entry message itself, that's 3 writes/entry → bursts > ~6/min trip the cap.

**Locked behaviour**: keep delete-then-send semantics, but **debounce per chat**: if the chat's `chat_launchers.updated_at` is within 30 sec of "now", skip the refresh — the existing launcher is still at the bottom of the chat (no foreign messages have intervened, since the only other writer is the bot itself). After 30 sec idle, the next published entry triggers a fresh launcher. Halves group writes during bursts; preserves "always at bottom" when traffic is sparse.

Implementation detail: `chat_launchers` already has `updatedAt` (schema confirmed). Code change only.

### 5.3 Privacy mode constraint

Several group commands depend on the bot seeing all `/cmd` traffic, not just commands explicitly addressed to it. Telegram's privacy-mode setting (`bots/features#privacy-mode`) blocks generic `/cmd` reception when ON. **Lock**: privacy mode **OFF** in BotFather (`/setprivacy → Disable`), documented in DEPLOY.md as a one-time manual step. The group is a curated venue, so the broader read scope is acceptable.

### 5.4 Group commands

| Command | Behaviour |
|---|---|
| `/start`, `/help`, `/vouch` | Threaded silent reply with launcher prompt + URL deep-link button |
| `/recent` | Threaded silent reply, 10 entries |
| `/lookup @x` | Admin-gated in group; threaded silent reply |
| `/profile @x` | Admin-gated in group; threaded silent reply |
| `/freeze`, `/unfreeze`, `/freeze_list`, `/remove_entry`, `/recover_entry`, `/pause`, `/unpause`, `/admin_help` | Admin-gated, threaded silent reply |

Privacy mode: locked at **off** in BotFather (`/setprivacy → Disable`) so the bot sees `/cmd` without `@yourbot` required. Document in DEPLOY.md.

### 5.5 Group edge cases

| # | Scenario | Behaviour |
|---|---|---|
| G01 | Bot removed from group | Subscribe to `my_chat_member`; on `status: kicked|left`, mark group inactive in `chat_settings`, stop launcher refreshes for that chat. |
| G02 | Group deleted/archived | Same as G01. |
| G03 | Group converted to channel | Reject in `handleGroupMessage` (channels not supported). |
| G04 | Group migrated to supergroup | `migrate_to_chat_id` arrives in the message payload. Persist new chat ID in `chat_settings`; alert admins via DM "Group migrated; update `TELEGRAM_ALLOWED_CHAT_IDS`." Continue serving under the new ID for the current process lifetime. |
| G05 | Topic groups (forum) | Strip `message_thread_id`; pin launcher in General topic. Document. |
| G06 | Mention without slash | Privacy mode + no command → ignore. Correct. |
| G07 | Bot demoted from admin (loses delete rights) | Catch `bad_request: not enough rights to delete a message` on launcher refresh; log warn; continue without deleting old launcher. |

---

## 6. Admin flow

### 6.1 Final admin command set

| Command | Behaviour | Edge cases |
|---|---|---|
| `/freeze @x [reason text]` | Set `business_profiles.is_frozen=true`, store `freeze_reason`, `frozen_at`, `frozen_by_telegram_id`. Show in `/profile` and `/lookup`. | A04 |
| `/unfreeze @x` | Clear flag + null reason fields. | — |
| `/frozen_list` | Show all frozen profiles (paginated if > 10). | — |
| `/remove_entry <id>` | Soft-delete entry, delete its Telegram message, refresh launcher (debounced). Idempotent. | A05 |
| `/recover_entry <id>` | If entry is stuck in `status="publishing"` with no `published_message_id`, force `status="pending"` so it can republish (admin manually re-runs replay or the entry naturally republishes on next live event — see §10.3). | A06 |
| `/pause` | Set `chat_settings.paused=true` for the group. New vouches refused with E26 message. Existing entries remain. | A07 |
| `/unpause` | Clear pause flag. | — |
| `/admin_help` | Static admin reference list. | — |
| `/profile @x` | Show counts per result + last 5 entries + frozen status with reason. | — |

### 6.2 Audit log

New table `admin_audit_log` records every admin command:

```
id, admin_telegram_id, admin_username, command, target_chat_id,
target_username (nullable), entry_id (nullable), reason (nullable),
created_at
```

No user-facing surface for the log in v1 — admins inspect via DB / Railway data tab. Future: `/audit_log` command.

### 6.3 Admin edge cases

| # | Scenario | Behaviour |
|---|---|---|
| A01 | Non-admin runs admin command | "Admin only." |
| A02 | Admin in DM | Same as A01-passes. |
| A03 | Admin command targets non-existent profile | `getOrCreateBusinessProfile` upserts. Correct. |
| A04 | `/freeze` with reason containing HTML | Escape with `escapeHtml` everywhere reason is rendered. |
| A05 | `/remove_entry` against already-removed entry | Idempotent — no-op + "Entry #N is already removed." |
| A06 | `/recover_entry` against an entry not in `publishing` | "Entry #N is in status=<x>, no recovery needed." |
| A07 | `/pause` already paused | "Vouching is already paused." idempotent. |
| A08 | Two admins issue conflicting commands simultaneously | DB row-level locking via `SELECT FOR UPDATE` in the `set*` helpers. Last write wins; both audit entries persist. |

---

## 7. Message formatting standard

HTML mode everywhere (`bots/api#formatting-options`). Single `escapeHtml()` helper applied to every dynamic substitution. Add a unit test scanning text-builders for raw template substitution outside `escapeHtml`.

Allowed tags: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<strike>`, `<del>`, `<a href="">`, `<code>`, `<pre>`, `<pre><code class="lang">`, `<tg-spoiler>`, `<blockquote>`, `<blockquote expandable>`. No others.

### 7.1 Tone & content rules

- **Sentence case**, except entry-card heading "Entry #N".
- One-line per-step prompts where possible; max 4 short lines.
- One emoji allowed: 🧾 on entry cards. No others (drop ✓ on Posted confirmation).
- No "please." Direct.
- Every error ends with a recovery action.

### 7.2 4096-char ceiling

Bot API hard limit is 4096 chars per `sendMessage` (verify at `bots/api#sendmessage`). Long lookups need truncation:

- Build text iteratively; if total > 3900 chars, stop and append "…and N more." footer.
- Apply to `/lookup`, `/recent`, `/profile`, `/frozen_list`.
- Add unit tests with synthetic 50-entry fixtures.

---

## 8. Rate-limit handling

### 8.1 Documented Telegram limits (`bots/faq`)

- Per chat: ~1 msg/sec.
- Per group: ≤ 20 msg/min.
- Per bot global: ~30 msg/sec.
- 429 carries `parameters.retry_after` (seconds). Honour exactly.

### 8.2 Implementation

- `withTelegramRetry(fn, { maxAttempts: 2 })` wraps every Bot API call inside `tools/telegramTools.ts`. On 429, sleep `retry_after`s, retry once. On second 429, throw typed `TelegramRateLimitError`. On `403` `bot was blocked by the user`, throw typed `TelegramForbiddenError`. On `400` `chat not found` / `bot is not a member of`, throw typed `TelegramChatGoneError`.
- Live bot does not need pre-emptive throttling; reactive retry suffices.
- Replay script enforces a fixed **3.1 sec** gap between sends to a single group via a token-bucket helper. Cite `bots/faq` in code comments.

### 8.3 Edge cases

| # | Scenario | Behaviour |
|---|---|---|
| R01 | 429 mid-publish | Retry once; if user-visible, callback alert "Telegram is busy — try again in a minute." |
| R02 | 30/sec global hit | Should not happen at this volume. Log warn. |
| R03 | Replay 429 | Honour `retry_after`; throttle widens to 6 sec for the next 60 sec ("circuit half-open"); persist checkpoint and continue. |

---

## 9. Webhook & delivery

### 9.1 Setup (already correct)

- `setWebhook` with `secret_token` (1–256 chars). Server verifies `X-Telegram-Bot-Api-Secret-Token`; mismatched requests get 403 (`server.ts:86-94`). Keep.
- HTTPS, ports `443/80/88/8443`, TLS 1.2+, CN matches domain. (`bots/webhooks`.)

### 9.2 Improvements

- **`allowed_updates`**: set to `["message", "callback_query", "my_chat_member"]` (default excludes some; we want `my_chat_member` for G01).
- **`max_connections`**: 10 (default 40; we don't need that many concurrent handlers).
- **`drop_pending_updates: true`** on every redeploy via the `telegram:webhook` script.

### 9.3 Handler hardening (`server.ts`)

- 200 OK as fast as possible. Currently we full-process before 200; for our scale OK, but document the 60-sec Telegram timeout (`bots/webhooks`).
- Add request timeout: if processing exceeds 25 sec, log error + return 200 anyway. Idempotent processing in `processed_updates` handles re-deliveries.
- Add `/readyz` endpoint that asserts Postgres is reachable. Returns 503 if not. Useful for Railway healthcheck.

---

## 10. Legacy replay improvements

### 10.1 Parser changes (`src/mastra/legacyImportParser.ts`)

1. **Numeric reviewer ID fallback**. When no `@username` resolves but the export has `from_id` like `"user6812728770"` (tdesktop format, confirmed against `wrapPeerId` in `export_output_json.cpp`), parse the numeric suffix:
   - Synthesise reviewer handle `user<id>` (matches `[A-Za-z][A-Za-z0-9_]{4,31}` since `user` + 1+ digits ≥ 5 chars).
   - Use the real numeric ID as `reviewerTelegramId` (not the synthetic FNV hash).
   - `from_id` prefix `chat`/`channel` → skip with new `bot_sender` reason (anonymous group admin / channel signature).
   - `from_id` missing → existing `missing_reviewer`.
   - `from: null` (deleted account) but `from_id: "user…"` present → synthesise from `from_id`.

2. **Bot-sender filter**. New env-driven config `LEGACY_BOT_SENDERS=combot,grouphelpbot,groupanonymousbot` (comma list). When the resolved reviewer matches (case-insensitive), skip with reason `bot_sender`, bucket `bot_sender`. Add corresponding column to summary.

3. **Sentiment patterns expanded**. POSITIVE adds:
   - `\bpos\s+vouch\b`
   - `\b(huge|big|mad|high|highly|solid)\s+vouch\b`

   NEGATIVE adds:
   - `\bneg\s+vouch\b`
   - `\bscam(?:mer|med|ming|s)?\b`
   - `\bripped\b`, `\bdodgy\b`, `\bsketchy\b`, `\bshady\b`
   - `\bghost(?:ed|ing)?\b`
   - `\bsteer\s+clear\b`
   - `\bdon'?t\s+trust\b`

   Excluded by decision: `legend`, `king` (false-positive risk).

   Each pattern goes through the existing `(?<!not\s)` guard. Unit test per pattern: positive sample + negated sample.

4. **Multiple-targets bucket split**. Keep skipping (DB unique index on `(legacy_source_chat_id, legacy_source_message_id)` enforces 1:1), but split into its own bucket `multiple_targets` so the operator can hand-review.

5. **Quoted-reply context**. If a message has `reply_to_message_id` and the parent is a `@username` post (single target), and the current message has no inline `@`, **do not** infer the parent as target — too ambiguous. Skip as `missing_target`. Document.

### 10.2 Replay script changes (`scripts/replayLegacyTelegramExport.ts`)

1. `--max-imports N` — stop after N successful imports (live + dry-run modes).
2. `--throttle-ms N` (default `3100`). Sleep before each `sendMessage` to the live group. Implement as a token-bucket so leading bursts after long pauses still respect 1-per-3.1sec.
3. **Honour 429** in the publish loop. On `TelegramRateLimitError`, sleep `retry_after + 100` ms, retry once. On second 429, persist checkpoint, exit non-zero so the next run resumes.
4. Verify `--max-imports` interacts with the existing checkpoint resume (last-imported source-message-id).

### 10.3 Re-run guidance

If a parser improvement classifies messages that an earlier run skipped, simply re-run `replay:legacy` against the same export. The unique index on `(legacy_source_chat_id, legacy_source_message_id)` makes already-imported entries no-ops; newly-importable ones are appended. Use `--max-imports` to cap the incremental delta.

### 10.4 Replay edge cases

| # | Scenario | Behaviour |
|---|---|---|
| L01 | `from_id` is `channel<id>` | Skip as `bot_sender` (anonymous admin / channel signature). |
| L02 | Same `(legacy_source_chat_id, legacy_source_message_id)` re-imported | Unique index rejects; existing entry's `publishedMessageId` decides resume vs duplicate skip. Already correct. |
| L03 | `text` is array of segments | `flattenLegacyMessageText` handles. Correct. |
| L04 | Both positive + negative patterns | `result: null` → `unclear_sentiment`. Correct. |
| L05 | Negated sentiment | `(?<!not\s)` guard + tests. |
| L06 | 429 during replay | §10.2 #3. |
| L07 | DB write fails mid-replay | Existing checkpoint handles. |
| L08 | Entry stuck in `status="publishing"` (Telegram sent but DB write failed) | Admin runs `/recover_entry <id>` to revert to `pending`; next replay run will re-attempt. Document in handoff. |
| L09 | Reply-context message | §10.1 #5. |
| L10 | Message timestamp is 1970 (parse error) | Existing `missing_timestamp` skip. Correct. |

---

## 11. Hosting migration to Railway

### 11.1 Why Railway

Per official-doc comparison (sources cited inline):

- Railway Hobby: $5/mo flat + $5 included usage credit, always-on (`docs.railway.com/reference/app-sleeping`), native GitHub auto-deploy (`docs.railway.com/guides/github-autodeploys`), managed Postgres in same project (`docs.railway.com/guides/postgresql`), reference variables (`docs.railway.com/guides/variables`).
- Render: $7 web + $6 Postgres = $13/mo minimum (`render.com/pricing`); Free tier sleeps after 15 min (`render.com/docs/free`).
- Fly.io: cheapest raw but requires GitHub Actions + self-managed Postgres.
- Replit: $25 Core + $10 Reserved VM = $35/mo for parity.

**Locked: Railway.**

### 11.2 New `DEPLOY.md` (replaces `DEPLOY_REPLIT.md`)

Steps:

1. Sign in to Railway with GitHub `jbot-bit`. Subscribe to Hobby ($5/mo).
2. Install Railway GitHub app; grant `vouchvault` repo access.
3. New Project → Deploy PostgreSQL.
4. Same project → New Service → GitHub Repo → `jbot-bit/vouchvault`.
5. Service Settings → set `NIXPACKS_NODE_VERSION=22` (TS-strip stable from 22.6+; `nixpacks.com/docs/providers/node`); leave Build Command empty; Start Command `npm start`.
6. Variables tab → add (`DATABASE_URL=${{Postgres.DATABASE_URL}}` reference):
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_IDS`
   - `TELEGRAM_ADMIN_IDS`
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN` (`openssl rand -hex 32`)
   - `PUBLIC_BASE_URL` (set after step 7)
   - `TELEGRAM_BOT_USERNAME` (optional)
   - `LEGACY_BOT_SENDERS` (optional, defaults to a sane list)
7. Settings → Networking → Generate Domain. Copy URL → set `PUBLIC_BASE_URL`.
8. From local shell (or Railway service shell): `npm run telegram:webhook` (sets `allowed_updates`, `max_connections`, `drop_pending_updates`).
9. `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide`.
10. In BotFather: `/setprivacy` → Disable for the bot.
11. Smoke-test: §13.3 checklist.

### 11.3 Migration edge cases

| # | Scenario | Behaviour |
|---|---|---|
| M01 | Existing Postgres data on Replit | One-time `pg_dump` from Replit Postgres → `psql` restore into Railway Postgres. Document the exact `pg_dump --no-owner --no-acl` invocation. |
| M02 | Webhook switch leaves dual-active window | `setWebhook` is atomic; only one URL active at a time. Drop Replit deploy after Railway smoke passes. |
| M03 | DNS for custom domain | Optional. `*.up.railway.app` works immediately. |
| M04 | Replit secrets not migrated | DEPLOY.md enumerates every secret. |
| M05 | Node-version drift | Pin `NIXPACKS_NODE_VERSION=22`. |

---

## 12. Schema cleanup & migrations

### 12.1 Dead schema (drop)

The pre-cutover Mastra/reputation-bot era left unused tables/columns. Confirmed unused via `grep` across `src/server.ts` and `src/telegramBot.ts` import chains (HANDOFF.md "All deletions are confirmed non-live").

- Drop tables: `polls`, `votes`.
- Drop columns from `users`: `total_yes_votes`, `total_no_votes`, `rank`, `stars`.

### 12.2 New schema additions

- `business_profiles`: add `freeze_reason TEXT NULL`, `frozen_at TIMESTAMPTZ NULL`, `frozen_by_telegram_id BIGINT NULL`, `telegram_id BIGINT NULL` (set when target was selected via the user picker; supports E29 future resolution).
- New `chat_settings (chat_id BIGINT PK, paused BOOLEAN NOT NULL DEFAULT false, paused_at TIMESTAMPTZ NULL, paused_by_telegram_id BIGINT NULL, status TEXT NOT NULL DEFAULT 'active', migrated_to_chat_id BIGINT NULL)`. `status ∈ {active, kicked, migrated_away}`.
- New `admin_audit_log` (§6.2).
- `vouch_entries.target_telegram_id BIGINT NULL` (denormalised from `business_profiles.telegram_id` at insert time; lets us preserve the link if the target later renames).
- `chat_launchers.updated_at` already exists — no change.

### 12.3 Migration approach

- Adopt **drizzle-kit**. `npm run db:generate` produces SQL migration files in `migrations/`. `npm run db:migrate` applies them in order (idempotent — drizzle-kit tracks applied migrations in a `__drizzle_migrations` table).
- Delete `ensureDatabaseSchema()` boot-time DDL. New boot path: server applies pending migrations on startup (single command, no extra round-trips if up-to-date).
- First migration captures current schema as-is + the cleanup + the new tables/columns. Subsequent changes go in numbered migrations.

### 12.4 Data retention

- `vouch_entries`: keep forever (audit value).
- `vouch_drafts`: replaced on each new draft (single row per reviewer); `runArchiveMaintenance` clears expired (>24h) every 200 updates. Keep.
- `processed_telegram_updates`: 14-day rolling retention via `runArchiveMaintenance`. Keep.
- `admin_audit_log`: keep forever.
- `chat_launchers`: kept until a new launcher replaces; never deleted otherwise.

---

## 13. Project layout cleanup

### 13.1 Rename `src/mastra/` → `src/core/`

The `src/mastra/` directory is a vestigial name from the pre-cutover era — files inside no longer use the Mastra framework (HANDOFF.md confirms). Rename to clarify.

- Move every file from `src/mastra/` to `src/core/`.
- Update every relative import (`./mastra/...` → `./core/...`).
- One sweep, one commit. No semantic change.

### 13.2 README

`README.md` does not exist. Add a short one with: what the bot does, prerequisites, env vars, common commands (`npm start`, `npm test`, `npm run db:migrate`, `npm run telegram:webhook`, `npm run telegram:onboarding`, `npm run replay:legacy`), pointer to `DEPLOY.md` and `HANDOFF.md`.

### 13.3 `.gitattributes`

Repo lives in OneDrive on Windows; every git operation warns "LF will be replaced by CRLF." Add `.gitattributes`:

```
* text=auto eol=lf
*.ts text eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
```

### 13.4 GitHub Actions CI

`.github/workflows/test.yml` runs `npm ci && npm test` on push to `main` and on PRs. Node 22. No deploy step (Railway handles that). Caches `node_modules` keyed on `package-lock.json`.

---

## 14. Final user-facing copy (locked)

Every string the user can see, in one place. All HTML-formatted; all surfaces use `escapeHtml` for dynamic substitutions.

### 14.1 Welcome / `/start` (private, no payload)

```
<b>Welcome to the Vouch Hub</b>

Log and verify local-business service experiences with the community.

<b><u>How to vouch</u></b>
1. Tap <b>Submit Vouch</b> in the group.
2. Send the target @username here.
3. Choose result and tags.
4. I post the entry back to the group.

<b>Rules</b>
Lawful use only — follow Telegram's Terms of Service.
```

### 14.2 Pinned group guide

Same body, but the ordered list says "Tap <b>Submit Vouch</b> below." (since the button is right below the pinned message).

### 14.3 Step prompts

- **Step 1/3 — target**: `<b>Step 1 of 3 — Choose target</b>\n\nSend the target @username here.\nYou can also tap <b>Choose Target</b> below.`
- **Step 2/3 — result**: `<b>Step 2 of 3 — Result</b>\n\nTarget: <b>@x</b>\n\nChoose the result.`
- **Step 3/3 — tags**: `<b>Step 3 of 3 — Tags</b>\n\nTarget: <b>@x</b>\nResult: <b>Positive</b>\nTags: Good Comms, Efficient\n\nChoose one or more tags, then tap <b>Done</b>.`
- **Preview**: `<b><u>Preview</u></b>\n\nOP: <b>@reviewer</b>\nTarget: <b>@target</b>\nResult: <b>Positive</b>\nTags: Good Comms, Efficient`
- **Posted**: `<b>Posted to the group</b>\n\nTarget: <b>@target</b>\nResult: <b>Positive</b>` + buttons Start Another Vouch / View this entry.

### 14.4 Errors (DM)

- E01: "You need a public Telegram @username to vouch.\nSet one in Settings → Username, then send /vouch."
- E02 (after 2 picks): "That account has no public @username.\nOr send the @username as text."
- E03: "Send only one @username — letters/digits/underscore, 5–32 chars."
- E04: "Self-vouching is not allowed."
- E05: "<b>@x</b> is frozen and cannot receive new vouches right now."
- E06: "You vouched <b>@x</b> on YYYY-MM-DD.\nCooldown ends YYYY-MM-DD."
- E07: "Your last draft expired. Start again."
- E11: "I lost access to the group.\nNotify an admin and try again later."
- E12: "Telegram is busy — try again in a minute."
- E25: "Daily limit reached. Try again after YYYY-MM-DD HH:MM."
- E26 (paused): "Vouching is paused.\nAn admin will lift this when ready. Use /recent to see the archive."

### 14.5 Group launcher

- Top-of-launcher text: `<b>Submit a vouch</b>\nTap below to open the short DM form.`
- Button: `Submit Vouch` (URL deep link)

### 14.6 Group threaded replies

- `/start`, `/help`, `/vouch`: launcher block as 14.5.
- `/recent`: rendered list (§14.8).

### 14.7 Entry card (group post)

```
🧾 <b>Entry #N</b>

OP: <b>@reviewer</b>
Target: <b>@target</b>
Result: <b>Positive</b>
```

Legacy variant: heading `🧾 <b>Legacy Entry #N</b>` and trailing `Original: YYYY-MM-DD`.

**By design**: tags are intentionally omitted from the public group post. Entry cards stay scannable; tags appear in `/lookup` and `/profile` for anyone who wants the breakdown.

### 14.8 `/recent`

```
<b><u>Recent entries</u></b>

<b>#42</b> — <b>Positive</b>
<b>@a</b> → <b>@b</b> • 2026-04-25

<b>#41</b> — <b>Negative</b>
<b>@c</b> → <b>@d</b> • 2026-04-24

…
```

10 entries max; truncate at 3900 chars with "…and N more."

### 14.9 `/lookup @x`

```
<b><u>@x</u></b>
Status: Active <i>or</i> Frozen — <i>reason</i>

<b>#N</b> — <b>Positive</b>
By <b>@reviewer</b> • 2026-04-25
Tags: Good Comms, Efficient

…
```

5 entries default (admin in group); 25 in DM. Truncate ≤ 3900 chars.

### 14.10 `/profile @x`

```
<b><u>@x</u></b>
Positive: 12 • Mixed: 3 • Negative: 1
Status: Active

<b>Last 5 entries</b>
<b>#N</b> — <b>Positive</b> • 2026-04-25
…
```

### 14.11 `/admin_help`

```
<b><u>Admin commands</u></b>

/freeze @x [reason] — block new entries
/unfreeze @x — allow entries again
/frozen_list — show frozen profiles
/remove_entry &lt;id&gt; — delete an entry
/recover_entry &lt;id&gt; — clear stuck publishing
/profile @x — entry totals
/lookup @x — full audit list
/pause — pause new vouches
/unpause — resume vouches
```

### 14.12 `/cancel`

DM only: "Cancelled." + Start Another Vouch button. If no draft: "No active draft."

### 14.13 `/help` (DM and group)

DM: shows §14.1 welcome + Start a Vouch button.
Group: shows §14.5 launcher block.

### 14.14 Frozen list

```
<b><u>Frozen profiles</u></b>

<b>@x</b> — frozen 2026-04-20 — <i>reason here</i>
<b>@y</b> — frozen 2026-04-22 — <i>no reason given</i>
…
```

Paginated at 10 per page; "…and N more — refine with /lookup @x" when >10.

---

## 15. Local dev & ops

### 15.1 Running locally with a public webhook

Telegram requires HTTPS; local dev needs a tunnel. Use **ngrok** or **cloudflared**.

Quick start:

```bash
# Terminal A
npm run dev

# Terminal B
ngrok http 5000
# copy the https URL → set PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
TELEGRAM_BOT_TOKEN=... PUBLIC_BASE_URL=... TELEGRAM_WEBHOOK_SECRET_TOKEN=... npm run telegram:webhook
```

For local dev a separate "test" bot via `@BotFather` is recommended so the live bot keeps its production webhook intact.

### 15.2 Secret rotation

- **Bot token**: BotFather → `/revoke` (gets a new token) → update `TELEGRAM_BOT_TOKEN` in Railway → service auto-redeploys → run `npm run telegram:webhook` (the webhook re-registers; secret_token is unchanged).
- **Webhook secret token**: rotate `TELEGRAM_WEBHOOK_SECRET_TOKEN` → redeploy → run `npm run telegram:webhook` → Telegram now sends new secret to `/webhooks/telegram/action` and old secret is rejected.
- **`DATABASE_URL`**: new Postgres → Railway managed-Postgres has rotation in Variables tab → service auto-redeploys.

### 15.3 Backups

Railway Postgres → Settings → Backups → enable daily snapshots (`docs.railway.com/reference/backups`). Document monthly manual `pg_dump` to operator local for cold storage.

### 15.4 Observability (pino)

- Drop `console.*` for `pino` (single dep, structured JSON, low overhead).
- `createLogger()` returns a child logger per request with `update_id`, `chat_id`, `reviewer_telegram_id` bound where applicable.
- Levels: `info` for happy-path lifecycle, `warn` for recovered errors (E10/E11/E12), `error` for unrecovered.
- Railway log search handles correlation.
- `/healthz` (existing) → `{ ok: true }`. New `/readyz` checks DB pool reachability; 503 if not.

---

## 16. Testing approach

### 16.1 Existing coverage (22/22 passing)

`archiveUx.test.ts` (rendering, copy), `legacyImport.test.ts` (parser), `telegramBotInput.test.ts` (username input).

### 16.2 New tests (TDD-first)

- `legacyImportParser.test.ts`: positive + negated sample for every new sentiment pattern; numeric `from_id` synthesis; `from: null` deleted-account handling; bot-sender filter; multi-target bucket split; quoted-reply skip.
- `telegramRateLimit.test.ts`: mock fetch; simulate 429+`retry_after`; assert single retry; assert second 429 throws typed error.
- `telegramErrors.test.ts`: typed errors raised for `403 bot was blocked`, `400 chat not found`, network failure.
- `telegramBot.test.ts`: integration-style (mock store + transport) covering happy path, E08 stale callback, E10 user-blocked, E11 group-gone, E25 reviewer rate-limit, E26 paused, cancel/restart.
- `callbackData.test.ts`: every callback string ≤ 64 bytes for any input chat ID.
- `replayThrottle.test.ts`: token bucket enforces 3.1s gap; `--max-imports 5` stops; checkpoint resumes.
- `formattingCeiling.test.ts`: 50-entry fixtures truncate at 3900 chars with "…and N more."
- `escaping.test.ts`: scan every text-builder for raw template substitutions outside `escapeHtml`.
- `auditLog.test.ts`: every admin command writes one row.
- `migrations.test.ts`: clean-DB → run all migrations → schema matches; idempotent on re-run.

### 16.3 Manual smoke (per deploy)

1. Tap launcher → DM flow → entry posted → launcher refreshed.
2. `/recent` in DM and group.
3. `/profile @x` and `/lookup @x` in DM and group (admin-gated in group).
4. `/freeze @x reason text` → submit attempt blocks. `/unfreeze @x` → submit succeeds.
5. `/remove_entry N` → group message disappears; `/lookup @target` no longer shows it.
6. `/pause` → DM flow blocked with E26. `/unpause` → flow restored.
7. `/cancel` from inside an in-progress draft → cleared.
8. From a non-admin user: every admin command answers "Admin only."

---

## 17. Implementation order

Each chunk ends in green tests + a deployable state. Ordered to minimise risk and avoid coupled deploys.

| # | Chunk | Notes |
|---|---|---|
| 1 | `.gitattributes` + `README.md` + GitHub Actions CI | No runtime impact; stops noise |
| 2 | Drizzle-kit migrations adoption + first migration capturing current schema | Foundation for the rest |
| 3 | Schema cleanup migration: drop `polls`, `votes`, dead `users` cols; add `chat_settings`, `admin_audit_log`, freeze-reason cols | Backwards-compatible (no live code reads dropped tables) |
| 4 | Project layout rename: `src/mastra/` → `src/core/` | One sweep |
| 5 | Parser improvements + tests (§10.1) | Pure logic, low blast radius |
| 6 | Replay script throttle / max-imports / 429 handling + tests (§10.2) | Pure logic |
| 7 | Bot identity copy + commands (§§2, 3, 14) — text-builders + onboarding script | No infra change |
| 8 | DM flow polish (§4) — wording, reply-keyboard removal, callback-data length test, draft-step revalidation, rate-limit, paused-state, view-this-entry deep link | Pure code |
| 9 | Admin flow (§6) — freeze with reason, frozen_list, recover_entry, pause/unpause, profile, admin_help, audit log | Pure code; depends on chunk 3 schema |
| 10 | Group flow (§5) — launcher debounce, `my_chat_member`, supergroup migration | Webhook needs `allowed_updates` updated when this ships |
| 11 | Rate-limit + typed errors (§8) — `withTelegramRetry` and friends | Pure code |
| 12 | Webhook hardening (§9) — `allowed_updates`, `max_connections`, `drop_pending_updates`, `/readyz`, 25-sec safety | Code + a `setWebhook` rerun on deploy |
| 13 | Observability (§15.4) — pino swap | Pure code |
| 14 | Railway migration (§11) — DEPLOY.md rewrite, secret migration, db dump/restore, webhook switchover | Infra last; everything above on `main` first |
| 15 | Run legacy replay (§10) — first 5 with `--max-imports 5`, then full | After deploy stable |

---

## 18. Locked decisions (no further input needed)

| ID | Call |
|---|---|
| D1 | Cancel button on every flow step (including Step 1) — **yes** |
| D2 | Posted confirmation includes "View this entry" deep link — **yes** |
| D3 | `/recent` shows 10 entries — **yes** |
| D4 | BotFather privacy mode set to **Disable** — **yes**, manual step in DEPLOY.md |
| D5 | `/freeze @x [reason]` stores reason — **yes** |
| D6 | `/frozen_list`, `/admin_help`, `/recover_entry`, `/pause`, `/unpause`, `/profile` — **yes, all** |
| D7 | Pino for structured logs — **yes** |
| D8 | `allowed_updates: ["message", "callback_query", "my_chat_member"]` — **yes** |
| D9 | Bot name `Vouch Hub` — **yes** (operator can override in BotFather) |
| D10 | `legend` / `king` excluded from sentiment patterns — **yes (excluded)** |
| D11 | Drop `polls`, `votes`, dead `users` cols — **yes** |
| D12 | Rename `src/mastra/` → `src/core/` — **yes** |
| D13 | Adopt drizzle-kit migrations; remove `ensureDatabaseSchema` boot DDL — **yes** |
| D14 | 5-vouches/24h per reviewer rate limit — **yes** |
| D15 | Drizzle-kit added to `devDependencies` and pinned at adoption time — **yes** |
| D16 | No dispute / appeal system in v1 — **yes** (admin removes via `/remove_entry`) |
| D17 | No reputation aggregation as a competitive feature — **yes** (totals via `/profile`, no leaderboards) |
| D18 | English-only — **yes** |
| D19 | Lookup truncation: 3900-char ceiling with "…and N more." — **yes** |
| D20 | Webhook handler 25-sec safety: log + 200 OK on overrun — **yes** |

---

## 19. Trust model & data handling

### 19.1 Trust model

- **Admins**: fully trusted. Whitelisted by `TELEGRAM_ADMIN_IDS`. A compromised admin can freeze, remove, pause, recover — anything an admin can do. Mitigation = remove the ID from the env var and redeploy.
- **Reviewers**: untrusted. Rate-limit (5/24h), cooldown (72h same target), public `@username` requirement, `request_users` filter excluding bots — these together raise the friction for burner-account abuse.
- **Targets**: not authenticated. The bot does not consult the target before posting an entry. This is consistent with how vouch culture works in the source group (people post vouches without permission); admins handle disputes via `/remove_entry`.
- **Telegram itself**: trusted as the auth provider. Webhook secret-token verifies inbound traffic; bot token authenticates outbound.

### 19.2 Compromise procedures

- **Bot token leaked** → BotFather → `/revoke` → set new `TELEGRAM_BOT_TOKEN` in Railway → redeploy → `npm run telegram:webhook` (§15.2).
- **Webhook secret token leaked** → rotate `TELEGRAM_WEBHOOK_SECRET_TOKEN` → redeploy → `npm run telegram:webhook` (the script writes the new secret to Telegram and the server starts rejecting the old one immediately).
- **Database leaked / breached** → restore from Railway snapshot + last cold backup; usernames + telegram IDs are public information; no PII beyond that is stored.
- **Admin account hijacked** → drop their ID from `TELEGRAM_ADMIN_IDS`; review `admin_audit_log` for actions to roll back via `/recover_entry` / `/unfreeze`.

### 19.3 Data handling

- **What we store**: Telegram numeric IDs, public `@username` snapshots, first names (optional), entry result + tags + timestamps, source-message metadata for legacy imports, audit log of admin actions.
- **What we do NOT store**: phone numbers, emails, message content beyond the legacy parser's text excerpt for skipped messages (review report only — does not enter live data).
- **Soft delete**: `vouch_entries` deleted via `/remove_entry` get `status='removed'`; row preserved for audit. Hard delete via SQL only.
- **Hard delete**: `vouch_drafts` rows replaced on each new draft; expired drafts (>24h) janitored every 200 updates.
- **Subject access / right to be forgotten**: an admin can SQL-delete a reviewer's entries on request. v1 has no self-serve interface; document in handoff.
- **Group post visibility**: entries are posted to a Telegram group; that group's membership rules govern who sees them. The bot does not duplicate or republish externally.

---

## 20. What's deferred (explicit non-goals for this round)

- Bot avatar / picture upload (manual BotFather step; defer until copy lands).
- A `/audit_log` command surface (DB inspection sufficient for v1).
- Per-group time zone display (UTC ISO date everywhere; document).
- A separate Sentry-style error tracker.
- Pinning runtime dep versions (`drizzle-orm`, `pg`).
- Multi-language support.
- Web App / Mini App.
- Reputation leaderboards / competitive ranking.
- Dispute / appeal flow.
- Reactions on entry messages (Bot API supports `setMessageReaction`; not adopted).

---

## 21. Source citations

**Telegram Bot Platform docs:**

- `core.telegram.org/bots` — overview
- `core.telegram.org/bots/features` — commands, deep links, menu button, privacy mode, keyboards
- `core.telegram.org/bots/api` — endpoint reference
- `core.telegram.org/bots/api#formatting-options` — HTML / MarkdownV2
- `core.telegram.org/bots/api#setwebhook` — `secret_token`, `allowed_updates`, `max_connections`, `drop_pending_updates`
- `core.telegram.org/bots/api#inlinekeyboardbutton` — `callback_data` 64-byte limit
- `core.telegram.org/bots/api#sendmessage` — 4096-char body limit
- `core.telegram.org/bots/api#setmessagereaction` — reactions (for reference)
- `core.telegram.org/bots/faq` — rate limits (1/sec/chat, 20/min/group, 30/sec global)
- `core.telegram.org/bots/webhooks` — TLS, ports, IP ranges

**Tdesktop export schema:**

- `github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_json.cpp` (`wrapPeerId`, `pushFrom`, `SerializeText`, `SerializeMessage`)

**Hosting:**

- `railway.com/pricing`, `docs.railway.com/guides/postgresql`, `docs.railway.com/guides/github-autodeploys`, `docs.railway.com/guides/variables`, `docs.railway.com/reference/app-sleeping`, `docs.railway.com/reference/backups`
- `nixpacks.com/docs/providers/node`
- `render.com/pricing`, `render.com/docs/free`
- `fly.io/docs/about/pricing/`, `fly.io/docs/launch/autostop-autostart/`
- `docs.replit.com/cloud-services/deployments/about-deployments`
