# Go-Live Checklist — VouchVault

Run this top-to-bottom before flipping the bot on for real members. Every step is verifiable; no step says "trust me." If a step fails, fix it before continuing. **Do not push to Railway with any unchecked item below.**

For deeper context on each step see `DEPLOY.md` (the multi-step Railway runbook), `docs/runbook/opsec.md` (operating posture), and `docs/runbook/telegram-references.md` (canonical Telegram refs).

---

## 0. Pre-flight (local, before pushing to Railway)

- [ ] **Tests pass:**
   ```
   npm test
   ```
   Expected: `pass <N>` / `fail 0` (currently 178+).

- [ ] **Type-check clean:**
   ```
   npx tsc --noEmit
   ```
   Expected: no output.

- [ ] **No uncommitted secrets:**
   ```
   git status
   git diff --cached
   ```
   `.env*` files are gitignored. If `git status` shows any `.env`, do not stage it.

- [ ] **Recent commits look right:**
   ```
   git log --oneline -10
   ```
   Confirm the changes you intend to ship are in the log.

---

## 1. Pre-stage backup group (do this BEFORE anything goes wrong)

Per OPSEC §3. The backup group is the recovery path when (not if) the live group gets banned.

- [ ] Create a second private supergroup, identical settings to the host group (private, request-to-join, member permissions matching the live host group).
- [ ] Add ALL admins to the backup group; confirm each has joined.
- [ ] Pre-load the bot as admin in the backup group (Add Member → bot username → promote with `can_delete_messages`).
- [ ] Privately record the backup group's chat ID. **Don't commit it. Store in a password manager or admin-only DM.**
- [ ] Test the backup readiness: temporarily set `TELEGRAM_ALLOWED_CHAT_IDS` to the backup chat ID locally and run `npm run telegram:onboarding -- --dry-run`. Confirm clean output. Reset env after.

---

## 2. Railway environment

