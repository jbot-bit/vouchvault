# SC45 — group + bot setup runbook

Pre-launch checklist for a clean, hardened deploy. Follow top-to-bottom; nothing here is optional.

## 1. Group setup

### Group bio (description)

Keep it short, plain, no commerce-coded keywords. Recommended:

```
SC45 — community vouch group. Members vouch for people they personally know. Read-only lookup bot pinned in chat.
```

Variants are fine — keep it under ~140 chars, avoid: "marketplace", "deals", "buy/sell", "vendors", "verified", "scam", "drugs", anything in `MARKETPLACE_USERNAME_SUBSTRINGS` (see `src/core/archive.ts`). Plain language wins.

### Group settings

- **Type:** Private group (visibility: Private). Stays private even after launch — see `docs/runbook/opsec.md` §18.
- **Join method:** Request to Join enabled. No public invite link in the group bio.
- **Member permissions:** strip `change_info`, `pin_messages`, `add_users`, `invite_users` from default member rights. Members can `send_messages` only.
- **Slow mode:** 10–30 seconds (reduces brigade-noise, doesn't impact normal vouching).
- **Forwarding & saving:** disable "save content" / enable `protect_content` if your community wants the channel non-screenshottable. Skip if friction outweighs benefit.
- **Group name:** "SC45" or a low-key variant. Avoid: "vouch", "marketplace", "deals", "verified" in the visible name — those cluster as marketplace-coded. Group title is the strongest classifier signal we know about (see `project_takedown_empirical_2026-04-27`).

### Pin order

1. Pinned guide message (output of `buildPinnedGuideText()` — DM the bot, copy from `/start`, or post directly).
2. Optional: pinned policy message — DM `/policy` to the bot, copy the response, post in group, pin it. That's the in-Telegram policy surface (no public URL needed; see `docs/policies/README.md`).

## 2. Bot setup (BotFather)

### Main bot — public-facing

- **Name:** `SC45` (or `SC45 Lookup`).
- **Short description (≤120):** see `buildBotShortDescription()` — `SC45 — DM /lookup @username to search community vouches.`
- **Description (≤512):** see `buildBotDescriptionText()`. **The bootstrap script (`npm run bootstrap`) auto-pushes this on every deploy** via `BOT_DESCRIPTION` / `BOT_SHORT_DESCRIPTION` env vars. Don't edit BotFather by hand — set the envs.
- **About:** same as short description.
- **Profile picture:** plain. No marketplace-coded imagery, no flame/skull/money emojis.
- **Privacy policy URL (BotFather field):** **leave blank**. We surface policy in-Telegram via `/policy`. A public URL adds an external surface and is unnecessary.
- **Privacy mode:** OFF. Required for v9 backup-channel mirror + lexicon moderation to see all messages. See `docs/runbook/opsec.md` §19.
- **Group privacy:** OFF (same setting as above, BotFather wording).
- **Allow groups:** ON.
- **Inline mode:** OFF.

### Lookup bot (if separate handle)

- **Short description:** `buildLookupBotShortDescription()`.
- **Description:** `buildLookupBotDescription()`.

### Admin bot

- **Short description:** `buildAdminBotShortDescription()`.
- **Description:** `buildAdminBotDescription()`.
- Add to group as admin with `can_delete_messages` (required for moderation).

### Bot admin rights in the group

Required for chat moderation to actually delete:

- `can_delete_messages` (mandatory)
- `can_restrict_members` (optional, not used today)
- All other admin rights: OFF.

If admin rights are missing, lexicon moderation silently fails — boot log via `logBotAdminStatusForChats` is the only signal. Check it.

## 3. Env config

Required:

- `DATABASE_URL` — Postgres.
- `TELEGRAM_BOT_TOKEN` — main bot.
- `TELEGRAM_BOT_USERNAME` — without `@`.
- `TELEGRAM_ALLOWED_CHAT_IDS` — the live SC45 chat id (negative integer).
- `TELEGRAM_ADMIN_IDS` — comma-separated.
- `WEBHOOK_SECRET` — random, ≥32 chars.

Mirror (for takedown resilience):

- `VV_MIRROR_ENABLED=true`.
- `TELEGRAM_CHANNEL_ID` — backup channel id (negative).

Optional bot identity overrides:

- `BOT_NAME=SC45`.
- `BOT_DESCRIPTION` — overrides `buildBotDescriptionText()` if set.
- `BOT_SHORT_DESCRIPTION` — overrides `buildBotShortDescription()` if set.

After env changes: `npm run bootstrap` (idempotent) + `npm run telegram:webhook` (re-pushes `allowed_updates`).

## 4. Smoke checks (post-deploy)

1. `/healthz` returns 200.
2. `/readyz` returns 200 (validates DB + Telegram getMe).
3. DM the bot `/start` → SC45 welcome appears, lists `/lookup`, `/policy`, `/forgetme`.
4. DM `/lookup @somerealmember` → entries returned, **case-insensitive** (try `@SOMEREAL` and `@somereal` — both must work). The case fix is in `getArchiveEntriesForTarget` + `getBusinessProfileByUsername` (LOWER on both sides).
5. DM `/policy` → policy message with Telegram-side links (no reporting-channel pointer — see `docs/policies/README.md` "Reporting abuse").
6. DM `/forgetme` → confirmation prompt; reply `YES` → deletion succeeds (use a throwaway test account; this is destructive). Verify only reviewer-side rows are removed; vouches written about the test account stay.
7. Post a commercial-shaped message in the group as a non-admin → auto-deleted, DM warn arrives with "removed by automated moderation" wording.
8. Post a normal vouch in the group → not deleted, mirrored to backup channel (check `mirror_log` row exists).

## 5. Security posture (the "fucking secure" checklist)

- [x] Bot privacy mode OFF (required, but means bot sees every message — log redaction in `logger.ts` covers tokens/secrets/auth, not user content).
- [x] `protect_content` available — toggle on group settings if you want non-screenshottable.
- [x] Webhook URL guarded by `WEBHOOK_SECRET` (`X-Telegram-Bot-Api-Secret-Token` header).
- [x] DB connection pool capped at 10; `statement_timeout` 20s; webhook race window 25s.
- [x] Idempotent webhook delivery — `processed_telegram_updates` unique on `(bot_kind, update_id)`.
- [x] Admin actions audit-logged via `recordAdminAction` (every command, including denials).
- [x] `/forgetme` scoped to reviewer-side data only — scammers can't wipe NEGs about themselves. Blocks the "complicit bot" report vector.
- [x] No public URL surface for policy — `/policy` DM only, optionally pinned in group.
- [x] No bulk bot-authored sends — v9 deleted the templated publish path that drove the V3 takedown.
- [x] Backup-channel mirror via `forwardMessage` — full takedown-recovery substrate without re-sending content (see `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md`).
- [x] Lexicon moderation deletes commerce-shaped posts; no bans/mutes (avoids automation-detection signal).
- [x] `RESERVED_TARGET_USERNAMES` + `MARKETPLACE_USERNAME_SUBSTRINGS` reject vouches against bot-impersonation handles and marketplace-coded usernames at submission time.
- [x] Member /lookup rate-limited to one per 5s (prevents enumeration).
- [x] Account-age guard available (24h floor) — currently not gating, code is in `checkAccountAge` for future re-enable.

## 6. Recovery

If the group is taken down:

1. Spin up a fresh private group.
2. Update `TELEGRAM_ALLOWED_CHAT_IDS` to the new chat id; redeploy.
3. `npm run bootstrap` + `npm run telegram:webhook`.
4. `npm run replay:to-telegram` — replays the backup channel into the new group via `forwardMessages`. Throttled to ≤25 msgs/sec; idempotent via `replay_log`.
5. Re-pin guide + policy.

Full runbook: `docs/runbook/opsec.md` + `DEPLOY.md` §9–10.
