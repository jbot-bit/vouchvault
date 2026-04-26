# VouchVault — OPSEC Runbook

**Audience:** group admins. Plain-English procedures, no code changes.
**Builds on:** `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md` (v1)

This runbook captures the manual hardening posture and disaster-recovery procedure for the VouchVault host group. The code in this repo provides early warning (member-velocity alert, chat-gone admin DM, `/readyz` Telegram probe). This document covers everything else.

---

## 1. Threat model — short version

VouchVault is a private community using a Telegram bot in a moderation environment that has gotten significantly more aggressive in 2026. Daily Telegram takedowns now average ~110K with peaks above 500K, most of them automated. The realistic risks, ranked:

1. **Coordinated mass-report attack** — 50–100 accounts can reliably trigger an automated takedown within 24–48 hours regardless of merit. Mass-report-as-a-service is openly sold on Telegram.
2. **ML keyword/pattern hit** — Telegram's automated moderation is trained on the dropbot/marketplace ecosystem. Communities sharing vocabulary clusters with that ecosystem run an elevated false-positive rate; legitimate communities have been deleted overnight without successful appeal.
3. **Insider report** — a member negatively vouched, or a former admin, hits Report from inside.
4. **Behavioral fingerprint** — uniform timing, identical message structure, lack of human variance. Vendor-claimed and weakly sourced; treat as background risk.

Bots themselves are not a moderation trigger. The platform-shaped *visual signature* (many inline buttons per post, identical templated entries, deep-link onboarding flows clustered with marketplace vocabulary) increases both the report attack surface and the ML fingerprint score.

For full source citations see §9 of the spec doc.

---

## 2. Manual Telegram-side hardening checklist

Apply these once when the group is first set up, and re-verify quarterly. None of this is enforced by code.

- [ ] **Group type:** private supergroup with **Request-to-Join + manual admin approval** enabled. Public supergroups attract drive-by reports; open invite links attract bot accounts.
- [ ] **Member permissions** (Group Settings → Permissions): members **cannot** add new members, **cannot** change group info, **cannot** pin messages.
- [ ] **Slow mode** enabled, recommended setting **10 seconds**. Cuts brigading throughput without disrupting legitimate traffic.
- [ ] **Restrict media:** members may post **text and reactions only**. Only admins may post images, files, GIFs, stickers. This reduces ML-keyword density risk on member-uploaded content (which the bot itself never produces).
- [ ] **Group avatar / name / description:** keep generic and community-flavoured. **No** marketplace language anywhere — avoid: verify, verified, certified, approved, trusted, premium, guarantee, warranty, escrow, deal, vendor, merchant, seller, buyer, exchange, crypto. Treat the group's public profile the same way the bot treats its own description.
- [ ] **Invite link rotation:** retire and regenerate invite links every 30 days. Distribute new links via the bot's existing `/start` deep link, not via external channels.
- [ ] **Admin list:** keep tight (≤5 admins). Each admin is an attack surface; one compromised admin account can dismantle the group.

---

## 3. Backup group — pre-staging

The migration procedure below assumes a backup group already exists. **Set this up while the live group is healthy**, not after the fire starts.

- [ ] Create a second private supergroup with the **identical hardening settings** from §2.
- [ ] Pre-invite all current admins. Confirm each has joined.
- [ ] Send each admin (via bot DM, **not** any external channel) the message: *"If you ever see the live group go, switch to <invite-link>."*
- [ ] Record the backup group's chat ID privately. Do **not** commit it; keep it in a password manager or admin-only DM.
- [ ] Run `npm run telegram:onboarding -- --dry-run` once with the backup group ID set in `TELEGRAM_ALLOWED_CHAT_IDS` to verify everything lines up before you ever need it.

---

## 4. Migration procedure (live group → backup group)

When the live group is gone, ratelimited, or under active attack, switch over. Estimated time: 10–15 minutes if §3 is in place.

1. **Confirm the takedown.** If you got a chat-gone admin DM from the bot, the live group is unreachable. If you got a member-velocity alert and the group is still alive, **pause first** with `/pause` in the live group and triage before migrating.
2. **Update Railway env var:** in Railway → Variables, set `TELEGRAM_ALLOWED_CHAT_IDS` to the backup group's chat ID. Save. Service auto-redeploys (~30–60 s).
3. **Wait for the deploy to come up.** Hit `/readyz` on the public URL — it should return 200. If it returns 503 with a `getMe` error, your bot token is the problem, not the chat (see §6).
4. **Pin the guide and refresh BotFather menu** in the new group:
   ```
   npm run telegram:onboarding -- --guide-chat-id <new-chat-id> --pin-guide
   ```
5. **Refresh the webhook** so Telegram has the new `allowed_updates` set:
   ```
   npm run telegram:webhook
   ```
   This does not change the URL. `getWebhookInfo` confirms health.
6. **Tell members.** DM each admin via the bot with the new invite link.
7. **Optional — replay live history.** See §5. Skip if the new group is starting fresh.

---

## 5. SQL → Telegram-export-JSON recipe (DR)

For replaying live `vouch_entries` into a fresh group as if they were a Telegram export. This is the manual replacement for the deferred `live-DB-to-export-JSON` script.

### Step 1 — dump the entries as JSONL via `psql`

