# VouchVault — Full Redesign & Hardening Spec (v3)

_Date: 2026-04-25. Status: locked for implementation. Supersedes v2._

This document is the single source of truth for the next round of work on VouchVault. v3 closes additional gaps in boot validation, graceful shutdown, DB pool sizing, TS strict mode, Prettier, migration baselining, reply-keyboard auto-hide via `one_time_keyboard`, pause semantics across in-flight publishes, status state-machine, denied-admin audit logging, and test infrastructure.

All Telegram facts cited come from `core.telegram.org/bots/*`. Tdesktop export schema facts come from `github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/export/output/export_output_json.cpp`. Hosting facts come from each provider's official pricing/docs.

---

## 0. Changelog

### v3 (this version)

- **§4.2**: `one_time_keyboard: true` already auto-hides the reply keyboard after the user picks. Drop the transient-send-then-delete pattern from v2 (saves 2 API calls per flow).
- **§4.3**: 6 more edge cases (E36–E41): pool exhaustion, idempotency rationale, `runArchiveMaintenance` overlap, message-too-old to edit, picker race with `users_shared` arriving after typed `@username`, sticker as type-prompt input.
- **§6.1**: explicit pause semantics — also rejects in-flight `Publish` clicks, not only new drafts.
- **§6.2**: denied-admin attempts are also written to `admin_audit_log` with `denied=true`.
- **§9.4**: boot-time env validation extended (`TELEGRAM_ADMIN_IDS` ≥ 1 valid, `TELEGRAM_WEBHOOK_SECRET_TOKEN` required in production).
- **§9.5**: graceful shutdown on SIGTERM (Railway sends SIGTERM at deploy/scale).
- **§11.4**: Postgres pool sized to 5; matches webhook concurrency; below Railway Postgres connection cap (~20).
- **§12.3**: drizzle-kit baseline pattern documented for the existing prod DB.
- **§12.5**: explicit `vouch_entries.status` state machine.
- **§13.5**: TypeScript `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` tsconfig tightening.
- **§13.6**: Prettier zero-config (`.prettierrc.json` minimal).
- **§15.4**: log sanitiser — never log token/secret/passwords.
- **§16.4**: in-memory store mock for `telegramBot.test.ts` integration coverage.
- **§18**: new locked decisions D21–D27.

### v2 (superseded)

Schema cleanup, drizzle-kit migrations, project layout rename, 7 new admin commands, audit log table, reviewer rate limit, 4096-char ceiling, target-ID persistence, final copy enumeration, local dev / ops / trust model.

### v1 (superseded)

Initial bot identity, commands, DM/group/admin flows with edge cases, formatting standard, rate limits, webhook hardening, legacy parser fixes, Railway migration.

---

## 1. Goals & non-goals

**Goals**

1. Make every user-facing surface predictable, professional, and recoverable.
2. Align every Bot API call with Telegram's official guidelines.
3. Land the legacy-replay improvements (numeric `from_id`, expanded sentiment, bot-sender filter, throttle, `--max-imports`, 429 handling).
4. Clean up dead schema and code; rename `src/mastra/` → `src/core/`.
5. Migrate hosting from Replit to Railway; adopt drizzle-kit migrations.
6. Add admin control surfaces (pause, freeze with reason, audit log, profile, frozen-list, recover-entry).
7. Surface every cross-cutting failure as a deliberate code path.
8. **(v3)** Tighten boot validation, lifecycle, pool sizing, TS strictness, and log hygiene so silent misconfigurations are impossible.

**Non-goals**

- Web App / Mini App.
- Localisation (English-only).
- Dispute / appeal flow (admins use `/remove_entry`).
- Reputation leaderboards.
- Pinning runtime dep versions (separate follow-up).
- Sentry-style error tracker (pino + Railway logs sufficient).

---

## 2. Bot identity

| Field | Limit | Where it surfaces | Current | Locked |
|---|---|---|---|---|
| Name (`setMyName`) | 0–64 | Header in chat list / profile | unset | `Vouch Hub` |
| About (`setMyShortDescription`) | 0–120 | Profile page, share preview | "Vouch hub for local businesses…" (118) | "Vouch Hub — log and verify local-business service experiences. Open from the group launcher." (~95) |
| Description (`setMyDescription`) | 0–512 | Empty-chat splash | one paragraph, ~370 | three short lines (§2.1) |

Sources: `core.telegram.org/bots/features` (description ≤ 512, about ≤ 120). Verify name limit at `core.telegram.org/bots/api#setmyname`.

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

Telegram supports per-scope command lists via `setMyCommands` `scope.type`: `default`, `all_private_chats`, `all_group_chats`, `all_chat_administrators`, `chat`, `chat_administrators`, `chat_member` (`bots/features#commands`). Telegram explicitly recommends supporting `/start`, `/help`, `/settings` "where applicable".

### 3.1 Final command matrix

| Command | Default | Private | Group (member) | Group (admin) | Description |
|---|---|---|---|---|---|
| `/start` | — | hidden | — | — | Deep-link entry only |
| `/vouch` | — | ✓ | — | — | Start a new vouch entry |
| `/cancel` | — | ✓ | — | — | Cancel your in-progress draft |
| `/help` | ✓ | ✓ | ✓ | ✓ | How the Vouch Hub works |
| `/recent` | ✓ | ✓ | ✓ | ✓ | Show the 10 most recent entries |
| `/profile` | — | ✓ | — | ✓ | `/profile @username` — entry totals + last 5 entries |
| `/lookup` | — | ✓ | — | ✓ | `/lookup @username` — full entry list |
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
- `/lookup` and `/profile` are public to anyone in DM (with their own usage); admin-gated in groups (avoid spam).
- Admin commands work in DM for whitelisted admins (`TELEGRAM_ADMIN_IDS`) but only appear in the menu under `all_chat_administrators` scope. `/admin_help` covers memorisation.
- An admin invoking an admin command in DM: works; logged to `admin_audit_log`.
- An admin invoking an admin command **without args** when args are required (`/freeze` with no `@x`, `/remove_entry` with no id): respond with single-line usage: "Use: `/freeze @username [reason]`."

### 3.2 Edits vs. current

- **Add**: `/cancel`, `/profile`, `/admin_help`, `/frozen_list`, `/recover_entry`, `/pause`, `/unpause`.
- **Drop**: `/verify` from `THREADED_LAUNCHER_COMMANDS` (`telegramUx.ts:7`) — never registered as a real command.
- **Fix bug**: `/lookup` error string falsely says "limited to admins" when not admin-gated in DM (`telegramBot.ts:267-285`). Rewrite the error string.
- **Bump**: `/recent` from 5 to 10 entries (`MAX_RECENT_ENTRIES`).

---

## 4. DM flow

### 4.1 Happy path

