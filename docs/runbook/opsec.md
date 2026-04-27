# VouchVault — OPSEC Runbook

**Audience:** group admins. Plain-English procedures, no code changes.
**Builds on:** `docs/superpowers/specs/2026-04-26-takedown-resilience-design.md` (v1) + `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md` (v9, current).

This runbook captures the manual hardening posture and disaster-recovery procedure for the VouchVault host group. The code in this repo provides early warning (member-velocity alert, chat-gone admin DM, `/readyz` Telegram probe). This document covers everything else.

> **v9 note:** Sections §1–§17 below were written against the v6/v8 architecture (DM wizard + templated channel-relay publish). v9 phase 3 deleted the wizard and templated publish path; the channel is now a forward-only mirror, not a publish target. Where §1–§17 reference `VV_RELAY_ENABLED`, "DM wizard publishes," "channel-discussion auto-forward," or templated `POS Vouch > @target` posts, the v9 reality is: members post in group; bot mirrors via `forwardMessage` (`VV_MIRROR_ENABLED=true`). **Sections §18–§21 are the current authoritative posture** — read those first; treat the older sections as historical context for setup steps and recovery procedures that still apply structurally.

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

- [ ] **Group type:** private group, **not** private supergroup, until member count forces the upgrade. Group-type was the single largest variable separating a dead community from a surviving one in the 2026-04-27 same-operator natural experiment (see §18). Once the group auto-upgrades at the 200-member threshold (or when an admin toggles a feature that requires supergroup), enable **Request-to-Join + manual admin approval**. Public supergroups attract drive-by reports; open invite links attract bot accounts.
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