- [ ] In Railway → Variables (bot service), set:
   - `DATABASE_URL` (set automatically by Railway when Postgres is attached — verify it's there)
   - `TELEGRAM_BOT_TOKEN` (from BotFather)
   - `TELEGRAM_ALLOWED_CHAT_IDS` (comma-separated; live host group chat ID. Optionally also include the backup group chat ID.)
   - `TELEGRAM_ADMIN_IDS` (comma-separated Telegram user IDs of admins)
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN` (32 hex bytes; required in production)
   - `NODE_ENV=production`
   - `LOG_LEVEL=info` (optional; default is info)

- [ ] Verify the values match what `src/core/bootValidation.ts` expects:
   - `TELEGRAM_BOT_TOKEN` shape: `<digits>:<alnum_-+>`
   - `TELEGRAM_ALLOWED_CHAT_IDS`: comma-separated integers (group IDs are negative)
   - `TELEGRAM_ADMIN_IDS`: comma-separated integers (user IDs are positive)
   - `TELEGRAM_WEBHOOK_SECRET_TOKEN`: 1-256 chars `[A-Za-z0-9_-]`

---

## 3. Database

- [ ] **Migrations run automatically on boot** (`server.ts` calls `migrate()` before listening). No manual step. After first deploy:
   ```
   psql "$DATABASE_URL" -c "SELECT id, hash FROM __drizzle_migrations ORDER BY id DESC LIMIT 5"
   ```
   Confirm the latest migration is `0008_add_private_note.sql`.

- [ ] **Backups enabled:** Railway → Postgres service → Settings → Backups → ensure a daily snapshot is configured.

---

## 4. Bot identity (BotFather setup)

- [ ] In BotFather: `/mybots` → select your bot → Bot Settings → **Group Privacy → Turn off**.
   This is required for the bot to receive ALL member messages (not just commands). Without this, chat moderation can't fire.

- [ ] BotFather → Bot Settings → **Allow Groups: Yes**.

- [ ] Name and short description set (will be overwritten by `npm run telegram:onboarding` in step 6).

---

## 5. Webhook + onboarding

- [ ] **Register the webhook:**
   ```
   npm run telegram:webhook
   ```
   This sets the URL to `<PUBLIC_BASE_URL>/webhooks/telegram/action` and sets `allowed_updates` to `["message", "edited_message", "callback_query", "my_chat_member", "chat_member"]`.

- [ ] **Confirm webhook health:**
   ```
   npm run telegram:webhook -- --info
   ```
   Expected output: `url` matches Railway public URL, `pending_update_count` is 0, `last_error_message` is empty, `allowed_updates` includes `edited_message`.

- [ ] **Run onboarding** to set bot description, commands menu, and pin the guide:
   ```
   npm run telegram:onboarding -- --pin-guide
   ```

- [ ] **Verify the bot's profile in a fresh Telegram client:** description matches the welcome / about copy, commands menu shows the documented commands.

---

## 6. Bot permissions in each allowed chat

For EACH chat ID in `TELEGRAM_ALLOWED_CHAT_IDS`:

- [ ] Add the bot as administrator in Telegram → group settings → Administrators → Add.
- [ ] Grant `Delete messages` permission. (This is the only admin permission v6 moderation needs.)
- [ ] No need to grant ban/restrict/pin permissions unless the operator wants to use Telegram-native admin actions on the bot account.

---

## 7. Verify boot (Railway logs)

- [ ] Tail Railway logs after deploy. Within ~5 seconds of boot you should see:
   ```
   server listening
   chatModeration: bot status in <chatId>: administrator
   ```
   per allowed chat.

- [ ] If any chat shows `chatModeration: bot is NOT admin in <chatId>` warn line — go back to step 6 and grant admin in that chat.

- [ ] **`/healthz` returns 200:**
   ```
   curl -i https://<your-railway-url>/healthz
   ```

- [ ] **`/readyz` returns 200:**
   ```
   curl -i https://<your-railway-url>/readyz
   ```
   `/readyz` runs the DB probe + Telegram `getMe` probe. If 503, check the response body or Railway logs.

---

## 8. Member-chat decision (host group)

The strongest defence against takedown is bot-only-post (per OPSEC §2 — "Member permissions: members cannot send messages, cannot change group info, cannot pin messages"). Pick one:

### Option A — Bot-only-post (recommended)

- [ ] Telegram → host group → group settings → Permissions → **Send messages: OFF** for members.
- [ ] **Recommended also:** Send media OFF, Send links OFF, Send polls OFF.
- [ ] Chat-moderation code is dormant. Members can't post; the bot is the only sender.

### Option B — Member chat enabled

- [ ] Telegram → host group → group settings → Permissions → **Send messages: ON** for members.
- [ ] **Recommended:** Slow Mode 30 seconds. Send media OFF. Send links OFF. Send polls OFF.
- [ ] Chat-moderation activates automatically. Watch `admin_audit_log` for `command='chat_moderation:delete'` rows.
- [ ] Higher takedown risk than Option A. Backup group from step 1 is critical.

---

## 9. End-to-end smoke test

Run as a non-admin member account if possible (or a separate Telegram account designated as the test account):

- [ ] **Vouch flow (POS):**
   - Tap **Submit Vouch** in the host group.
   - DM bot opens, prompts for target.
   - Send `@<some-real-username-in-the-group>`.
   - Choose "Positive" outcome, pick at least one tag, tap Done, tap Publish.
   - Verify in the host group: a structured vouch entry appears with `<b>POS Vouch &gt; @target</b>` heading.
   - Long-press the post → Telegram should NOT show "Forward" or "Save". (`protect_content` working.)
   - Tap-to-copy `#42` (entry ID) at the bottom.

- [ ] **Vouch flow (NEG / private):**
   - Repeat the flow, choose "Negative" outcome, optionally add an admin-only note.
   - Confirm.
   - **No group post appears.** The DM shows "Concern recorded as #N — admins will see it; the wider group will not."
   - As a non-admin in the group, run `/search @<target>`. Expected: `Status: Caution` plus Positive/Mixed counts (no Negative count visible).
   - As an admin, run `/lookup @<target>`. Expected: full audit list including the NEG entry with the admin-only note rendered.

- [ ] **Member commands:**
   - As a non-admin in the host group, run `/recent`. Should NOT see the NEG entry from above. (Privacy fix `5a15cac`.)
   - As a non-admin, DM bot `/lookup @<target>`. Expected: `Admin only.` reply (denied audit row written).

- [ ] **If chat enabled (Option B above):**
   - Member posts `pm me about the thing`. Bot deletes within ~1s. Member receives DM warning (if they `/start`-ed before).
   - Member posts `Pos vouch @x`. Bot deletes (vouch_heading regex). Member receives "vouches must go through the bot" DM.

- [ ] **Admin ops:**
   - Admin runs `/freeze @x community_concerns`. Confirm `/search @x` shows `Status: Frozen`.
   - Admin runs `/unfreeze @x`. Status returns to Active or Caution.

- [ ] **Audit log:**
   ```
   psql "$DATABASE_URL" -c "SELECT created_at, command, target_username, denied FROM admin_audit_log ORDER BY created_at DESC LIMIT 20"
   ```
   Confirm the smoke-test actions are all logged.

---

## 10. Legacy data (one-time, if migrating from a previous deployment)

If you have legacy public NEG posts in the host group from before v1.1:

- [ ] List them:
   ```
   psql "$DATABASE_URL" -tAc "SELECT id FROM vouch_entries WHERE result='negative' AND status='published' AND published_message_id IS NOT NULL ORDER BY id"
   ```
- [ ] For each id, run `/remove_entry <id>` from an admin account. Bot deletes the group post and transitions the row to `removed`.
- [ ] Re-run the SQL; expect empty result.

---

## 11. Final verification

- [ ] Members are not yet invited to the host group (or the group is freshly migrated). Once you flip the bot on, the next member message will trigger moderation.
- [ ] Backup group from step 1 is pre-staged and the operator has the chat ID recorded.
- [ ] An admin account is in the operator's DM history with the bot (so admin DMs land).
- [ ] You have a way to rollback: Railway service → Deployments → previous deployment → Redeploy.

---

## 12. Go live

- [ ] Tell the admins: "we're live."
- [ ] Watch Railway logs and `admin_audit_log` for the first day.
- [ ] If anything looks off, `/pause` from any admin to stop new vouches publishing while you triage.

---

## Post-launch operating cadence

- **Daily**: glance at Railway logs and `admin_audit_log` for the first week. Check member-velocity alerts in admin DMs.
- **Weekly**: review `admin_audit_log` for moderation patterns. If a phrase is over-firing, edit `src/core/chatModerationLexicon.ts` and push.
- **Quarterly**: refresh `docs/runbook/telegram-snapshots/` (per its README) — Telegram updates the API and ToS periodically.
- **As-needed**: rotate `TELEGRAM_BOT_TOKEN` or `TELEGRAM_WEBHOOK_SECRET_TOKEN` per `DEPLOY.md` Rotation section.

If the host group goes down: OPSEC §4 migration procedure. Estimated time-to-recovery: 10-15 minutes if the backup group is pre-staged per step 1.