1. **Entry**: user taps **Submit Vouch** in the group (URL deep link `t.me/<bot>?start=vouch_<chatId>`). Telegram opens DM and pre-fills `/start vouch_<chatId>`.
2. **Step 1/3 — Target**: bot replies with prompt + reply-keyboard `request_users` button labelled **Choose Target**. User can tap or type `@username`.
3. **Step 2/3 — Result**: bot **edits the same message** to show three result buttons (Positive / Mixed / Negative) + Cancel.
4. **Step 3/3 — Tags**: bot edits to show 4 tags allowed for that result (multi-select with ✓ prefix), Done, Cancel.
5. **Preview**: bot edits to show preview + Publish + Cancel.
6. **Posted confirmation**: bot edits to show "Posted to the group" + **Start Another Vouch** + **View this entry** (URL button).
7. **In-group**: a fresh `Entry #N` message appears, the previous launcher is debounced or replaced.

Per Telegram's UX guidance ("edit your keyboard when the user toggles a setting button or navigates to a new page – this is both faster and smoother", `bots/features`), the entire DM flow operates on **one bot message** edited at each step.

### 4.2 Reply markup mechanics

- **Step 1 (target)**: send a fresh message with reply keyboard `KeyboardButtonRequestUsers` (`request_users`, `user_is_bot=false`, `max_quantity=1`, `request_username=true`, `request_name=true`, `one_time_keyboard=true`, `resize_keyboard=true`).
- **Auto-hide**: `one_time_keyboard: true` instructs Telegram clients to hide the reply keyboard "as soon as it's been used" (`bots/api#replykeyboardmarkup`). After the user shares a target via the picker OR types `@username`, no manual `remove_keyboard` is needed.
- **Steps 2–5**: edit the existing message in place; replace `reply_markup` with the inline keyboard for the new step. Telegram preserves the reply-keyboard auto-hide from step 1 across edits.
- **Confirmation**: inline keyboard with Start Another Vouch (callback) + View this entry (URL).

### 4.3 Edge cases enumerated

| # | Scenario | Behaviour |
|---|---|---|
| E01 | User has no public `@username` | "You need a public Telegram @username to vouch.\nSet one in Settings → Username, then send /vouch." |
| E02 | User shares a target with no `@username` via picker | Re-prompt; after 2 failed picks add fallback "Or send the @username as text." |
| E03 | User types something that isn't a username | "Send only one @username — letters/digits/underscore, 5–32 chars." |
| E04 | User self-targets | "Self-vouching is not allowed." + button |
| E05 | Target is frozen | "<b>@x</b> is frozen and cannot receive new vouches right now." + button |
| E06 | Reviewer already vouched same target within 72h | "You vouched <b>@x</b> on YYYY-MM-DD.\nCooldown ends YYYY-MM-DD." + button |
| E07 | Draft expired (24h) | "Your last draft expired. Start again." + button |
| E08 | Stale callback (different draft started) | Refetch inside lock; if step mismatch, callback alert "This draft is no longer current" + edit old message to "Use the buttons in your current draft." |
| E09 | Publish target group no longer allowed | Already handled. Keep. |
| E10 | Bot blocked by user mid-flow | Typed `TelegramForbiddenError`; on `forbidden: bot was blocked by the user`, swallow + clear draft + log info. Do not retry. |
| E11 | Bot kicked/demoted between draft and publish | Catch group-level `forbidden` / `bad_request: chat not found`; alert "I lost access to the group. Notify an admin and try again later." Keep draft. |
| E12 | Telegram 429 | `withTelegramRetry` sleeps `retry_after`s, retries once. Second 429 → typed error → callback alert. |
| E13 | Postgres outage | Webhook 500 → Telegram retries. Correct. |
| E14 | Stale launcher (group removed from allowlist) | Validate at deep-link time; "That launcher is from an old group." |
| E15 | Two parallel reviewers vouching same target | Independent; both publish. Correct. |
| E16 | User's `@username` changes mid-flow | Use latest username at publish. Persist to `users` table on every update. |
| E17 | User selects a bot account as target | `request_users` filters `user_is_bot=false`. Correct. |
| E18 | User selects deleted/anonymous account | Picker returns `username: null` → handled as E02. |
| E19 | Double-tap Publish | `withReviewerDraftLock` serialises; second call sees draft cleared → "This draft is already posted." |
| E20 | User edits text mid-flow | `edited_message` not in `allowed_updates` → ignored. |
| E21 | User sends photo/sticker as target | Empty `text` → re-prompt with E03. |
| E22 | Draft cleanup fails after publish | Logged warn; janitor catches expired drafts. Keep. |
| E23 | Deep-link payload for chat user isn't in | Allowlist gating sufficient — multi-group support is intentional. Document. |
| E24 | Callback `data` length > 64 bytes | Unit test ensures every callback we generate is ≤ 64 bytes. |
| E25 | Reviewer floods 6+ vouches in 24h | Rolling-window rate limit ≤ 5/24h. On 6th: "Daily limit reached. Try again after YYYY-MM-DD HH:MM." |
| E26 | Bot is paused (admin `/pause`) | DM flow rejects new drafts AND in-flight Publish clicks: "Vouching is paused. An admin will lift this when ready. Use /recent to see the archive." Mid-flow drafts can stay open but cannot publish. |
| E27 | Network blip mid-API call | `withTelegramRetry` retries on `fetch` network errors once; second failure surfaces. |
| E28 | Webhook handler exceeds 25 sec | Log error, return 200 to Telegram (avoid duplicate-update flood). Idempotency via `processed_telegram_updates`. |
| E29 | Target's `@username` changes after entries exist | Existing entries reference historical username; v1 documents the limitation. Schema captures `target_telegram_id` on new entries when picker is used (forward-compatible for future `/profile @newname` resolution). |
| E30 | Sticker/voice/photo/animation/location as target | `text` empty → E03. |
| E31 | Forwarded message into the bot DM | Treat the forward's `text` (or `caption`) as the user's input — `@username` standalone accepts; else E03. |
| E32 | String > 64 chars containing an `@` | `parseTypedTargetUsername` extracts standalone handle; with extra words returns E03. Confirmed by existing tests. |
| E33 | `setWebhook` fails during deploy | DEPLOY.md verify (`getWebhookInfo`); re-run `npm run telegram:webhook` if `last_error_message` non-empty. |
| E34 | Bot tries to DM admin (e.g. for G04 alert) but admin has bot blocked | Swallowed `TelegramForbiddenError` + warn; admin sees alert next time they DM the bot (queued in `admin_audit_log`). |
| E35 | "View this entry" deep link tapped from outside the group | Telegram silently fails to navigate; documented limitation. |
| E36 | DB pool exhausted (concurrent webhook spike) | `pg.Pool` queues; if queue exceeds timeout, throws → webhook 500 → Telegram retries. Pool sized at 5 (§11.4) to match webhook `max_connections: 10` × headroom. |
| E37 | Telegram resends the same `update_id` (retries) | `processed_telegram_updates` table makes it a no-op. Telegram doesn't reuse `update_id`s except on retry; `bigint` unique col is the source of truth. |
| E38 | `runArchiveMaintenance` overlaps with a request | Maintenance is wrapped in its own short transactions; advisory lock per-row prevents janitor and live writes from contending on the same draft. |
| E39 | User taps a callback button > 48h after the message was sent | Telegram allows callback delivery indefinitely; we still process. If the message is too old to edit (Telegram returns `bad_request: message can't be edited`), catch that specific error, send a fresh status message instead, log info. |
| E40 | User picker shares a target AT THE SAME TIME as the user types `@username` | Both arrive as separate updates. `withReviewerDraftLock` serialises; whichever arrives first sets the target; the second sees `step != awaiting_target` and is ignored gracefully (no error). |
| E41 | User sends `@username` in middle of a sentence ("hey vouch @bob he's great") | `parseTypedTargetUsername` rejects with E03 unless the message is a standalone handle. Documented; user must send only the handle. |