For replaying live `vouch_entries` into a fresh group's DB. **Replay-as-DB-only:** since the unified-search-archive design (`docs/superpowers/specs/2026-04-26-unified-search-archive-design.md`), `replay:legacy` only writes to the DB and does **not** post anything to the host group. This eliminates V3's takedown vector (a 2,234-message bulk republish in 24h producing a spam-ring fingerprint). Entries become queryable via the admin `/lookup @username` surface (the bot's `/search` and `/recent` were removed in v8.0); they do not appear in the Telegram chat history of the new group. To surface replayed legacy in-group, run `npm run replay:to-telegram` separately — it uses Bot API `forwardMessages` against archived channel posts and is the only path that lands legacy entries in the supergroup post-takedown. The `--throttle-ms` flag on the replay command is now a no-op (kept for backward CLI compatibility) since there are no Telegram sends to throttle.

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

### Step 3 — replay (DB only)

```bash
npm run replay:legacy export.json -- --target-chat-id YOUR_NEW_CHAT_ID
```

No Telegram posts are sent. Entries are inserted with `status='published'` and `published_message_id IS NULL`. The unified privacy predicate in `archiveStore.ts` (used by admin-only `/lookup`) recognises legacy archive rows via `source='legacy_import'`. After running `npm run replay:to-telegram` the legacy POS/MIX surface lands in the supergroup as forwards and becomes searchable via Telegram's native in-group search.

### Caveats

- **Idempotency.** `replay:legacy` keys on `legacy_source_message_id`. Entries that have already been replayed once are skipped. Re-running the recipe from scratch on a fresh DB is safe.
- **Live entries are absent from any prior export.** They live only in `vouch_entries`. The recipe above includes them; the original Telegram export JSON does not.
- **Reviewers without Telegram users.** If a reviewer has been deleted, `reviewer_telegram_id` is still populated but the `@username` may be stale. The replay reuses the stored username verbatim.
- **No host-group footprint.** The new group's chat history starts empty regardless of how many legacy entries are replayed. This is intentional — bulk-publishing into a fresh group was V3's takedown vector.

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

## 6a. Lexicon reference — derived from peer-group export 2026-04-26

Numbers below come from a one-time scan of a 9,706-message export from a peer drug-trade circuit, used as adversarial training data for this bot's hardening. Patterns appear here for admin reference; the runtime defence is the username-substring deny-list in `src/core/archive.ts:MARKETPLACE_USERNAME_SUBSTRINGS`.

| Cluster | Volume in 9.7k corpus | Examples |
| --- | --- | --- |
| Drug-direct vocab | 291 hits | bud, gas, coke, shrooms, carts, tabs, meth, oxy, fire |
| Buy-sell verbs | 320 hits | pm me, selling, buy, sell, hit me up |
| Money-codes | 1,007 hits | 1k, 2k, rack, paid, transfer |
| Delivery-trade | 282 hits | drop, meet, pickup, post, f2f |
| Vendor-roles | 235 hits | guy, plug, dealer, vendor, supplier |
| Stealth-shipping | 11 hits | vac seal, smell proof, seized, customs |
| Burner-comms | 69 hits | signal, threema, wickr |
| Doxing patterns | rare but catastrophic | "Name: …", "Current Address: …" |

What admins watch for in `/lookup @x` `private_note` text: any of the above clusters, especially doxing-pattern + drug-direct co-occurrence; that combination is the highest-priority `/freeze` signal.

This is documentation only — no runtime consumer beyond the substring deny-list referenced above. When member chat returns under a future spec (chat-group + linked discussion), the runtime regex gate that lives on that surface will consume the same lexicon.

---

## 6b. Chat moderation — admin reference

The bot moderates every member message in any allowed chat using the lexicon defined in `src/core/chatModerationLexicon.ts`. Policy:

> **Lexicon hit → delete the message + best-effort DM warn.** No bans, no mutes, no strikes, no decay.

Two pattern families:

1. **Commerce-shape phrases** (~36 entries): `pm me`, `hit me up`, `selling`, `pickup`, `wickr`, etc.
2. **Vouch-shape regexes** (3 patterns): `POS/NEG/MIX vouch`, `vouch for @username`, `+vouch / -vouch`. Catches members trying to publish vouches by typing the format in chat instead of going through the bot. The bot's own published vouches are skipped via the `is_bot` + id-equals-bot self-check.

A hostile actor who keeps posting hits keeps having their posts vanish — they accomplish nothing, but accumulate audit-log noise. **Operators handle persistent abusers manually** via Telegram-native group settings (kick / ban / restrict). The bot does not auto-ban — false-positive cost is bounded to one deleted message + one DM, and that's appropriate for a community where genuine members occasionally slip up.

**Inspect recent moderation events:**

```
psql "$DATABASE_URL" -c "SELECT created_at, target_chat_id, target_username, reason FROM admin_audit_log WHERE command='chat_moderation:delete' AND created_at > now() - interval '7 days' ORDER BY created_at DESC"
```

**Bot exemptions:** the bot's own messages are skipped (`is_bot` flag + id check). Inline-bot relays (`via_bot` set) are skipped. Admins are audit-logged but enforcement is skipped — admins don't get their own messages auto-deleted.

**Manual ban/kick:** Telegram → group settings → Members → tap the user → Remove / Ban. No bot command needed.

**Update the lexicon:** edit `PHRASES` (or `REGEX_PATTERNS`) in `src/core/chatModerationLexicon.ts`, commit, push. Railway redeploys.

**Bot admin-rights check:** the bot logs its admin status in every allowed chat at boot. Check Railway logs for `chatModeration: bot status in <id>: <status>`. If status is anything other than `administrator` or `creator`, moderation will silently fail in that chat — fix the permissions in Telegram. The bot needs `can_delete_messages` (the only Telegram admin permission required by v6 moderation).

**First-DM gap:** members who have never `/start`-ed the bot receive no removal notice (Telegram blocks bot-initiated DMs). Their message is still deleted; only the warning DM is silently lost. The welcome and pinned guide instruct members to `/start` once; members who ignore that won't get the DM, but the moderation still works. Acceptable.

**Webhook allowed_updates:** chat-moderation requires `edited_message` in the webhook's `allowed_updates`. After deploying the v4+ chat-moderation code, run `npm run telegram:webhook` once to refresh the server-side webhook config. Confirm with `npm run telegram:webhook -- --info`.

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

---

## 10. TBC26 mirror posture (v6)

The v6 architecture (`docs/superpowers/specs/2026-04-26-vouchvault-impenetrable-architecture-v6.md`) is matched to TBC26's surviving practices, **not** their experimental ones. Three takedown events between 2025 and 2026 taught TBC26 that bot/supergroup/admin-account redundancy and channel-as-archive recovery beat any single hardening trick. We rebuild a cleaner version of the same shape.

### 10.1 Operator bot stack (3 bots total — v6 simplification 2026-04-27)

| Bot | Role | Privacy mode | Token env var |
|---|---|---|---|
| **Ingest** (`@VouchVault_bot`) | DM wizard → DB write → channel publish; admin commands + chat-moderation in supergroup | **OFF** (needs to see auto-forwarded messages in supergroup for relay capture; needs full chat visibility for moderation) | `TELEGRAM_BOT_TOKEN` |
| **Captcha** (`@GroupHelpBot` or `@shieldy_bot`) | Username-required + captcha at join | n/a (off-the-shelf) | n/a |
| **User-history** (`@SangMata_beta_bot`) | Members query `@SangMata_beta_bot allhistory <user_id>` | n/a (off-the-shelf). Free tier has a **daily quota** that TBC26 hit during high-traffic days (KB:F2.27). If quota is exhausted, fall back to `@userinfo3bot` (BALFROCAK's own backup recommendation per KB:F2.27 msg 30587). | n/a |

**v6 originally specced 5 bots** (separate Lookup + Admin in addition
to Ingest). Both dropped 2026-04-27 per user direction. **v8.0 commit 2
removed `/search` and `/recent` entirely** as the final step of this
simplification:

- The channel-relay path is on. Every published vouch lands in the
  supergroup via auto-forward; mass-forward replay backfills legacy
  POS/MIX into the supergroup. **Telegram's native in-group search
  handles discovery** — members tap the supergroup's search bar and
  type an @handle. No custom lookup bot needed; no `/search` or
  `/recent` shim either.
- `/lookup @username` remains as the **admin-only** caution + freeze
  + full-audit surface. Members never invoke it.
- A separate admin bot is plumbing (token rotation, BotFather setup,
  separate webhook) for marginal failure-domain isolation. At our
  scale a single ingest bot is the right shape. If a specific failure
  mode justifies a split later, provision then with a fresh spec.

Smaller than TBC26's 21-bot stack. Add more only when a specific gap
surfaces. The schema's `bot_kind` column on `processed_telegram_updates`
is future-proofed for the multi-bot case if/when it returns.

### 10.2 Distribution

- Single Request-to-Join invite link. Manual approval per request.
- Never share publicly. Distribute via the bot's `/start` deep-link or via existing-member DM.
- **No folder distribution.** TBC26's leaked folder (KB:F4.3) was the attack vector that hit their sister groups. We don't run sister groups, but the principle holds.

### 10.3 Growth pacing

- **First month after launch:** ≤10–20 Request-to-Join approvals per day.
- **Established (≥3 months in):** ≤50/day.
- **During recovery event (post-takedown):** caps lifted; one-time spike acceptable.
- **Members can invite — but only via the bot's deep-link.** Raw link sharing is disabled at the supergroup permission level.

### 10.4 Account hygiene

- Bot tokens created from a Telegram user account active for ≥6 months. Fresh accounts creating bots = fast classifier-driven bans.
- New bots warmed in a low-traffic test group for 1–2 weeks before production rollout.
- Privacy mode for the ingest bot DISABLED in @BotFather (per §10.1).
- At least one alt admin account in case main is compromised.

---

## 11. Channel-pair operator setup + recovery procedure

### 11.1 Concept

The architecture target (v6 §2, §4) is a **forum-mode supergroup linked to a channel via Telegram-native channel-discussion**. The bot publishes to the channel; Telegram auto-forwards into the supergroup's General topic. The channel **survives independently** of the supergroup — that's the END ROAD WORK pattern (KB:F2.3) and our primary takedown-recovery asset.

```
                 VouchVault Archive (channel, broadcast type)
                          │
                          │ channel-discussion link (auto-forward)
                          ▼
                 VouchVault (forum-mode supergroup)
                 Topics: Vouches | Chat | Banned Logs
```

### 11.2 One-time setup checklist

- [ ] Create the **VouchVault Archive** channel (broadcast type, private, manual subscribe).
- [ ] Convert the existing supergroup to **forum mode** (Group Settings → Topics).
- [ ] Create the three topics in this order: **Vouches** (renamed from default General), **Chat**, **Banned Logs**. The topic auto-forwarded posts land in is the General topic — keep that as Vouches. (v6 originally specced 4 topics including Lookups; dropped 2026-04-27 since Telegram's native search makes a lookup-results topic redundant.)
- [ ] In the channel: Settings → Discussion → link the supergroup. Telegram now auto-forwards channel posts into the supergroup's General topic with `is_automatic_forward: true` and `forward_origin.type: "channel"` (Bot API 7.0+).
- [ ] Add the **ingest bot** to the channel as admin with `post_messages` only. Add it to the supergroup as admin with `can_delete_messages` (for moderation) + read access for relay capture.
- [ ] Set env vars in Railway: `TELEGRAM_CHANNEL_ID`, optional `TELEGRAM_ADMIN_BOT_USERNAME` (used in moderation DM warning fallback). Set `VV_RELAY_ENABLED=true` only after verifying the channel-discussion link works manually (post a test message in the channel and confirm it auto-forwards into the General topic).
- [ ] Run `npm run telegram:webhook` to refresh `allowed_updates`.

### 11.3 Recovery — supergroup gone, channel survives

This is the canonical recovery procedure for a takedown event (replaces §4 above when the channel-pair is in place).

1. **Confirm the takedown.** Channel still reachable in Telegram, supergroup is gone or `chat not found`.
2. **Create a new private supergroup** with the §2 hardening settings + forum mode + the three topics from §11.2.
3. **Link the new supergroup to the surviving channel** as discussion group. New posts to the channel will auto-forward into the new supergroup going forward.
4. **Replay the channel archive into the new supergroup** via the mass-forward script (added in v6 commit 7):

   ```bash
   npm run replay:to-telegram -- --destination-chat-id <new-supergroup-id>
   ```

   The script reads the DB for all `vouch_entries` rows with `channel_message_id IS NOT NULL` and forwards each from the channel to the new destination via `forwardMessages` (Bot API 7.0+, batches up to 100 per call, throttled ≤25 msgs/sec). Idempotent via the `replay_log` table — safe to rerun.

5. **Update env vars** in Railway: change `TELEGRAM_ALLOWED_CHAT_IDS` to the new supergroup ID. Service redeploys.
6. **Pin the guide** in the new supergroup: `npm run telegram:onboarding -- --guide-chat-id <new-id> --pin-guide`.
7. **Notify admins** via bot DM with the new invite link.
8. **Notify members** by importing the saved member-contacts CSV (§14) into the operator's personal Telegram and DM-ing the new invite link directly.

### 11.4 Recovery — channel itself is gone

Worst case. The channel is the source of truth on the wire; if it's gone, the DB is the only remaining record.

1. **Create a new channel** + new supergroup, link them.
2. **Re-publish from DB** into the new channel via the steady-state path (`sendMessage` per row). The new channel's history starts there; old vouches re-appear with their original metadata embedded in the prose body.
3. Members rejoin via member-contacts CSV (§14).

This is slower than channel-survives recovery but bounded by your DB content, not Telegram's whims.

---

## 12. 2-phase rollout (channel-relay transition, single-bot)

v6 originally specced a 5-phase multi-bot rollout (A→E). Now that the
admin/lookup split is dropped, the transition simplifies to two phases.
Each is independently safe and reversible via the env-var gate.

| Phase | Action | Verification | Rollback |
|---|---|---|---|
| **A** | Current state — single ingest bot publishing direct to supergroup, V3 templated heading shape. | `/healthz` returns ok; existing flow works. | n/a |
| **B** | Set `TELEGRAM_CHANNEL_ID`, `VV_RELAY_ENABLED=true` in Railway after the channel-pair is set up per §11.2. The ingest bot now publishes to the channel; Telegram auto-forwards into the supergroup; the bot's webhook captures the auto-forward and flips status='channel_published' → 'published' with both ids populated. The wizard inserts a free-form prose step before preview (V3.5 shape). | New vouch end-to-end: row at `status='published'` with both `channel_message_id` and `published_message_id` set. `/healthz` shows `channel.stale_relay_rows: 0`. Wizard preview shows V3.5 `<i>Preview</i>` heading + prose body + `#<id>` footer. | Set `VV_RELAY_ENABLED=false`. Bot reverts to V3 direct publish. Channel posts that already landed stay; in-flight rows at status='channel_published' are cleaned up by `runArchiveMaintenance` over time. |

The previous multi-bot phases (B–E in the old runbook) are deferred —
provision a separate admin bot only if a specific failure mode
justifies the operational overhead.

---

## 13. Adversary-aware ops, bot rotation, ToS literacy, TBC monitoring

### 13.1 Adversary-aware operations

KB:F4.3 — the threat model includes an active human adversary running a mass-reporting Python script and (in TBC's case) a publicly-distributed folder leak.

- **Single Request-to-Join invite link.** Never folder-share. Never paste in publicly searchable channels.
- **At least one alt admin account** in case the main operator's account is compromised.
- **Save member @s as contacts pre-emptively** (§14 protocol). Recover-via-DM is the fallback when supergroup is unreachable.
- **Periodic admin-list audit.** ≤5 admins. Each admin is an attack surface.

### 13.2 Bot rotation runbook

KB:F5.3 — bot replacement is **routine, not emergency**. BALFROCAK rotates bots intentionally, even when nothing is wrong.

**Quarterly review:** is any bot showing elevated error rate, classifier-flag indicators, or slow `/readyz` responses?

If yes, rotate:

1. Provision a replacement via @BotFather. Same role permissions; new token.
2. Add the replacement bot to the channel + supergroup with the same permissions as the bot it's replacing.
3. Update the relevant token env var in Railway. Service redeploys.
4. Verify `/healthz` + `/readyz` come up green. Test the bot's role end-to-end (ingest: DM wizard publishes a test vouch into the channel and lands in the supergroup via auto-forward; lookup: open the supergroup's search bar and verify the test vouch is findable by @handle; admin: `/freeze` + `/lookup`).
5. Delete the old bot via @BotFather. Token revokes.

Do **not** wait for a takedown event to discover a token is dead. Quarterly cadence keeps the swap muscle warm.

### 13.3 ToS literacy

KB:F5.4 — BALFROCAK rereads Telegram ToS regularly: "One post can wipe this whole operation."

**Quarterly:** operator re-reads:
- Telegram Terms of Service
- Bot Platform Policy
- Recent Telegram enforcement guidance / announcements

**Always:** group avatar / name / description stay generic and community-flavoured. **No** marketplace language anywhere — avoid: verify, certified, approved, trusted, premium, guarantee, escrow, deal, vendor, merchant. (Reiterates §2 — restated as a v6-mandatory item.)

### 13.4 TBC monitoring habit

Re-export TBC26 every ~3 months and re-run the analysis (KB §7 protocol). Pull learnings into this opsec doc additively. Keep this discipline — it's how we catch new defensive patterns without rebuilding the model from scratch each time.

---

## 14. Member-list export protocol

KB:F5.1 — BALFROCAK direct quote: *"Member lists of a group hold more value and benefits than backup groups."* We adopt the same posture.

**Honesty caveat (KB:F5.1 / cross-check 2026-04-27):** BALFROCAK states this principle but the export contains no direct evidence he actually exports + imports contacts systematically. We treat it as a stated best-practice and operationalize it as a script + monthly cadence — possibly more disciplined than TBC26 itself.

### 14.1 What the script does

`scripts/exportMemberContacts.ts` (added in v6 commit 6) queries the DB for every known member `(telegram_id, username, first_seen, last_seen)` and writes a CSV to stdout. Operator redirects to a local file:

```bash
npm run export:members > members-2026-04.csv
```

### 14.2 What the operator does with it

- **Save the CSV in a password manager** or other admin-only storage. Treat it as recovery material — not for distribution.
- **Import the CSV into the operator's personal Telegram as contacts** (Settings → Privacy → Contacts → Import). Contacts can be DM'd reliably and re-invited without invitation prompts.
- **Refresh monthly**, plus on-demand before any anticipated risk event (e.g. a noisy weekend, a known mass-report incident in adjacent communities).

### 14.3 What it does NOT do

- ❌ Send anything to anyone. CSV export only.
- ❌ Include private notes, freeze status, or other sensitive metadata. Only `(telegram_id, @username, first_seen, last_seen)`.
- ❌ Include reviewers who have only DM'd the bot but never joined the supergroup, **unless** they've published at least one vouch (those count as members for our purposes).

### 14.4 Why this matters during recovery

- **Supergroup gone, channel survives:** the operator can't bulk-invite via the supergroup admin UI — the supergroup doesn't exist anymore. Saved contacts let the operator DM each member directly with the new invite link.
- **DB-loss event:** the CSV is a snapshot of canonical member identities outside Postgres. Re-bootstrap a fresh DB by joining members, harvesting `users_first_seen` rows on first interaction.
- **Operator can directly DM members during a takedown event** even if all groups are unreachable.

## 15. Alt-admin manual recovery protocol

Single-admin operations have a single point of failure: if the operator's primary Telegram account is suspended (mass-report attack against the human, not the bot), the bot keeps running but no one can issue admin commands. KB:F4.4 documents BALFROCAK and `@TonySoprano5085` running TBC together for this exact reason — there's always a second admin who can act. We adopt a lighter version: one designated alt-admin account on standby, promoted only during an incident.

### 15.1 Pre-staging (do once, leave dormant)

- **Create an alt admin Telegram account** under a separate phone number. Do not log it in concurrently with the primary; let it sit cold.
- **Add the alt's Telegram numeric id to the live group as an admin** with the same rights as the primary (delete messages, ban members, invite users). Do not include them in `TELEGRAM_ADMIN_IDS` env yet — the env gates bot-admin commands and dormant-status is the goal.
- **Document the alt's recovery email + 2FA seed** in the same secure store as the bot token. The alt is recovery infrastructure; lose the secret store, lose the alt.
- **Test once, then leave dormant.** Sign in to the alt, post a single throwaway message in the test group, sign out. Confirms account is reachable.

### 15.2 Activation procedure (during a takedown event)

1. **Identify the failure mode.** Three distinct paths:
   - **Bot down, primary admin alive:** bot rotation, not alt-admin. Skip this section, go to §13 bot rotation.
   - **Primary admin suspended, bot alive:** alt-admin promotion path. Continue.
   - **Both dead:** rebuild from member-list export (§14). Alt-admin doesn't help if the group itself is gone.
2. **Sign in to the alt account** on a clean session.
3. **Update `TELEGRAM_ADMIN_IDS`** in Railway to include the alt's numeric id. Redeploy. Boot will validate the env (§9 / `bootValidation.ts`); if the alt's id is malformed the bot won't start, so test the change in staging first when there's time.
4. **Verify the alt can issue admin commands** via DM to the bot (`/admin_help` is the lowest-blast-radius probe).
5. **Operate from the alt** until the primary is restored or replaced.

### 15.3 Why the alt is not pre-listed in `TELEGRAM_ADMIN_IDS`

Two reasons:

- **Smaller surface during normal operation.** A dormant alt with admin rights but no env-listing is a passive recovery asset. If the alt is compromised, no bot-admin authority leaks.
- **Forces a deliberate redeploy at activation time.** The redeploy is a hard checkpoint — you remember to verify the alt is the real alt (and not the attacker), to rotate the primary's token if needed, and to log the incident.

### 15.4 What this section deliberately does not include

- ❌ **Auto-approve of join requests via webhook handler.** The optional `chatJoinRequestFallback.ts` was considered and dropped: it requires a polling loop the bot doesn't have, and adding cron infrastructure violates the set-and-forget design. Defer to v8.1+ if and when SangMata integration lands and we already have a scheduler.
- ❌ **Multiple alt accounts with rotating duty.** Single alt is enough for a single-operator project. TBC needs two because TBC has two operators; we have one.

## 16. Webhook secret rotation procedure

`TELEGRAM_WEBHOOK_SECRET_TOKEN` is the per-request shared secret Telegram includes in the `X-Telegram-Bot-Api-Secret-Token` header on every webhook delivery. Compromise of the token lets an attacker forge updates to the webhook URL. Rotate on any suspected leak (accidental commit, third-party access, post-incident hardening) and on a routine cadence (every 90 days is plenty for a single-operator project).

### 16.1 Rotation steps

1. **Generate the new secret.** `openssl rand -hex 32` produces a 64-char `[A-Za-z0-9]` value matching `bootValidation.ts`'s `SECRET_TOKEN_RE`. Store it in the same secure store as the bot token.
2. **Update `TELEGRAM_WEBHOOK_SECRET_TOKEN` in Railway** to the new value. **Do not redeploy yet.**
3. **Re-register the webhook with the new secret:** `npm run telegram:webhook` (which calls `setWebhook` with the env-var value Telegram now expects). Telegram returns `ok:true` on success.
4. **Trigger a Railway redeploy** so the running server compares incoming request headers against the new secret.
5. **Verify drain.** Telegram has a small queue of in-flight updates that were accepted under the *old* secret and may still be retried. Run `getWebhookInfo` (`curl https://api.telegram.org/bot$TOKEN/getWebhookInfo`) and confirm both:
    - `pending_update_count` returns to 0 (or stays small and stable, indicating normal traffic).
    - `last_error_date` is unset, OR is older than the cutover timestamp.
   When both conditions hold, the new secret has fully taken over. Telegram does not publish exact catch-up timing — empirically the queue drains in under a minute, but verify with `getWebhookInfo` rather than waiting on a wall-clock.
6. **Drop the old token** from the secure store.

### 16.2 What goes wrong if you skip step 5

If you rotate the env value but don't verify drain, in-flight requests retried after the env change will arrive with the *old* header and the bot will reject them with 401. Telegram retries with backoff and eventually drops; from the user's perspective some commands appear to fail intermittently for the rotation window. The fix is the same as the prevention: wait until `getWebhookInfo` confirms the queue has drained.

## 17. Optional IP-allowlist tier (deferred)

Telegram's webhook-delivery infrastructure publishes its source IP ranges (currently 149.154.160.0/20 and 91.108.4.0/22 per the `getWebhookInfo` documentation). An additional defensive tier is to drop inbound requests at the edge that don't come from those ranges. Two options, both **not currently implemented** — filed here so a future tightening pass has the wiring documented.

### 17.1 Setting `setWebhook` `ip_address` (limited)

The Bot API `setWebhook` method accepts an optional `ip_address` parameter. **Important caveat:** the parameter takes a single IP string, not a CIDR range. If you set `ip_address: "149.154.167.220"`, Telegram will only deliver from that exact IP; requests routed via any other IP in their pool fail. Useful only when:

- Telegram's pool is small enough that one IP is reliable (currently false — they round-robin).
- OR you're running an internal-only test endpoint and want a hard pin.

If we ever pursue this, the strategy is to leave the param unset and rely on edge-level filtering instead.

### 17.2 Edge-level CIDR filter (Cloudflare or equivalent)

If the bot fronts behind a CDN or reverse proxy that supports IP-range allowlisting, reject any inbound request to `/webhooks/telegram/action` whose origin IP is outside Telegram's published ranges. Pair with `TELEGRAM_WEBHOOK_SECRET_TOKEN` (already in place) for defense in depth. Keep the published-range list updated — Telegram has expanded it over time.

### 17.3 Why this is deferred

The webhook secret token in §16 already prevents forged updates from anyone who doesn't have the secret. IP allowlisting is a layer on top, not a replacement, and adds operational fragility (if Telegram adds an IP and we don't notice, real updates start failing). Single-operator project with a 32-byte secret is fine without this for now. Revisit if the operator gains the staffing to monitor Telegram IP changes.

## 18. Group-type posture: stay private_group as long as possible

Telegram exposes two distinct chat shapes that both look like "private group" in the UI: **basic group** (`chat.type = "group"`) and **supergroup** (`chat.type = "supergroup"`). The supergroup shape unlocks Request-to-Join, public links, granular permissions, topics, and large member counts. It also appears to carry a heavier classifier weight when correlated with vouch-flavoured naming, custom-branded bots, and templated post density. The 2026-04-27 same-operator natural experiment isolated this:

| Variable | Dead group ("Suncoast Vouches") | Survivor ("Sunny coast") |
|---|---|---|
| Type | private **supergroup** | private **group** |
| Title | contains "Vouches" | generic |
| Custom-named publish bot | yes (`Suncoast Vouch Bot`) | none |
| Templated POS density | 47.3% of messages | 0.0% |
| Auto-forwards (KB:F2.5 shape) | 0.9% | 20.7% |
| Edit-after-send rate | 47% | 5.5% |
| Outcome | banned 2026-04-07 | alive despite being reported repeatedly by the operator |

Sender overlap was 10/18 — same community, same operator, same content category. The structural identity surface is what differed.

### 18.1 Operational rule

- **Do not voluntarily upgrade** the host group to a supergroup. The upgrade is one-way: there is no Telegram-side path to revert a supergroup back to a basic group, so every upgrade is permanent.
- Telegram **auto-upgrades** a basic group when it exceeds **200 members** or when an admin enables a feature that requires supergroup (public username, topics, slow mode at certain settings, privacy links, etc.). Treat each of those toggles as a one-way door.
- **Slow mode** is the most likely accidental trigger of an upgrade. The §2 checklist recommends 10s slow mode; on a basic group the setting is unavailable and toggling it forces the upgrade. Decision: leave slow mode **off** while in basic-group shape; rely on the chat-moderation lexicon (v6) and member-velocity alert (takedown-resilience) for brigading defence instead. Re-enable slow mode the day the group auto-upgrades past 200 members.
- **Member-add permissions:** the §2 rule "members cannot add new members" still applies. Basic groups expose the same permission. No tension here.
- **Public link / username:** never. Same as §2.

### 18.2 What changes after the forced upgrade

When the group does auto-upgrade (member count, or a feature you genuinely need), revisit:

- Re-enable slow mode at 10s (§2).
- Enable Request-to-Join + manual admin approval (§2).
- Audit the group title and description against §2's marketplace-language list. The post-upgrade migration is the natural moment to sanitize.
- Run `npm run telegram:onboarding` to re-apply bot-side hardening (commands, descriptions) — chat-id format does not change on upgrade, but the supergroup id will be a new `-100…` prefixed integer; update `TELEGRAM_ALLOWED_CHAT_IDS` accordingly.

### 18.3 Why this isn't enforced in code

The bot can't tell Telegram "do not upgrade this chat" — the upgrade is admin-side state. Surfacing it as an admin-only doc rule is the correct enforcement boundary. The bot does observe `chat.type` on every update and the v6 schema captures it on captured channel posts; if a future operator mis-reads this section and upgrades the group, no code path fails — the OPSEC posture quietly degrades to the dead-group baseline. That is acceptable; the rule is documented, the trade-off is explicit, and the operator owns the decision.

### 18.4 Source

Empirical comparison: dead-group export `ChatExport_suncoastvouchoriginal/result.json` vs survivor export `ChatExport_2026-04-27 (3)/result_sc.json`. Cross-checked against TBC26 (alive, supergroup-shaped, but operating at a scale and with anonymous-admin features unavailable below ~50K members per KB:F2.6) and Queensland Vouches (alive, supergroup, low templated density). The basic-group rule is correct for VouchVault's current scale; it does not generalise to 50K+-member communities, which have already crossed the upgrade threshold and operate under a different threat model.

## 19. Bot privacy-mode posture (TBC asymmetry, accepted tradeoff)

Empirical 2026-04-27: **TBC's group-help bot and TBC's channel bot both run with privacy mode ON** — they receive only commands directed at them (`/cmd@botname`) and explicit @mentions, not the full message stream. VouchVault's ingest bot diverges deliberately: it subscribes to `message` and `edited_message` updates with privacy mode effectively OFF, so it sees every group post.

### 19.1 Why VouchVault diverges

Three load-bearing features need full message visibility:

- **Lexicon moderation (v6).** `runChatModeration` in `src/core/chatModeration.ts` scans every group message against the empirically-derived lexicon and deletes hits. Without full message scope it would only see commands — i.e. nothing to moderate.
- **Edited-message moderation.** The `edited_message` branch of `processTelegramUpdate` re-runs the lexicon over edits so a member can't post clean and edit dirty. Same scope requirement.
- **v9 backup-channel mirror.** `maybeMirrorToBackupChannel` in `src/telegramBot.ts` decides whether each group message gets forwarded into `TELEGRAM_CHANNEL_ID` (when `VV_MIRROR_ENABLED=true`). Without full message scope the mirror would only see commands and never produce a usable backup. The mirror requirement is independent of moderation — even if lexicon were disabled, mirror would keep privacy-OFF in place.

### 19.2 Identity-surface cost

A bot that ingests every message looks more "engaged" on the wire than TBC's narrow command bots. The classifier-signal impact is unknown — the survivor/dead Suncoast comparison did not isolate this variable (both used custom-branded vouch bots; neither was the privacy-ON shape TBC uses). The cost is accepted because lexicon moderation is the v6 brigading defence and removing it to mimic TBC's shape would trade a load-bearing control for an unmeasured signal-reduction.

### 19.3 What this means operationally

- **Do NOT toggle `/setprivacy` to ENABLE in BotFather** for the ingest bot. It would silently break lexicon moderation — the bot would still process commands and DMs, but group lexicon hits would never reach the handler. Failure mode is invisible (no error, just no deletes); the only signal is `lexicon.deletes_24h` in `/healthz` (added in v8 C9) staying flat against a backdrop of obvious lexicon-hit posts.
- **Subscribe to the minimum update set anyway.** `scripts/setTelegramWebhook.ts:149` lists `allowed_updates` explicitly — `message`, `edited_message`, `callback_query`, `my_chat_member`, `chat_member`, `chat_join_request`. Adding others (e.g. `poll`, `chosen_inline_result`) without a feature need would expand the on-the-wire shape without payoff. Keep this list tight.
- **If a future feature genuinely doesn't need group message visibility** — e.g. a side-bot that only handles a specific command — give that bot privacy mode ON and a narrower `allowed_updates` set. The asymmetry between TBC's narrow bots and VouchVault's wide ingest bot is the cost of the v6 moderation feature, not a default to replicate elsewhere.

### 19.4 Source

Direct observation 2026-04-27: TBC group-help bot and TBC channel bot both fail to respond to non-command messages and do not appear in any export's `actor` field for non-command events — consistent with privacy-ON (`/setprivacy` ENABLE) configuration. This is the BotFather default for new bots; TBC's operators kept the default. VouchVault's posture (privacy OFF) is a deliberate v6 decision, not an oversight.

## 20. Identity-surface audit checklist (pre-launch + quarterly)

Run this checklist before initial launch, after any group migration (§4), and quarterly thereafter. Each item maps to an empirically-supported classifier-targeting signal from the 2026-04-27 same-operator survivor/dead comparison. The four items together cover the v8.1 priorities derived from that experiment that are not enforceable in code.

### 20.1 Group title + description audit

The dead Suncoast group's title contained "**Vouches**". The survivor's title was "**Sunny coast**" (geographic, no marketplace term). Title is plain text in every classifier feature set — single highest-leverage signal an operator controls.

Check, in the Telegram client → group profile:

- **Title** must not contain: `vouch`, `vouches`, `vouching`, `vendor`, `seller`, `plug`, `connect`, `market`, `marketplace`, `trade`, `swap`. Any case, any spacing, any leetspeak (`v0uch`, `v-ouch`, `v_ouch` all count — classifiers normalise).
- **Title** should be: geographic, social, or community-flavoured neutral. "Sunny coast", "Eastside chat", "QLD locals" are survivor-shaped.
- **Description** same wordlist applies. Plus: no "rules" mentioning ratings, transactions, scams, refunds, escrow, deposits, midpoints. Description is one of the few fields visible to non-members in invite previews.
- **Pinned message** (if any): same wordlist. Pinned content travels with the group and is read by the same classifier features.

Failure to pass this audit is a one-fix issue (rename in client). It is the single most cost-effective hardening step; nothing else in this runbook beats it for ROI.

### 20.2 Bot username audit

The dead Suncoast group's publish bot was named `Suncoast Vouch Bot` — literally announcing its function on every message via the sender field. The survivor had no custom-named bot. Bot identity is read by classifier features that scan `from.username` and `from.first_name` on every event.

Check, in BotFather → `/mybots` → select bot → Bot Settings:

- **Bot username** (`@…bot`) must not contain: `vouch`, `vouches`, `vendor`, `plug`, `market`, `trade`, `seller`, `escrow`. Same wordlist as §20.1, applied to the bot handle.
- **Bot display name** (the human-readable name shown next to messages) — same wordlist. This is what members and classifiers actually see; the username is the technical handle.
- **Bot description** (`/setdescription`) and **about** (`/setabouttext`): same wordlist. These show on the bot's profile page, scraped into classifier features.
- Survivor-shape names: generic ("Helper Bot", "Group Bot", or the group's own name without function suffix). Match the group's vibe, not the bot's job.

Renaming is reversible in BotFather but takes effect within ~minutes; member-facing display name updates immediately. Username changes invalidate any prior `t.me/<oldhandle>` links — coordinate with §11 channel-pair links if they reference the bot handle.

### 20.3 Backup-channel mirror env audit (`VV_MIRROR_ENABLED`)

The architectural shape that distinguishes survivors (TBC, Queensland Vouches) from dead groups is **forward-shape posts** vs. **bot-templated direct publishes**. v9 strips VouchVault's templated publish path entirely; the only bot writes to the channel are `forwardMessage` calls mirroring member posts. Forward-shape (KB:F2.5) is the survival signal.

Check in production env:

- `VV_MIRROR_ENABLED=true` is set.
- `TELEGRAM_CHANNEL_ID` is set to a negative integer with `-100` prefix (boot validation logs an error if mis-shaped; check `/healthz` boot logs).
- The bot is **admin in the channel** with `can_post_messages=true`. Without post permission `forwardMessage` returns 403 and the mirror silently fails — `mirror_log` rows stop being written.
- `mirror_log` table has recent rows (`SELECT MAX(forwarded_at) FROM mirror_log;` should be within the last hour during active group use).
- `VV_RELAY_ENABLED` should be **unset or absent** — v9 deleted the templated-relay path; setting `VV_RELAY_ENABLED=true` will fail boot validation if reintroduced.

The mirror is the only bot write to the channel post-v9. There is no "channel-discussion auto-forward into the supergroup" loop — the channel is a one-way durable replica of group content for takedown recovery.

### 20.4 Edit-rate on published posts

The dead Suncoast group had a 47% edit-after-send rate on published vouches. The survivor had 5.5%. High edit-rate on the dead group's bot output is a plausible classifier signal (templated message + frequent edit = automated-looking traffic; or: edits expose template-substitution bugs the classifier can fingerprint).

**Code-side audit (v9):** there are no bot-published vouches anymore. The DM wizard and templated publish path were deleted in v9 phase 3. The bot's only writes to the host group are admin-command replies, moderation DM warns (sent to DMs, not group), and `/lookup` results (sent to the requesting context). None are templated vouch content. Bot-side edit-rate on vouch content is structurally 0%.

**Operator-side audit:** humans post vouches in the group as normal messages. Member-edited messages count toward classifier-visible edit-rate. Rules:

- **Members:** post your vouch in one go; edit only for typos within the first minute. Repeated edits on a freshly-posted vouch attract attention.
- **Operators:** do not edit member-posted vouches in the client. If a vouch is wrong, ask the member to delete and repost, or delete it via `/remove_entry` if it's been logged.
- The pinned guide is operator-edited at most once per major copy revision — fine and necessary; one pinned-message edit per quarter does not move the rate.
- Welcome messages on member join are bot-sent, not bot-edited; no action needed.

### 20.5 Audit log

Each pass through this checklist should be logged in `admin_audit_log` via the operator's own account (not the bot) as a manual `audit:identity_surface` entry, or — simpler — kept as a dated note in this runbook. The point is a paper trail, not bureaucracy. One line per audit:

```
2026-04-27 §20 audit: title=ok, bot=ok, mirror=ok, edit-rate=ok. Notes: …
```

### 20.6 Source

Same dataset as §18: dead-group export `ChatExport_suncoastvouchoriginal/result.json` vs survivor export `ChatExport_2026-04-27 (3)/result_sc.json`, cross-checked against TBC26 and Queensland Vouches. Edit-rate code audit re-performed 2026-04-27 post-v9 phase 3: bot no longer publishes vouches; only `forwardMessage` (mirror) and admin-reply paths write to Telegram.

## 21. Backup-channel mirror posture (v9)

v9 phase 1 introduced a forward-only mirror of the host group into a backup channel. Every member-posted message in `TELEGRAM_ALLOWED_CHAT_IDS` is forwarded into `TELEGRAM_CHANNEL_ID` via `forwardMessage`, idempotent on `(group_chat_id, group_message_id)`. The channel becomes a durable replica: takedown of the group preserves the archive, and `replay:to-telegram` (v6 §4.5) can replay the channel into a recovery group.

### 21.1 Operational rule

- Bot is admin in `TELEGRAM_CHANNEL_ID` with `can_post_messages=true`.
- `VV_MIRROR_ENABLED=true` in production env.
- `mirror_log.forwarded_at` recent during active group use.

### 21.2 Why forward (not copy)

`forwardMessage` preserves `forward_origin` — the channel post displays "forwarded from <member>" with original timestamp. This is the survival shape per KB:F2.5 (forwarded content is classifier-friendlier than fresh sends). `copyMessage` (anonymising) is rejected: the data was already public in the group, and forward-shape is the documented survival pattern.

### 21.3 Failure handling

Mirror is best-effort. A `forwardMessage` failure (403 if bot kicked from channel, 400 if message-gone) is logged at `warn` and does not block other handlers. The mirror_log is the source of truth for "what got mirrored"; missing rows after a failure window are recoverable manually if needed (re-post in group; webhook retry will re-attempt the forward, idempotent).

### 21.4 Recovery

If the host group is taken down, the operator runs `npm run replay:to-telegram` against the backup channel as the source and a fresh recovery group as destination. This forwards the channel into the new group, preserving attribution. v6 §4.5 documents the script's parameters.

### 21.5 Source

v9 spec: `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md` §4. Implementation: `src/core/mirrorPublish.ts` + `src/core/mirrorStore.ts` + `src/telegramBot.ts:maybeMirrorToBackupChannel`.

## 22. TBC-shape operator practices (off-shelf bots + anonymous-admin)

TBC's stack contains 21 bots accumulated reactively across three takedowns (KB:F2.1). VouchVault is not obligated to inherit that complexity, but a small number of off-the-shelf utilities map to TBC's narrow-bot survival shape and add measurable value with zero code change. This section is operator-side setup; nothing here touches the codebase.

### 22.1 GateShieldBot — auto-removes deleted accounts

KB:F2.1 documents `@GateShieldBot` in TBC's stack ("1 deleted accounts has been removed from this group 👻 🤖 Prevent spam bot using @GateShieldBot" — 54 mentions in TBC's export). When a member's Telegram account is deleted, their tombstone (`Deleted Account` user) lingers in the member list until manually removed. GateShield removes them automatically, keeping the member-list export (KB:F4.3 recovery asset) clean.

Setup:
1. Telegram client → search `@GateShieldBot` → start.
2. Add to host group as admin with **Ban users** permission. No other permissions needed.
3. Verify by checking the bot's profile says it's an admin in the group.

No env var, no code, no risk. The bot is widely used (TBC, many other communities); BotFather approval is a non-issue.

### 22.2 Anonymous-admin posting (`Send anonymously` mode)

KB:F2.5 §3 documents TBC's curation pattern: admins post under the supergroup's channel-id identity rather than their personal account, shielding the curator's account from the publish action. This is a Telegram-native admin permission, not a bot feature.

Operator practice:
- When an admin posts in the host group as part of moderation/curation duties (announcement, scammer call-out, pinned-rule update), enable **Anonymous** in their admin settings: group settings → Administrators → select admin → enable **Remain Anonymous**.
- The admin's personal account no longer appears as the sender; messages display as `from: <group title>`.
- Disable on accounts whose identity should remain visible (e.g. a bot whose ops messages need attribution).

Why this matters: in a takedown audit, the curator's personal account is one of the highest-risk attribution surfaces. Anonymous mode breaks that link. TBC has been explicit about this being load-bearing for survival. Free, no code, applies immediately.

### 22.3 Optional: SangMata-class username history bot

KB:F2.1 documents `@SangMata_beta_bot` (42 mentions, 32 `via_bot` invocations in TBC's export) for username/name history lookup. Members and admins use it to detect username-pivot scammers — someone who renames between communities to dodge reputation.

Setup is the same shape as GateShield: add bot, no admin rights needed (SangMata responds to inline-query mentions). Quota-limited; donations increase quota.

This is **optional**: useful when the community grows large enough that members start asking "has @newhandle been here before under a different name?" Until then, low ROI. Document here so it's known.

### 22.4 GroupHelp moderation (option-3 path; spec'd as v9.1)

The deferred option-3 path: replace VouchVault's on-bot lexicon (`src/core/chatModeration.ts`) with off-shelf moderation via `@GroupHelpBot` or a clone. Operator-confirmed safe (multiple groups, no takedowns attributed to GroupHelp). This would shrink VouchVault's bot surface further AND let us flip ingest-bot privacy-ON, matching TBC's posture (KB:F2.1, opsec §19).

**Pre-conditions before we ship the code change:**
1. Add GroupHelp (or clone — `@GHClone5Bot`, `@TBC_grouphelp_bot`) to the host group as admin with delete + ban permissions.
2. Configure the lexicon equivalent (GroupHelp has built-in word/phrase filters via `/config`).
3. Operator confirms GroupHelp is moderating the same hits VouchVault's lexicon currently catches — observe for a week.
4. Only after that observation: ship the code change in the v9.1 spec (drops `runChatModeration`, drops `message`/`edited_message` from `allowed_updates`, BotFather privacy ENABLE).

Spec: `docs/superpowers/specs/2026-04-27-vouchvault-v9.1-grouphelp-moderation-design.md`. Do not run the code-side change before completing operator pre-conditions; doing so creates a moderation gap.

### 22.5 What we are deliberately NOT replicating

- **Userbot** (KB:F2.2). TOS-violating; permanent no.
- **21-bot count for its own sake.** TBC's stack is reactive accumulation; we choose narrow-bot additions when each adds measurable value, not to match a count.
- **Forum-mode supergroup with 13 topics** (KB:F2.6). Conflicts with §18 (stay private_group). Defer until member count forces upgrade to supergroup.
