# SC45 launch runbook

Operational playbook for launching SC45 (the V4-successor group) with organic growth, BALF-shape hygiene, and minimum-blast-radius account architecture. Cross-references the canonical Telegram docs in `docs/research/telegram-official/` and the empirical TBC26 KB in `docs/research/tbc26-knowledge-base.md`.

## 1. Owner architecture (decided)

| Asset | Owner | Strikes | Notes |
|---|---|---|---|
| **SC45 group** | Friend's account | 1 (V3 takedown) | Operator-sacrificial. Same account that owns V4 today. If SC45 dies, this account hits strike #2 → burned. |
| **VouchVault bot** | Friend's account (current — no migration) | 1 (shared) | Bot stays where it is. Migration to a fresh BotKeeper is "nice-to-have," not urgent. Bot bans are rare empirically. |
| **SC45 backup channel** | Friend's account | 1 (shared) | Same logical bucket as the group. |
| **User's 2-year main** | Admin only — never owner | 0 | Preserved as clean asset. Used for daily admin actions, never as legal owner. |
| **GroupKeeper** | New account, aged in parallel | 0 | Insurance for V6. Created today, used for normal personal Telegram use only. **Not** used for any bot/group ownership for ≥3 months. |

**Trade-off acknowledged:** SC45 inherits its owner's flag. Survival probability is lower than if SC45 were on the user's clean aged account. This is a deliberate choice to protect the 2-year main from any owner-strike. Compensate with maximum hygiene (§5).

## 2. Pre-launch checklist

Run this before SC45 sees its first non-admin member.

### 2.1 Group creation (friend's account)

- [ ] Create new supergroup. Name: `SC45` (no "Suncoast", no "Vouch", no drug-keyword)
- [ ] Description: neutral. **Do not** include words: vouch, deal, sell, trade, drug-slang, off-platform comm names (Wickr/Threema/Signal/Session). Boring is the goal.
- [ ] Profile picture: neutral. No drug imagery, no community logos that connect to V3/V4.
- [ ] Group privacy: **Private group**. Confirm no public username assigned.
- [ ] Join setting: **Request-to-Join only.** Disable open invite link.
- [ ] Slow mode: 30s default. Adjust as activity warrants.
- [ ] Permissions: members can send messages + media; cannot pin, cannot change info, cannot add bots.
- [ ] Bot privacy mode: must be **OFF** for VouchVault (lexicon mod + mirror need full message visibility).
- [ ] Members can see other members' join date: optional (TG default is yes; consider hiding for privacy).

### 2.2 Bot wiring (existing VouchVault bot, on friend's account)

- [ ] Add VouchVault bot to SC45 as admin
- [ ] Admin permissions: **Delete messages, Pin messages, Manage video chats** (no ban member, no add admins)
- [ ] Confirm `TELEGRAM_ALLOWED_CHAT_IDS` in env includes SC45's chat ID
- [ ] Run `npm run telegram:webhook` to refresh `allowed_updates`
- [ ] Confirm `/start` works in DM and bot is online

### 2.3 Backup channel

- [ ] Create private channel "SC45 Archive" on friend's account
- [ ] Add VouchVault bot as admin (post messages, edit messages, delete messages)
- [ ] Add user's main as admin (no transfer)
- [ ] Set `TELEGRAM_CHANNEL_ID` env to channel ID; redeploy
- [ ] Set `VV_MIRROR_ENABLED=true`
- [ ] Test: post one message in SC45, confirm it forwards to channel within ~2s; confirm `mirror_log` row appears in DB

### 2.4 Group Help Pro (anti-spam, CAPTCHA, welcome)

- [ ] Add `@GroupHelpBot` (or current Group Help Pro variant) to SC45 as admin
- [ ] Permissions: ban members, delete messages, restrict members, invite users
- [ ] Configure CAPTCHA on join (default settings are fine — TBC-validated)
- [ ] Configure welcome message: neutral, ≤2 lines, no rules dump (rules go in pinned message)
- [ ] Anti-flood: 5 messages / 10s default
- [ ] Wordfilter: leave empty initially — VouchVault's lexicon handles content moderation

### 2.5 Pinned message + topics

- [ ] Pin a single neutral message: greeting + "DM @your_admin_username for help"
- [ ] Optional: enable forum topics if you want to segment chat (General / Vouches / Disputes / Announcements). Saves having to wordfilter content into the right thread.

## 3. Day-1 launch

### 3.1 Soft open

- [ ] User (main account, admin) joins SC45
- [ ] 1-2 trusted V4 members get the SC45 invite link via DM. **Individual DMs only — no bulk-DM.**
- [ ] Wait. Don't do anything else for 24h.

### 3.2 Verify quiet operation

After 24h:
- [ ] Check bot is online, no error logs
- [ ] Check mirror is firing (each test message → channel + `mirror_log` row)
- [ ] Check Group Help Pro is gating new joins
- [ ] No content imports yet. SC45 stays content-quiet for the first 72h.

## 4. Growth phase (organic, no bulk)

### 4.1 Member growth pattern