---

## 5. Group flow

### 5.1 Pinned guide

`scripts/configureTelegramOnboarding.ts` posts pinned HTML message + Submit Vouch URL button. `disable_notification: true` set on send and pin. Keep.

### 5.2 Launcher message lifecycle (debounced)

After every published entry, `refreshGroupLauncher` does delete-then-send (2 group writes per entry). With the entry message itself, that's 3 writes/entry → bursts > ~6/min trip the 20 msg/min group cap (`bots/faq`).

**Locked behaviour**: keep delete-then-send semantics, but **debounce per chat**: if `chat_launchers.updated_at` is within 30 sec of "now", skip the refresh — the existing launcher is still at the bottom (the only writer between launchers is the bot's own entry message). After 30 sec idle, the next entry triggers a fresh launcher.

### 5.3 Privacy mode constraint

Privacy-mode setting (`bots/features#privacy-mode`) blocks generic `/cmd` reception when ON. **Lock**: privacy mode **OFF** in BotFather (`/setprivacy → Disable`), documented in DEPLOY.md as a one-time manual step.

### 5.4 Group commands

| Command | Behaviour |
|---|---|
| `/start`, `/help`, `/vouch` | Threaded silent reply with launcher prompt + URL deep-link button |
| `/recent` | Threaded silent reply, 10 entries |
| `/lookup @x` | Admin-gated in group; threaded silent reply |
| `/profile @x` | Admin-gated in group; threaded silent reply |
| `/freeze`, `/unfreeze`, `/frozen_list`, `/remove_entry`, `/recover_entry`, `/pause`, `/unpause`, `/admin_help` | Admin-gated, threaded silent reply |

### 5.5 Group edge cases

| # | Scenario | Behaviour |
|---|---|---|
| G01 | Bot removed from group | Subscribe to `my_chat_member`; on `status: kicked|left`, set `chat_settings.status='kicked'`, stop launcher refreshes. |
| G02 | Group deleted/archived | Same as G01. |
| G03 | Group converted to channel | Reject in `handleGroupMessage`. |
| G04 | Group migrated to supergroup | `migrate_to_chat_id` arrives in payload. Persist in `chat_settings.migrated_to_chat_id`; alert admins via DM "Group migrated; update `TELEGRAM_ALLOWED_CHAT_IDS`." Continue serving under new ID for current process lifetime. |
| G05 | Topic groups (forum) | Strip `message_thread_id`; pin launcher in General topic. |
| G06 | Mention without slash | Privacy mode + no command → ignore. Correct. |
| G07 | Bot demoted from admin (loses delete rights) | Catch `bad_request: not enough rights to delete a message` on launcher refresh; log warn; continue without deleting old launcher. |
| G08 | Bot newly added to a group | No auto-welcome (could create races with launcher). Admin runs `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide` manually. |

---

## 6. Admin flow

### 6.1 Final admin command set

| Command | Behaviour | Notes |
|---|---|---|
| `/freeze @x [reason text]` | Set `business_profiles.is_frozen=true`, `freeze_reason`, `frozen_at`, `frozen_by_telegram_id`. Show in `/profile` and `/lookup`. Reason capped at 200 chars; HTML-escaped. | A04 |
| `/unfreeze @x` | Clear flag + null reason fields. | — |
| `/frozen_list` | Show all frozen profiles (paginated 10 per page). | — |
| `/remove_entry <id>` | Soft-delete entry, delete its Telegram message, refresh launcher (debounced). Idempotent. | A05 |
| `/recover_entry <id>` | If entry stuck in `status='publishing'` with no `published_message_id`, force `status='pending'` so it can republish. | A06, §12.5 |
| `/pause` | Set `chat_settings.paused=true`. Refuses new vouches AND in-flight Publish (E26). | A07 |
| `/unpause` | Clear pause flag. | — |
| `/admin_help` | Static admin reference list. | — |
| `/profile @x` | Counts per result (excluding `removed`) + last 5 entries + frozen status with reason. | — |

### 6.2 Audit log

New table `admin_audit_log`:

```
id, admin_telegram_id, admin_username, command, target_chat_id,
target_username (nullable), entry_id (nullable), reason (nullable),
denied (boolean, default false), created_at
```

- **Successful admin actions**: written with `denied=false`.
- **Denied admin attempts**: when a non-admin invokes an admin command, write with `denied=true`. Helps detect abuse / probing.
- **No user-facing surface for the log in v1.** Inspect via DB / Railway data tab. Future: `/audit_log`.

### 6.3 Admin edge cases

| # | Scenario | Behaviour |
|---|---|---|
| A01 | Non-admin runs admin command | "Admin only." + audit log entry with `denied=true`. |
| A02 | Admin in DM | Same routing as group; works. |
| A03 | Admin command targets non-existent profile | `getOrCreateBusinessProfile` upserts. Correct. |
| A04 | `/freeze` reason contains HTML | `escapeHtml` on render. Reason stored raw, escaped at display. |
| A05 | `/remove_entry` against already-removed entry | "Entry #N is already removed." idempotent. |
| A06 | `/recover_entry` against entry not in `publishing` | "Entry #N is in status=<x>, no recovery needed." |
| A07 | `/pause` already paused | "Vouching is already paused." idempotent. |
| A08 | Two admins issue conflicting commands simultaneously | DB row-level locking; last-write wins; both audit entries persist. |
| A09 | Admin runs `/freeze` with no `@x` | "Use: `/freeze @username [reason]`." |
| A10 | Admin runs `/remove_entry` with no id | "Use: `/remove_entry <id>`." |
| A11 | Admin runs `/freeze @x` where reason exceeds 200 chars | Truncate reason to 200 + "…", warn admin via reply. |

---

## 7. Message formatting standard

HTML mode everywhere (`bots/api#formatting-options`). Single `escapeHtml()` helper applied to every dynamic substitution. Add a unit test scanning text-builders for raw template substitutions outside `escapeHtml`.

Allowed tags: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<strike>`, `<del>`, `<a href="">`, `<code>`, `<pre>`, `<pre><code class="lang">`, `<tg-spoiler>`, `<blockquote>`, `<blockquote expandable>`. No others.

### 7.1 Tone & content

- **Sentence case**, except entry-card heading "Entry #N".
- One-line per-step prompts where possible; max 4 short lines.
- One emoji allowed: 🧾 on entry cards. No others.
- No "please." Direct.
- Every error ends with a recovery action.

### 7.2 4096-char ceiling

Bot API hard limit: 4096 chars per `sendMessage` (`bots/api#sendmessage`).

- Build text iteratively; if total > 3900, stop and append "…and N more." footer.
- Apply to `/lookup`, `/recent`, `/profile`, `/frozen_list`.
- Tests with synthetic 50-entry fixtures.

---

## 8. Rate-limit handling

### 8.1 Documented Telegram limits (`bots/faq`)

- Per chat: ~1 msg/sec.
- Per group: ≤ 20 msg/min.
- Per bot global: ~30 msg/sec.
- 429 carries `parameters.retry_after` (seconds). Honour exactly.

### 8.2 Implementation

- `withTelegramRetry(fn, { maxAttempts: 2 })` wraps every Bot API call inside `tools/telegramTools.ts`. On 429, sleep `retry_after`s, retry once. On second 429, throw typed `TelegramRateLimitError`. On `403 forbidden: bot was blocked by the user`, throw typed `TelegramForbiddenError`. On `400 chat not found` / `bot is not a member of`, throw typed `TelegramChatGoneError`. Unknown errors throw the existing generic `Error`.
- Live bot: reactive retry suffices; no pre-emptive throttling.
- Replay script: token-bucket helper enforcing **3.1 sec** between sends to a single group. Cite `bots/faq` in code comments.

### 8.3 Edge cases

| # | Scenario | Behaviour |
|---|---|---|
| R01 | 429 mid-publish | Retry once; if user-visible, callback alert "Telegram is busy — try again in a minute." |
| R02 | 30/sec global hit | Should not happen at this volume. Log warn. |
| R03 | Replay 429 | Honour `retry_after`; throttle widens to 6 sec for next 60 sec; persist checkpoint. |
| R04 | Network-level error (ECONNRESET, ETIMEDOUT) | `withTelegramRetry` retries once on transient errors. Second attempt failure surfaces. |

---

## 9. Webhook & delivery

### 9.1 Setup

- `setWebhook` with `secret_token` (1–256 chars). Server verifies `X-Telegram-Bot-Api-Secret-Token`; mismatched → 403 (`server.ts:86-94`). Keep.
- HTTPS, ports `443/80/88/8443`, TLS 1.2+, CN matches domain (`bots/webhooks`).

### 9.2 Improvements

- **`allowed_updates`**: `["message", "callback_query", "my_chat_member"]`.
- **`max_connections`**: 10 (default 40).
- **`drop_pending_updates: true`** on every redeploy via the `telegram:webhook` script.

### 9.3 Handler hardening (`server.ts`)

- 200 OK as fast as possible; document the 60-sec Telegram timeout.
- Add 25-sec timeout: log error + return 200 anyway. Idempotency via `processed_telegram_updates`.
- Add `/readyz` endpoint that checks Postgres pool reachability; 503 if not. Useful for Railway healthcheck. `/healthz` stays as a process-alive ping.

### 9.4 Boot-time env validation

Before the server starts listening, validate every required env var. Fail-loud on missing or invalid:

| Var | Required | Validation |
|---|---|---|
| `DATABASE_URL` | yes | non-empty |
| `TELEGRAM_BOT_TOKEN` | yes | matches `^\d+:[A-Za-z0-9_-]+$` (Telegram token shape) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | yes | comma-list of safe-integer chat IDs; ≥ 1 entry |
| `TELEGRAM_ADMIN_IDS` | yes | comma-list of safe-integer user IDs; ≥ 1 entry |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | yes (in production) | 1–256 chars, charset `A-Z a-z 0-9 _ -` |
| `PUBLIC_BASE_URL` | yes (for setup scripts only) | parseable URL with `https://` scheme |
| `TELEGRAM_BOT_USERNAME` | optional | matches `^[A-Za-z0-9_]{5,32}$` if set |
| `LEGACY_BOT_SENDERS` | optional | comma-list; default `combot,grouphelpbot,groupanonymousbot` |
| `NODE_ENV` | optional | `production` enforces webhook secret + structured logs |

In **non-production** (`NODE_ENV !== 'production'`) the webhook secret is optional (local-dev convenience), but `npm run telegram:webhook` still warns if absent. Document.

### 9.5 Graceful shutdown

Railway sends `SIGTERM` on deploy/scale (10 sec grace before `SIGKILL`). Without a handler the in-flight transactions roll back and the user sees a 5xx.

Implementation:

```
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close();              // stop accepting new connections
  await drainInFlight(5_000);  // wait up to 5 sec for current handlers
  await dbPool.end();          // close Postgres connections cleanly
  process.exit(0);
}
```

If shutdown runs longer than 8 sec (grace minus margin), `process.exit(1)` to force.

---

## 10. Legacy replay improvements

### 10.1 Parser changes (`src/core/legacyImportParser.ts`)

1. **Numeric reviewer ID fallback** (tdesktop format `"user6812728770"`, confirmed against `wrapPeerId` in `export_output_json.cpp`):
   - Synthesise reviewer handle `user<id>` (matches `[A-Za-z][A-Za-z0-9_]{4,31}` since `user` + digits ≥ 5 chars).
   - Use real numeric ID as `reviewerTelegramId` (not the synthetic FNV hash).
   - `from_id` prefix `chat`/`channel` → skip with new `bot_sender` reason.
   - `from_id` missing → existing `missing_reviewer`.
   - `from: null` (deleted account) but `from_id: "user…"` present → synthesise from `from_id`.

2. **Bot-sender filter**. Env `LEGACY_BOT_SENDERS` (comma list, default `combot,grouphelpbot,groupanonymousbot`). When resolved reviewer matches case-insensitively, skip with reason `bot_sender`, bucket `bot_sender`. Add to summary.

3. **Sentiment patterns expanded.** POSITIVE adds:
   - `\bpos\s+vouch\b`
   - `\b(huge|big|mad|high|highly|solid)\s+vouch\b`

   NEGATIVE adds:
   - `\bneg\s+vouch\b`
   - `\bscam(?:mer|med|ming|s)?\b`
   - `\bripped\b`, `\bdodgy\b`, `\bsketchy\b`, `\bshady\b`
   - `\bghost(?:ed|ing)?\b`
   - `\bsteer\s+clear\b`
   - `\bdon'?t\s+trust\b`

   Excluded: `legend`, `king` (false-positive risk).

   `(?<!not\s)` guard on every pattern. Unit test per pattern: positive + negated.

4. **Multiple-targets bucket split**. Keep skipping (DB unique index enforces 1:1); split bucket from `missing_target` to its own `multiple_targets` for review.

5. **Quoted-reply context**. If a message has `reply_to_message_id` and the parent is a `@username` post but the current message has no inline `@`, do **not** infer the parent as target — skip as `missing_target`. Document.

6. **Caption support**. Forwarded messages in the export have `caption` field; treat caption as text alongside `text` when extracting target / sentiment.

### 10.2 Replay script changes (`scripts/replayLegacyTelegramExport.ts`)

1. `--max-imports N` — stop after N successful imports (live + dry-run).
2. `--throttle-ms N` (default `3100`). Token-bucket so leading bursts respect 1-per-3.1sec.
3. **Honour 429** in publish loop. On `TelegramRateLimitError`, sleep `retry_after + 100` ms, retry once. Second 429 → persist checkpoint, exit non-zero.
4. Verify `--max-imports` interacts with checkpoint resume (last-imported source-message-id).

### 10.3 Re-run guidance

If a parser improvement classifies messages an earlier run skipped, re-run `replay:legacy` against the same export. Unique index makes already-imported entries no-ops; newly-importable ones append. Use `--max-imports` to cap the incremental delta.

### 10.4 Replay edge cases

| # | Scenario | Behaviour |
|---|---|---|
| L01 | `from_id` is `channel<id>` | Skip as `bot_sender`. |
| L02 | Same `(legacy_source_chat_id, legacy_source_message_id)` re-imported | Unique index rejects; existing `published_message_id` decides resume vs duplicate skip. |
| L03 | `text` is array of segments | `flattenLegacyMessageText` handles. |
| L04 | Both positive + negative patterns | `result: null` → `unclear_sentiment`. |
| L05 | Negated sentiment | `(?<!not\s)` guard + tests. |
| L06 | 429 during replay | §10.2 #3. |
| L07 | DB write fails mid-replay | Existing checkpoint handles. |
| L08 | Entry stuck in `status='publishing'` | Admin runs `/recover_entry <id>` to revert to `pending`; next replay re-attempts. |
| L09 | Reply-context message | §10.1 #5. |
| L10 | Message timestamp is 1970 | Existing `missing_timestamp` skip. |
| L11 | Forwarded message with caption only | §10.1 #6. |

---

## 11. Hosting migration to Railway

### 11.1 Why Railway

Per official-doc comparison (sources cited inline):

- Railway Hobby: $5/mo flat + $5 credit, always-on (`docs.railway.com/reference/app-sleeping`), native GitHub auto-deploy, managed Postgres in same project, reference variables.
- Render: $7 web + $6 Postgres = $13/mo minimum; Free tier sleeps after 15 min.
- Fly.io: cheapest raw but requires GitHub Actions + self-managed Postgres.
- Replit: ~$35/mo for parity.

**Locked: Railway.**

### 11.2 New `DEPLOY.md` (replaces `DEPLOY_REPLIT.md`)

1. Sign in to Railway with GitHub `jbot-bit`. Subscribe to Hobby ($5/mo).
2. Install Railway GitHub app; grant `vouchvault` repo access.
3. New Project → Deploy PostgreSQL.
4. Same project → New Service → GitHub Repo → `jbot-bit/vouchvault`.
5. Service Settings → set `NIXPACKS_NODE_VERSION=22`; Build Command empty; Start Command `npm start`.
6. Variables tab → add:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_IDS`
   - `TELEGRAM_ADMIN_IDS`
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN` (`openssl rand -hex 32`)
   - `PUBLIC_BASE_URL` (set after step 7)
   - `TELEGRAM_BOT_USERNAME` (optional)
   - `LEGACY_BOT_SENDERS` (optional)
   - `NODE_ENV=production`
7. Settings → Networking → Generate Domain. Copy URL → set `PUBLIC_BASE_URL`.
8. From local shell: `npm run telegram:webhook`.
9. `npm run telegram:onboarding -- --guide-chat-id <id> --pin-guide`.
10. BotFather: `/setprivacy` → Disable.
11. Smoke-test: §16.5 checklist.

### 11.3 Migration edge cases

| # | Scenario | Behaviour |
|---|---|---|
| M01 | Existing Postgres data on Replit | One-time `pg_dump --no-owner --no-acl --clean --if-exists` from Replit → `psql` restore into Railway. |
| M02 | Webhook switch leaves dual-active | `setWebhook` is atomic. Drop Replit deploy after Railway smoke passes. |
| M03 | DNS for custom domain | Optional. `*.up.railway.app` works immediately. |
| M04 | Replit secrets not migrated | DEPLOY.md enumerates every secret. |
| M05 | Node-version drift | Pin `NIXPACKS_NODE_VERSION=22`. |
| M06 | Railway Postgres upgraded mid-flight | Backups before upgrade; Drizzle migrations are idempotent. |

### 11.4 Connection pool sizing

- `pg.Pool` defaults: 10 connections. Override to `max: 5`.
- Webhook `max_connections: 10` × concurrent handlers, but most operations are short and don't all hit DB simultaneously.
- Railway Postgres free tier: ~20 connections. Pool of 5 leaves headroom for the `replay:legacy` script and `telegram:webhook` script running alongside the server.
- Connection timeout: 5 sec; idle timeout: 30 sec.

---

## 12. Schema cleanup & migrations

### 12.1 Dead schema (drop)

Pre-cutover Mastra/reputation-bot leftovers (HANDOFF.md confirms unused):

- Drop tables: `polls`, `votes`.
- Drop columns from `users`: `total_yes_votes`, `total_no_votes`, `rank`, `stars`.

### 12.2 New schema additions

- `business_profiles`: `freeze_reason TEXT NULL`, `frozen_at TIMESTAMPTZ NULL`, `frozen_by_telegram_id BIGINT NULL`, `telegram_id BIGINT NULL`.
- New `chat_settings (chat_id BIGINT PK, paused BOOLEAN NOT NULL DEFAULT false, paused_at TIMESTAMPTZ NULL, paused_by_telegram_id BIGINT NULL, status TEXT NOT NULL DEFAULT 'active', migrated_to_chat_id BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`. `status ∈ {active, kicked, migrated_away}`.
- New `admin_audit_log` (§6.2).
- `vouch_entries.target_telegram_id BIGINT NULL` (denormalised at insert; preserves rename links).
- `chat_launchers.updated_at` already exists.

### 12.3 Drizzle-kit baseline pattern

Adopt drizzle-kit. Issue: existing prod DB already has tables created by the legacy `ensureDatabaseSchema()` boot DDL.

Approach:

1. Generate the **baseline migration** (`0000_baseline.sql`) by running `drizzle-kit generate` against the **current** schema. This file represents the as-is shape of every table.
2. On the prod DB (one time), insert a row into `__drizzle_migrations` marking `0000_baseline.sql` as applied at `now()`. Do this via a manual SQL snippet documented in DEPLOY.md.
3. On a clean dev DB, drizzle-kit applies `0000_baseline.sql` from scratch — same end state.
4. All future schema changes are **separate** migration files (`0001_drop_dead_tables.sql`, `0002_add_chat_settings.sql`, etc.) generated normally.
5. `npm run db:migrate` applies pending migrations at boot. Replace `ensureDatabaseSchema()` with a call to drizzle-orm's `migrate()` helper.

### 12.4 Migration sequence

| # | File | Content |
|---|---|---|
| 0000 | `baseline.sql` | Current schema as-is (CREATE TABLE statements matching `ensureDatabaseSchema`) |
| 0001 | `drop_dead_tables.sql` | DROP `polls`, `votes`; ALTER `users` DROP COLUMN x4 |
| 0002 | `add_chat_settings.sql` | CREATE `chat_settings` |
| 0003 | `add_admin_audit_log.sql` | CREATE `admin_audit_log` |
| 0004 | `business_profiles_freeze_reason.sql` | ALTER `business_profiles` ADD freeze cols + telegram_id |
| 0005 | `vouch_entries_target_telegram_id.sql` | ALTER `vouch_entries` ADD target_telegram_id |

Each migration is reversible (down SQL co-located in repo for emergency rollback).

### 12.5 `vouch_entries.status` state machine

Locked values + transitions:

```
pending  --markArchiveEntryPublishing-->  publishing
publishing  --setArchiveEntryPublishedMessageId-->  published
publishing  --on send error: setArchiveEntryStatus-->  pending
published  --markArchiveEntryRemoved-->  removed
publishing  --/recover_entry-->  pending
```

Constraints:
- Only `published` entries surface in `/profile`, `/recent`, `/lookup` (counts and listings).
- Only `pending` entries can be (re)published.
- Only `published` entries can be `removed`.
- `removed` is terminal.

Add a CHECK constraint on `status IN ('pending','publishing','published','removed')` in migration 0001.

### 12.6 Data retention

- `vouch_entries`: forever (audit value).
- `vouch_drafts`: replaced per-reviewer; janitored at >24h.
- `processed_telegram_updates`: 14-day rolling.
- `admin_audit_log`: forever.
- `chat_launchers`: kept until next refresh.
- `chat_settings`: forever (one row per chat).

---

## 13. Project layout cleanup

### 13.1 Rename `src/mastra/` → `src/core/`

- Move every file from `src/mastra/` to `src/core/`.
- Update every relative import.
- One sweep, one commit. No semantic change.

### 13.2 README

Add `README.md` (none exists). Sections: what the bot does, prerequisites (Node 22, Postgres), env vars (point at `.env.example`), common commands, pointer to `DEPLOY.md` and `HANDOFF.md`.

### 13.3 `.gitattributes`

Stops the OneDrive-induced LF→CRLF warnings:

```
* text=auto eol=lf
*.ts text eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
*.sql text eol=lf
```

### 13.4 GitHub Actions CI

`.github/workflows/test.yml`:
- Trigger: push to `main`, PRs.
- Node 22.
- Steps: `actions/checkout@v4`, `actions/setup-node@v4` with `cache: npm`, `npm ci`, `npm test`.
- Optional: spin up Postgres 16 service; run migrations; run integration tests (deferred until §16.4 mock store proves insufficient).

### 13.5 TypeScript strict mode

Update `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": false,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noEmit": true
  },
  "include": ["src/**/*", "scripts/**/*"]
}
```

`exactOptionalPropertyTypes` left off — the existing code uses optional vs `| undefined` interchangeably; flipping it would require many small fixes, deferred. Document in handoff.

`noPropertyAccessFromIndexSignature: false` — this codebase reads from `process.env` heavily; bracket vs dot doesn't matter for us.

The other strict flags are added in a single chunk that types the codebase cleanly.

### 13.6 Prettier

Add `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

`npm run format` → `prettier --write .`. `npm run format:check` → `prettier --check .` (used in CI). Existing `package.json` already has `npm run check:format` placeholder; wire it up.

---

## 14. Final user-facing copy (locked)

All HTML-formatted; all surfaces use `escapeHtml` for dynamic substitutions.

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

Same body; ordered list says "Tap <b>Submit Vouch</b> below."

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
- E26 (paused, mid-flow Publish): "Vouching is paused.\nAn admin will lift this. Use /recent to see the archive."

### 14.5 Group launcher

- Top text: `<b>Submit a vouch</b>\nTap below to open the short DM form.`
- Button: `Submit Vouch` (URL deep link)

### 14.6 Group threaded replies

- `/start`, `/help`, `/vouch`: launcher block (§14.5).
- `/recent`: rendered list (§14.8).

### 14.7 Entry card (group post)

```
🧾 <b>Entry #N</b>

OP: <b>@reviewer</b>
Target: <b>@target</b>
Result: <b>Positive</b>
```

Legacy variant: heading `🧾 <b>Legacy Entry #N</b>` and trailing `Original: YYYY-MM-DD`.

**By design**: tags are intentionally omitted from the public group post; they appear in `/lookup` and `/profile`.

### 14.8 `/recent`

```
<b><u>Recent entries</u></b>

<b>#42</b> — <b>Positive</b>
<b>@a</b> → <b>@b</b> • 2026-04-25

<b>#41</b> — <b>Negative</b>
<b>@c</b> → <b>@d</b> • 2026-04-24

…
```

10 entries; truncate at 3900 chars with "…and N more."

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

Counts exclude `removed` entries.

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

DM: "Cancelled." + Start Another Vouch button. If no draft: "No active draft."

### 14.13 `/help`

DM: §14.1 welcome + Start a Vouch button.
Group: §14.5 launcher block.

### 14.14 Frozen list

```
<b><u>Frozen profiles</u></b>

<b>@x</b> — frozen 2026-04-20 — <i>reason here</i>
<b>@y</b> — frozen 2026-04-22 — <i>no reason given</i>
…
```

10 per page; "…and N more — refine with /lookup @x" when >10.

---

## 15. Local dev & ops

### 15.1 Running locally with a public webhook

Telegram requires HTTPS; local dev needs a tunnel.

```bash
# Terminal A
npm run dev

# Terminal B
ngrok http 5000
# copy the https URL → set PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
TELEGRAM_BOT_TOKEN=... PUBLIC_BASE_URL=... TELEGRAM_WEBHOOK_SECRET_TOKEN=... npm run telegram:webhook
```

Use a separate test bot via BotFather so the live webhook stays intact.

### 15.2 Secret rotation

- **Bot token**: BotFather `/revoke` → new token → update `TELEGRAM_BOT_TOKEN` in Railway → service auto-redeploys → run `npm run telegram:webhook`.
- **Webhook secret**: rotate `TELEGRAM_WEBHOOK_SECRET_TOKEN` → redeploy → `npm run telegram:webhook` writes the new secret to Telegram and old becomes invalid immediately.
- **`DATABASE_URL`**: Railway managed-Postgres rotation in Variables tab → service auto-redeploys.

### 15.3 Backups

Railway Postgres → Settings → Backups → enable daily snapshots (`docs.railway.com/reference/backups`). Document monthly manual `pg_dump --no-owner --no-acl` to operator local.

### 15.4 Observability

- Drop `console.*` for `pino`. `createLogger()` returns a child logger per request with `update_id`, `chat_id`, `reviewer_telegram_id` bound where applicable.
- Levels: `info` for happy-path lifecycle, `warn` for recovered errors, `error` for unrecovered.
- **Log sanitiser**: `pino` redact paths configured to drop `*.token`, `*.secret`, `*.authorization`, `*.api_key`, `*.password`, `*.error.headers.authorization`. Telegram API responses with user text get truncated to 200 chars in error logs.
- `/healthz`: process-alive ping → `{ ok: true }`.
- `/readyz`: DB pool reachability check → 200 if `SELECT 1` returns within 1 sec, else 503.

### 15.5 Operator runbook (DEPLOY.md appendix)

For common scenarios:

- **Bot stops responding**: Railway Logs → look for last error → `/readyz` → if 503, Postgres issue → check Postgres service status.
- **Vouches stuck in publishing**: SQL `SELECT id FROM vouch_entries WHERE status='publishing' AND updated_at < now() - interval '5 minutes'` → admin runs `/recover_entry <id>` per row.
- **Spike in 429s**: tail Railway logs; if from group-target-id → another bot in the group is contending; consider tightening replay throttle.
- **Need to stop the bot now**: `/pause` from any admin.
- **Need to redact a vouch**: `/remove_entry <id>` → if it must be SQL-deleted (GDPR), `DELETE FROM vouch_entries WHERE id = $1` after confirming Telegram message is gone.

---

## 16. Testing approach

### 16.1 Existing coverage (22/22 passing)

`archiveUx.test.ts` (rendering, copy), `legacyImport.test.ts` (parser), `telegramBotInput.test.ts` (username input).

### 16.2 New tests (TDD-first)

- `legacyImportParser.test.ts`: positive + negated for every new sentiment; numeric `from_id` synthesis; `from: null` deleted-account; bot-sender filter; multi-target bucket split; quoted-reply skip; caption support.
- `telegramRateLimit.test.ts`: mock fetch; simulate 429+`retry_after`; assert single retry; assert second 429 throws typed error.
- `telegramErrors.test.ts`: typed errors raised for 403 `bot was blocked`, 400 `chat not found`, network failure.
- `telegramBot.test.ts`: integration-style with in-memory store mock — happy path, E08, E10, E11, E25, E26, cancel/restart, callback after edit-too-old (E39), users_shared race (E40).
- `callbackData.test.ts`: every callback string ≤ 64 bytes for any input chat ID.
- `replayThrottle.test.ts`: token bucket enforces 3.1 s gap; `--max-imports 5` stops; checkpoint resumes.
- `formattingCeiling.test.ts`: 50-entry fixtures truncate at 3900 chars with "…and N more."
- `escaping.test.ts`: scan every text-builder for raw template substitutions outside `escapeHtml`.
- `auditLog.test.ts`: every admin command writes one row; denied attempts also written.
- `migrations.test.ts`: clean DB → run all migrations → schema matches; idempotent on re-run.
- `bootValidation.test.ts`: missing/invalid env vars cause boot to throw before listening.
- `gracefulShutdown.test.ts`: SIGTERM closes server, drains, ends pool, exits.

### 16.3 Test infrastructure

- Use Node's built-in `node:test` runner (matches existing `package.json`).
- Tests run via `npm test` (current script).
- No additional test deps for unit tests; use `node:test`'s `mock` for stubbing.

### 16.4 In-memory store mock

For `telegramBot.test.ts`, build a single-file in-memory mock of `archiveStore.ts` exports. Same shape as the real module, backed by `Map`s. Inject via test-time `--import` shim that replaces the module specifier:

```ts
// tests/_helpers/mockStore.ts
import { mock } from 'node:test';
// returns the in-memory implementation matching archiveStore's interface
```

DB-integration tests (`migrations.test.ts`) require a real Postgres; gated behind a `TEST_DATABASE_URL` env var; skipped if absent. CI sets it via the Postgres service; local dev runs unit tests only.

### 16.5 Manual smoke (per deploy)

1. Tap launcher → DM flow → entry posted → launcher refreshed.
2. `/recent` in DM and group.
3. `/profile @x` and `/lookup @x` in DM and group (admin-gated in group).
4. `/freeze @x reason text` → submit attempt blocks. `/unfreeze @x` → submit succeeds.
5. `/remove_entry N` → group message disappears; `/lookup @target` no longer shows it.
6. `/pause` → DM flow blocked with E26. `/unpause` → flow restored.
7. `/cancel` from inside an in-progress draft → cleared.
8. From a non-admin: every admin command answers "Admin only." + audit log row written.
9. Webhook secret mismatch → 403 from `server.ts:86-94`.
10. Restart deploy → ensure no in-flight 5xx (graceful shutdown working).

---

## 17. Implementation order

Each chunk ends in green tests + a deployable state.

| # | Chunk | Notes |
|---|---|---|
| 1 | `.gitattributes` + `README.md` + GitHub Actions CI | No runtime impact; stops noise |
| 2 | TS strict mode tightening (§13.5) + Prettier (§13.6) | Code change only; no runtime impact |
| 3 | Drizzle-kit adoption + baseline migration (§12.3, 0000) | Foundation; replaces `ensureDatabaseSchema` boot DDL |
| 4 | Schema cleanup + new tables migrations (0001–0005) | Drops dead schema; adds new |
| 5 | Project layout rename `src/mastra/` → `src/core/` (§13.1) | One sweep |
| 6 | Parser improvements + tests (§10.1) | Pure logic |
| 7 | Replay script throttle / max-imports / 429 / typed retry (§10.2, §8.2) | Pure logic |
| 8 | Boot env validation + graceful shutdown + `/readyz` (§9.4, §9.5) | Server hardening |
| 9 | Bot identity copy + commands (§§2, 3, 14) — text-builders + onboarding script | No infra change |
| 10 | DM flow polish (§4) — wording, callback-data length test, draft-step revalidation, rate-limit, paused-state, view-this-entry deep link | Pure code |
| 11 | Admin flow (§6) — freeze with reason, frozen_list, recover_entry, pause/unpause, profile, admin_help, audit log (incl. denied) | Pure code; depends on chunk 4 |
| 12 | Group flow (§5) — launcher debounce, `my_chat_member`, supergroup migration | Webhook needs `allowed_updates` updated when this ships |
| 13 | Webhook hardening (§9.2) — `allowed_updates`, `max_connections`, `drop_pending_updates`, 25-sec safety | Code + a `setWebhook` rerun on deploy |
| 14 | Observability (§15.4) — pino swap with redact paths | Pure code |
| 15 | Connection pool sizing (§11.4) — `pg.Pool({ max: 5 })` | One-line change in `storage/db.ts` |
| 16 | Railway migration (§11) — `DEPLOY.md`, secret migration, db dump/restore, webhook switchover, baseline-migration prod insertion | Infra last; everything above on `main` first |
| 17 | Run legacy replay (§10) — `--max-imports 5` first, then full | After deploy stable |

---

## 18. Locked decisions

| ID | Call |
|---|---|
| D1 | Cancel button on every flow step — **yes** |
| D2 | Posted confirmation includes "View this entry" deep link — **yes** |
| D3 | `/recent` shows 10 entries — **yes** |
| D4 | BotFather privacy mode set to **Disable** — **yes**, manual step in DEPLOY.md |
| D5 | `/freeze @x [reason]` stores reason — **yes** |
| D6 | `/frozen_list`, `/admin_help`, `/recover_entry`, `/pause`, `/unpause`, `/profile` — **yes, all** |
| D7 | Pino for structured logs — **yes** |
| D8 | `allowed_updates: ["message", "callback_query", "my_chat_member"]` — **yes** |
| D9 | Bot name `Vouch Hub` — **yes** |
| D10 | `legend` / `king` excluded from sentiment patterns — **yes (excluded)** |
| D11 | Drop `polls`, `votes`, dead `users` cols — **yes** |
| D12 | Rename `src/mastra/` → `src/core/` — **yes** |
| D13 | Adopt drizzle-kit; remove `ensureDatabaseSchema` boot DDL — **yes** |
| D14 | 5-vouches/24h per reviewer rate limit — **yes** |
| D15 | drizzle-kit added to `devDependencies` and pinned at adoption time — **yes** |
| D16 | No dispute / appeal system in v1 — **yes** |
| D17 | No reputation aggregation as a competitive feature — **yes** |
| D18 | English-only — **yes** |
| D19 | Lookup truncation: 3900-char ceiling with "…and N more." — **yes** |
| D20 | Webhook handler 25-sec safety: log + 200 OK on overrun — **yes** |
| D21 | Reply-keyboard auto-hide via `one_time_keyboard: true` (no manual remove) — **yes** |
| D22 | Pause blocks both new drafts AND in-flight Publish — **yes** |
| D23 | Boot validation rejects missing/invalid env vars before listening — **yes** |
| D24 | SIGTERM graceful shutdown with 5-sec drain, 8-sec hard ceiling — **yes** |
| D25 | Postgres pool `max: 5` — **yes** |
| D26 | Denied admin attempts logged to `admin_audit_log` (`denied=true`) — **yes** |
| D27 | TS `strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` — **yes** |

---

## 19. Trust model & data handling

### 19.1 Trust model

- **Admins**: fully trusted. Whitelisted by `TELEGRAM_ADMIN_IDS`. Compromise mitigation = remove the ID from env var, redeploy.
- **Reviewers**: untrusted. Rate-limit (5/24h), cooldown (72h same target), public `@username` requirement, `request_users` filter excluding bots — together raise burner-account friction.
- **Targets**: not authenticated. Bot does not consult target before posting; consistent with vouch culture. Disputes via `/remove_entry`.
- **Telegram itself**: trusted as auth provider. Webhook secret verifies inbound; bot token authenticates outbound.

### 19.2 Compromise procedures

- **Bot token leaked** → BotFather `/revoke` → set new token in Railway → redeploy → `npm run telegram:webhook`.
- **Webhook secret leaked** → rotate env var → redeploy → `npm run telegram:webhook` writes new secret; old becomes invalid.
- **Database breached** → restore from Railway snapshot + last cold backup. Stored data: telegram IDs, public `@username`s, first names. No phone/email/PII beyond.
- **Admin account hijacked** → drop ID from `TELEGRAM_ADMIN_IDS` → review `admin_audit_log` → roll back via `/recover_entry` / `/unfreeze`.

### 19.3 Data handling

- **Stored**: Telegram numeric IDs, public `@username` snapshots, first names (optional), entry result + tags + timestamps, source-message metadata for legacy imports, audit log of admin actions.
- **Not stored**: phone numbers, emails, message text beyond legacy parser's review-report excerpts.
- **Soft delete**: `vouch_entries` deleted via `/remove_entry` get `status='removed'`; row preserved for audit. Hard delete via SQL only.
- **Hard delete**: `vouch_drafts` rows replaced per draft; expired ones janitored at >24h.
- **Subject access / right to be forgotten**: admin SQL-deletes a reviewer's entries on request. Document in handoff; no self-serve in v1.
- **Group post visibility**: entries posted to a Telegram group; that group's membership rules govern who sees them.

---

## 20. What's deferred

- Bot avatar / picture upload (manual BotFather; defer until copy lands).
- `/audit_log` command surface (DB inspection sufficient v1).
- Per-group time-zone display (UTC ISO date everywhere; document).
- Sentry-style error tracker.
- Pinning runtime dep versions.
- Multi-language support.
- Web App / Mini App.
- Reputation leaderboards.
- Dispute / appeal flow.
- Reactions on entry messages.
- `exactOptionalPropertyTypes: true` (TS) — wide existing-code impact; defer.
- Husky / lint-staged pre-commit hooks (solo-dev: not warranted).

---

## 21. Source citations

**Telegram Bot Platform docs:**

- `core.telegram.org/bots` — overview
- `core.telegram.org/bots/features` — commands, deep links, menu button, privacy mode, keyboards
- `core.telegram.org/bots/api` — endpoint reference
- `core.telegram.org/bots/api#formatting-options` — HTML / MarkdownV2
- `core.telegram.org/bots/api#setwebhook` — `secret_token`, `allowed_updates`, `max_connections`, `drop_pending_updates`
- `core.telegram.org/bots/api#inlinekeyboardbutton` — `callback_data` 64-byte limit
- `core.telegram.org/bots/api#sendmessage` — 4096-char limit
- `core.telegram.org/bots/api#replykeyboardmarkup` — `one_time_keyboard` auto-hide
- `core.telegram.org/bots/api#setmessagereaction` — reactions
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

**Other:**

- `orm.drizzle.team/docs/migrations` — drizzle-kit migrations
- `node-postgres.com/api/pool` — pool config
- `pino.io` — log redact paths
