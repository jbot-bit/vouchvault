# SC45 Portal — bot-gated entry, no public group link

**Date:** 2026-05-02
**Audience:** maintainers (next session picking this up)
**Status:** spec only — no code yet. PR #48 (live-trainable lexicon + group warn) is the prerequisite and ships first.
**Builds on:** `docs/runbook/opsec.md` §1 (Request-to-Join posture), migration `0013_invite_links` (existing infra), v9 simplification spec.

## 1. Why

Today, SC45's invite link is plain Telegram. Anyone with the link enters; Request-to-Join gives the operator manual approval but no programmatic gate. Hostile actors can scrape/share the link off-platform.

Balf's pattern (per the user, observed in TBC and similar communities) flips this: **the bot is the only public surface; the group invite is never publicly exposed.** Entry only happens *through* the bot, after a verification gate of the operator's choosing.

This spec covers the entry portal. It does **not** cover lexicon, vouch flow, or any other v9 surface.

## 2. The hard Telegram constraint

Bots **cannot** add users to private groups. Period. Three other constraints worth noting:

- The user has to follow some invite link or be approved on a join request.
- A user can DM a bot for ~5 minutes after submitting a join request even without `/start` (Telegram's join-request DM window).
- A bot can DM a user freely once they have `/start`-ed it (with deep-link payloads, the `/start` and the verification can be the same step).

So "no link given out at all" is impossible. The closest you can get is: the link is short-lived, single-use, and only handed out behind a verification gate.

## 3. Design

### 3.1 The three composable gates

1. **Public surface = bot only.** `t.me/<sc45_bot>?start=portal` is the only thing shared off-Telegram. Tapping opens DM, auto-sends `/start portal`. No group link in the wild.
2. **Bot DM = the verification gate.** Whatever shape the operator wants — welcome copy, age click-through, agreement to rules, anti-scraper friction (e.g. a 5s delay + button tap, which kills naive scripts). Lives entirely in DM. The deep-link `/start <payload>` is itself the start, so a user doesn't need a prior `/start`.
3. **Issued, ephemeral invite link.** After the gate, the bot calls `createChatInviteLink` with `member_limit: 1` + `expire_date: now + 15min` and surfaces it as a URL button. User taps → joins (or submits a join request which the bot auto-approves because it issued the link). The link IS technically handed over, but it dies after one use AND a short TTL — sharing it is futile by the time anyone tries.

### 3.2 Anti-abuse

A naïve portal can be burned by a script: spam `/start portal` 1000 times, get 1000 invite links, redistribute. Mitigations:

- **Rate-limit issuance per user**: at most N portal entries per Telegram user-id per rolling window (e.g. 1 per 24h). Cached + persisted to DB so it survives restart.
- **Account-age floor**: same `ACCOUNT_AGE_FLOOR_HOURS` we already gate vouches with (24h — see `accountAge.ts` if it exists, or `userIdBand.ts` for the band classifier). Reject portal entries from accounts < 24h old; user gets a clear "come back later" message.
- **Issued-link audit**: every issued link goes into `invite_links` (table already exists from migration 0013). On `chat_member` join updates, the existing `recordInviteLinkUsed` hook should already fingerprint who used which link.
- **Verification challenge**: the gate should require a *button tap*, not just a `/start`. Tapping an inline keyboard button sends a `callback_query` — that's the trivial human-loop check. If we want stronger anti-bot, we could time-gate the tap (must be ≥3s after DM, ≤5min) — easy to add later.

### 3.3 What the operator changes

- Group settings: invite link revoked from any public location (off-platform channels, etc.). Replaced with `t.me/<sc45_bot>?start=portal`.
- Existing `scripts/generateInviteLink.ts` keeps working for admin-issued one-offs (out-of-band invites). The portal does **not** replace that — it complements it.
- Request-to-Join stays enabled (per OPSEC §1). The bot's auto-approval handles join requests for users who came through the portal; manual approval handles anything else.

## 4. Scope of work (next session — start here)

### 4.1 New code

- **`telegramTools.ts`**: `createChatInviteLink` wrapper (Bot API method `createChatInviteLink`, returns `{ invite_link, name?, ... }`). Match the existing signature shape (input object, logger, retry wrapper).
- **`portalStore.ts`**: DB ops for the rate-limit table. New migration `0017_portal_entries.sql` — table tracks `(telegram_id, started_at, completed_at, invite_link_id, decline_reason)`. Unique index for the rate-limit query.
- **`portalFlow.ts`**: pure orchestration — given a Telegram user, decide: rate-limited? account-too-young? gate-not-passed? issue link? Returns a discriminated-union result the handler renders. Pure (no DB / Telegram), tested with injected loaders.
- **`telegramBot.ts`**:
  - `/start portal` deep-link branch in `handlePrivateMessage`. Routes to portal flow stage 1 (welcome + button).
  - Callback handler for the portal verification button (e.g. `pt:ok`). Stage 2 — issues the invite link.
  - `chat_join_request` update branch in `processTelegramUpdate` — auto-approves if the requester came through the portal in the last N hours (matched via the issued-link fingerprint), otherwise leaves the request pending for manual approval.

### 4.2 New copy (in `archive.ts`)

- `buildPortalWelcomeText` — locked text, like `buildWelcomeText`. The verification-gate intro.
- `buildPortalVerifyMarkup` — inline keyboard with "Enter SC45" callback button.
- `buildPortalIssuedText` + `buildPortalIssuedMarkup` — post-verification message with the URL button to the issued invite link. Note: the URL button surfaces the issued link in plaintext when the user taps "view URL", which is acceptable since the link is ≤1 use + ≤15min.
- Reject copies: rate-limited, account-too-young, gate-not-passed.

Spec-locked: every new builder gets byte-stable tests in `archiveUx.test.ts`.

### 4.3 Tests

- `portalFlow.test.ts` — pure orchestration tests with injected loaders (rate-limit checker, account-age checker, link issuer mock). Covers all 4 outcomes.
- Callback-data byte-length test in `callbackData.test.ts` (new prefix `pt:`).
- `archiveUx.test.ts` — byte-stable copy assertions.

### 4.4 Operator runbook updates

- `DEPLOY.md`: post-deploy command to rotate the public bot link share-out. Note that the previous group invite link should be revoked.
- `docs/runbook/opsec.md`: new §22 — portal posture, rate-limit tuning, what to do if the bot account itself gets nuked (the public bot link is a SPOF — fall back to manually-issued invites via `scripts/generateInviteLink.ts`).

## 5. Open questions for the next session

1. **What's the verification gate copy actually say?** Probably mentions community rules + the vouch system. Worth pulling from existing welcome text to keep voice consistent.
2. **Auto-approve join requests, or wait for admin?** Spec assumes auto-approve when fingerprint matches, manual otherwise. User may want stricter.
3. **Should the portal also be the canonical re-entry path for existing members?** I.e. if SC45 gets nuked and we move to a backup group (per takedown-resilience spec), do existing members go through the portal again? Probably yes — it's the only public surface anyway.
4. **Anti-scraper friction strength.** The 5s+button-tap floor is light. Worth measuring after launch — if scrapers blow through, time-gate the tap or add a tiny captcha.
5. **DB retention.** `portal_entries` will grow. Cleanup policy: keep completed rows N days, declined rows shorter. Tune in v2.

## 6. Out of scope (do NOT scope-creep into)

- The lexicon itself. PR #48 already shipped live-train.
- The vouch flow. v9 spec is the canonical source.
- Replacing Request-to-Join. Stays enabled; the portal complements it, doesn't replace it.
- Per-user "membership status" tracking beyond what's needed to fingerprint join requests.