The TBC26 baseline (KB:F2.7): normal rate is **0–5 joins/day** via `join_group_by_request`. Migration spike: **up to 100/day spread over hours**, never in single-second batches. SC45's expected pattern is **organic only** — no list to pre-import, so growth is whatever Request-to-Join produces.

| Pattern | Status |
|---|---|
| 0–5 joins/day, all via Request-to-Join | ✅ Normal |
| 5–20/day during a 1-week ramp | ✅ Normal |
| 50/day for one day | ✅ Acceptable (TBC normal-spike range) |
| 25 in one second from admin invite_members | ❌ V3-vector. Never. |
| Bulk-import a member list of 100+ in <1 hour | ❌ Don't. |
| Open invite link distributed publicly | ❌ Use Request-to-Join |

### 4.2 Acceptable bulk operations

If you ever DO need to bulk-onboard (say, a coordinated migration day from another group):

- ≤10 invites/hour
- ≤50/day
- Spread across hours
- **No content publish on the same day.** Onboard members first; let it settle ≥24h; then any content imports happen separately.
- Bot already added, settings tuned, Group Help Pro in place **before** the bulk window opens (TBC pre-event setup pattern, KB:F1.3)

### 4.3 Member-velocity alerts

`src/core/memberVelocity.ts` already alerts on join-rate spikes. Confirm the alert chat is monitored. If the alert fires, investigate (brigade attack? compromised invite link distribution?) before approving more requests.

## 5. Hygiene posture — never / always

### 5.1 Never

- Bulk-author content in SC45 via the bot (V3 vector). Members post in their own words.
- Forward V1 cached export → SC45 via bot. Legacy goes to DB only.
- Bulk-add 25+ members in <60s.
- Use "Suncoast", "Vouch", or any drug-related word in: group name, bot name, bot description, channel name, pinned message.
- Add the bot to any other public group on the same account (broadens classifier surface).
- Reuse the friend's account for any new asset after SC45 (already 1 strike, SC45 takes #2 if it dies; no #3).

### 5.2 Always

- Members post vouches as plain group messages, member-authored, varied wording (v9 architecture).
- Bot mirrors each member message → backup channel via `forwardMessage` (live mirror, automatic).
- New members go through Request-to-Join + Group Help Pro CAPTCHA.
- DM admin commands; never bulk-publish announcements.
- Lexicon mod auto-deletes commerce-shape posts (deterministic). AI fallback (when shipped) catches paraphrased solicitations.
- Run `recordAdminAction` for every admin command (audit trail in `admin_audit_log`).

## 6. Insurance — GroupKeeper aging

Start today. Cost: ~$10 for SIM/eSIM. Outcome: V6-ready owner if SC45 ever dies.

### 6.1 GroupKeeper account creation

- [ ] Buy prepaid SIM (real cellular preferred) or test Hushed first ($7.99) — see §7 of `docs/runbook/account-hygiene.md` if/when written
- [ ] Add as second/third Telegram account on user's phone
- [ ] **Set 2FA password immediately.** Set recovery email.
- [ ] Fill out profile: realistic display name, profile pic, bio. Looks human.

### 6.2 Aging usage (3+ months minimum)

- [ ] Add a few real contacts (your other accounts, friends if comfortable)
- [ ] Send occasional DMs (real conversations or low-volume bot interactions)
- [ ] Join 3-5 normal groups (not vouch-related; cooking/news/sports/etc.)
- [ ] Post occasionally in those groups — look like a real user
- [ ] **Do not** create bots, **do not** create groups, **do not** add to any drug-related communities until 90+ days of aging passes

After 90+ days: GroupKeeper is viable as a future V6 owner if needed. Until then it sits dormant in case of emergency.

## 7. SC45 in trouble — warning signs

| Signal | Likely meaning | Action |
|---|---|---|
| Sudden join spike (10+ in <1h) | Brigade attack or invite-link leak | Pause Request-to-Join approvals; invalidate invite link; investigate |
| `chat_gone` 400 from bot | SC45 was killed | Trigger takedown procedure (`docs/runbook/opsec.md` §11) |
| User reports VouchVault bot directly | Hostile member targeting bot | Review audit log; if legitimate FP from lexicon, tune lexicon |
| Lexicon FP cluster (deletes on legit messages) | Lexicon false-positive surge | Disable auto-delete; manually review; tune |
| AI moderation calls spike >200/day | Brigade or near-miss flood | Circuit breaker should fire automatically; investigate cause |

## 8. Cross-references

- **v9 spec:** `docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md`
- **Telegram canonical docs:** `docs/research/telegram-official/` (raw HTMLs are byte-faithful)
- **Telegram ToS verbatim:** `docs/research/telegram-tos.md`
- **Enforcement mechanics research:** `docs/research/telegram-enforcement-mechanics.md`
- **Official-doc implications synthesis:** `docs/research/telegram-official-implications.md`
- **TBC26 empirical KB:** `docs/research/tbc26-knowledge-base.md`
- **V3 takedown forensics:** see `Export/result_v3.json` analysis (chat history; not yet committed as a doc)
- **OPSEC runbook:** `docs/runbook/opsec.md`
- **Account hygiene** (TBD — to be written): GroupKeeper procedure, BotKeeper procedure, 2FA hardening