```bash
psql "$DATABASE_URL" -tAc "
SELECT jsonb_build_object(
  'id', id,
  'type', 'message',
  'date', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DDT\"T\"HH24:MI:SS'),
  'date_unixtime', extract(epoch FROM created_at)::int::text,
  'from', '@' || reviewer_username,
  'from_id', 'user' || reviewer_telegram_id,
  'text', target_username || ' ' || result
)
FROM vouch_entries
WHERE status = 'published'
ORDER BY created_at ASC, id ASC;
" > entries.jsonl
```

### Step 2 — wrap in the export envelope

```bash
jq --slurp '{
  "name": "Recovery",
  "type": "private_supergroup",
  "id": YOUR_NEW_CHAT_ID,
  "messages": .
}' entries.jsonl > export.json
```

Replace `YOUR_NEW_CHAT_ID` with the backup group's numeric chat ID.

### Step 3 — replay

```bash
npm run replay:legacy export.json -- --target-chat-id YOUR_NEW_CHAT_ID --throttle-ms 3100
```

The 3100 ms throttle stays under Telegram's 20-messages-per-minute group ceiling with margin.

### Caveats

- **Idempotency.** `replay:legacy` keys on `legacy_source_message_id`. Entries that have already been replayed once are skipped. Re-running the recipe from scratch on a fresh DB is safe.
- **Live entries are absent from any prior export.** They live only in `vouch_entries`. The recipe above includes them; the original Telegram export JSON does not.
- **Reviewers without Telegram users.** If a reviewer has been deleted, `reviewer_telegram_id` is still populated but the `@username` may be stale. The replay reuses the stored username verbatim.

---

## 6. Member-velocity alert — how to respond

The bot DMs every admin when it sees:

- **5+ joins** in a 60-min window in the host group, **or**
- **3+ leaves** in a 60-min window.

Suppression is 60 min per `(chat, kind)` pair. State is in-memory and resets on deploy.

### Response checklist

1. **Pause the bot** with `/pause` in the host group. Stops new vouches from posting while you triage; existing posts stay up.
2. **Open Telegram → group → Recent Actions** (the admin log). Look at the join/leave list:
   - Look for **clusters of accounts with empty bios, no profile photo, recent creation dates, or sequential numeric usernames**. These are the marker of mass-report-as-a-service rented accounts.
   - If joins look organic (real photos, varied creation dates, different usernames), the alert is probably a false positive — a Twitter mention or a Reddit post. Wait it out, unpause.
3. **If clearly coordinated:** kick + ban the accounts you can identify. Telegram's "ban from group" hides them from your member list and stops them reporting from inside.
4. **If the brigading continues** despite kicks: invite-link rotation (§2) cuts the source. Disable the active link, generate a new one, distribute via bot DM to existing members only.
5. **Consider migrating** to the backup group if (a) the brigading persists past 24 hours, (b) you start seeing report-confirmation messages in your admin DMs, or (c) the live group's read-receipts start dropping.

After resolving, `/unpause` to resume vouches.

---

## 7. Appeals contacts

If the live group is taken down, all of these are slow (1–7 days, often longer) and the success rate is low. File appeals anyway — they cost nothing and occasionally work.

- **`recover@telegram.org`** — official email for restoring deleted groups. Include: group name, approximate creation date, member count at time of takedown, your role (admin/owner), and any context about why you believe the deletion was unwarranted.
- **`@SpamBot`** — Telegram's in-app support bot. Type `/start` and follow prompts.
- **In-app support** — Settings → Ask a Volunteer → choose category. Volunteer support can sometimes escalate.

Permanent bans on the bot itself (`getMe` returns 401) are usually unrecoverable. If `/readyz` returns 503 with a Telegram error and stays that way for >24 hours, treat the bot account as dead and provision a new one (new BotFather token, redeploy with the new `TELEGRAM_BOT_TOKEN`).

---

## 8. Quick reference — what the code does for you

| Signal | Source | What you should do |
|---|---|---|
| Bot DM: "Group `<id>` appears to have been deleted by Telegram." | `chatGoneHandler` (typed `TelegramChatGoneError`) | Migrate per §4. The bot has already stopped posting to that chat; you do not need to pause it. |
| Bot DM: "Member-velocity alert in `<id>`: N joins / M leaves in last 60 min." | `memberVelocity` | Triage per §6. |
| `/readyz` returns 503 with `getMe`-related error | `src/server.ts` Telegram probe | Bot account itself is the problem, not the chat. Check `TELEGRAM_BOT_TOKEN` validity, then §7 if it's a ban. |
| `/readyz` returns 503 with DB-related error | `src/server.ts` DB probe | Postgres / Railway DB add-on issue. Check Railway logs, restart pg add-on if needed. |
| `/readyz` returns 200 | — | Both probes healthy. Any user-facing problem is a Telegram-side rate-limit or chat-config issue. |

---

## 9. What this runbook does **not** cover

- **Code-level changes.** Adding new commands, schema migrations, etc. — those are spec'd separately under `docs/superpowers/specs/`.
- **Member dispute resolution.** Handle in-group, no automation.
- **Negative vouch retraction.** Use `/remove_entry <id>` if the entry was made in error; document the rationale in the admin audit log via `recordAdminAction({ reason: ... })`.
- **Pavel Durov's legal status.** Not actionable from the admin side. Watch the news; if Telegram itself goes down or pivots, this runbook is moot and you start from a different threat model.
