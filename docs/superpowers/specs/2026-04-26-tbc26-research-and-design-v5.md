# TBC26 deep-read research → VouchVault design (v5)

**Date:** 2026-04-26
**Source:** 6 parallel deep-read passes over `ChatExport_2026-04-26 (2)/result_example.json` (16 MB, 25,871 messages, 13 months: 2025-03-19 to 2026-04-26).
**Status:** research artifact + minimal design recommendations. Not an implementation plan. Anything in the "design" section is a candidate, not committed work.

This doc supersedes plan v1–v4. v1–v4 made architectural claims that the deeper analysis refutes; v5 is the reset.

---

## 0. How to read this doc

Three layers, kept distinct:

1. **Verified findings** — directly grounded in the export data. Quoted with message ids. Reproducible.
2. **Reasonable inferences** — one logical step from verified findings. Marked as inference.
3. **Speculation** — anything beyond inference. Explicitly labeled.

The user flagged two failure modes during this analysis:
- **Don't conflate** (a) `forwarded_from: <X>` (a real forward), (b) `from: "Deleted Account"` (account was deleted but the message is still in the chat), and (c) message-id gaps (the message itself was deleted from chat). These are three different things; v1–v4 sometimes confused them.
- **Don't tunnel-vision** on a single hypothesis (multi-bot, forward-shape, content-laundering, etc.). Keep alternatives alive.

Both rules apply throughout this doc.

---

## 1. What we know about TBC26 (verified findings)

### 1.1 Group identity and history

- Created as basic group "ADL ZONE BACKUP 1" on 2025-03-19 (msg id 1, `migrate_from_group` service msg).
- Renamed to "TBC 26" on 2026-01-09 (corresponds to the 7,056-msg spike that day; see §1.5).
- **Forum-mode supergroup with 13 topics.** Verified via `service` messages with `action: "topic_created"`. Two of the analysis agents searched for the wrong field name (`forum_topic_created`) and reported "no topics"; that was an analysis error, not a property of the data. Correction made on user evidence (Telegram-client screenshot showing the topic sidebar). Topic list, chronological:

  | Created | Topic title | Notes |
  |---|---|---|
  | 2025-03-19 | CAN ANYONE VOUCH? | Lookup-request topic |
  | 2025-03-19 | GOOD CUNTS | Positive vouches |
  | 2025-03-19 | SHIT CUNTS | Negative vouches / accusations |
  | 2025-03-20 | BANNED LOGS | Audit log of banned users |
  | 2026-01-09 | CHAT | Free-form chat (post-rebrand) |
  | 2026-01-09 | TBC HALL OF SHAME | Visible-shaming archive |
  | 2026-01-09 | WELCOME TO TBC26 | Onboarding / rules |
  | 2026-01-11 | Telegram Links | Sister-group links |
  | 2026-01-11 | SAPOL SETUPS | Police-watch (Australian context) |
  | 2026-01-11 | TBC26 JOIN REQUESTS | Join-request approvals |
  | 2026-02-10 | @niga999990 V @e546385 | Single-case dispute thread |
  | 2026-03-04 | LET ME BACK IN!!!! | Post-takedown re-add requests |
  | 2026-03-23 | HOW TO USE TELEGRAM | Training / mandatory-modules launchpad |

  The post-rebrand topic expansion (2026-01-09 onwards) tracks BALFROCAK's evolving operational needs. Topics added during/after the March 2026 takedown are the most operationally-revealing: "LET ME BACK IN!!!!" (recovery surface) and "HOW TO USE TELEGRAM" (mandatory training launch).

- 25,871 messages present. Max id ~30,700 → 4,829 messages were deleted (15.7%). See §1.4 for what got deleted.
- 459 unique senders.

### 1.2 The `TBC26` user is a forwarding agent, not a human

- Top sender by volume: `TBC26` at 9,288 messages.
- Of those, 89.7% have `forwarded_from` set (verified by the bot-footprint pass). The "TBC26" entity is the supergroup-itself-as-channel posting account, relaying content forwarded from sister channels. It is not a human admin sitting at a keyboard.
- The actual top human sender is `jups2` at 669 messages, then `UP THE RA DOSTOËVSKI` (634), `DrGonzo` (560), `ÊRÑZ` (541), `Yung King Dave` (525), `Tony Soprano` (436). **BALFROCAK is rank 10 with 385 messages** despite being the public face/admin.

### 1.3 The bot stack (21 bots, not 5)

Verified bot inventory:

| Bot | Function | Notes |
|---|---|---|
| `@shiiinabot` | Auto-deletes posts missing `@username` | Workhorse moderation. Cited explicitly: "ALL POSTS MUST CONTAIN A @username. Otherwise it will be automatically deleted by @shiiinabot" |
| `@GateShieldBot` | Removes deleted accounts from group | 54 mentions. Explains a chunk of the 15.7% deletion rate — it's removing messages from accounts that Telegram deleted (different from §1.4 message-id gaps) |
| `@SangMata_beta_bot` | User name/username history lookup | 42 mentions + 32 `via_bot`. Used by BOTH admins and members. Quota-limited; donations increase quota. Community-facing, not admin-only. |
| `@SangMata_BOT` | v1 of SangMata | 6 mentions; supplanted by `_beta_bot` |
| `@GroupHelpBot` | Rules/captcha/welcome/anti-flood/banned-words | Off-the-shelf moderation suite. |
| `@GHClone5Bot` | GroupHelp clone v5 | Active Jan-Apr 2026. Configured via DM (`/config@GHClone5Bot`). |
| `@TBC_grouphelp_bot` | GroupHelp clone, latest variant | Mentioned 2026-04-25 as part of "how to search" instructions. |
| `@TBC26_bot` | Custom — admin DM line | "Direct line to balf"; recommendation channel for new entrants. |
| `@TBC26AUTOFORWARD_BOT` | Custom auto-forward | Single mention; possibly deprecated. |
| `@BALFROCAK2_bot` | BALFROCAK's personal bot link | 4 link-share appearances. |
| `@ADLautoFORWARDbot` | Legacy auto-forward (pre-rebrand) | "Fuck her off outta this group @ADLautoFORWARDbot" — used to remove members. Discontinued post-rebrand. |
| `@username_to_id_bot`, `@userdatailsbot`, `@ScanIDBot`, `@userdatabot`, `@userinfo3bot` | User-id lookup utilities | Multiple redundant tools admins recommend members use. |
| `@spambot` (Telegram official) | Check spam-jail status | Admins query in DM. |
| `@combot` | Community/analytics | Mentioned as having triggered an early ToS migration in 2025 — see §1.6. |
| **Userbot at user_id 7853873030** | Cross-group auto-forward | TOS-violating. Self-leaked debug shows "From Chat (Source): -1002609134181 (TBC26), Adder: 7853873030, To Chats (Destination): [-1002544622093]". This is BALFROCAK's user account running a Telethon/Pyrogram-based userbot. |

The userbot finding matters: TBC26's apparent "channel + auto-forward" architecture is partly a userbot, not solely the legal Telegram channel-discussion-link feature. **VouchVault cannot replicate the userbot legally.** Channel-pair via Bot API is a partial mirror at best.

### 1.4 What got deleted from the chat (gap analysis)

- 4,829 messages absent from the export. 2,212 distinct gap events.
- 1,432 single-message gaps (64.8% of gaps). Inference: these are mostly `@shiiinabot` deleting posts that lacked `@username`, plus `@GateShieldBot` removing messages from deleted accounts. Both are automated rule enforcement, not strategic moderation.
- Only 3 mass deletions ≥50 messages in 13 months: 477 (2026-02-10), 147 (2026-02-20), 69 (2025-03-21).
- **Hour-of-day deletion clusters at 01:00 and 18:00 UTC** (589 + 580 deletions respectively). This is a cron-job pattern — `@shiiinabot` likely runs a periodic sweep at these hours.
- **The "content laundering" hypothesis (v3-v4) is not supported.** A targeted comparison of message text immediately before each top-10 gap against messages within 12 hours after found 0 exact text matches, 0 high-similarity (>70% word overlap) pairs. The 477-msg gap on 2026-02-10 was previously cited as evidence; the recurrence of 3 IDs (16486-16488 mirroring 16005-16007) is anomalous but does not constitute systematic re-posting as forwards. v3-v4's Phase 3 recovery technique was built on a misread of this gap.

### 1.5 Cadence — bursty/automated, not human-shaped

Quantitative reality, contradicting earlier session claims of "human-shaped cadence":

- **44.8% of consecutive messages are within 1 second** of the previous message. Humans cannot sustain this rate. Diagnostic of automated bursts.
- **9:00 UTC hour captures 28.4% of all messages.** In January 2026 specifically, 61% of the month's messages landed in that single hour. Cron-job pattern.
- **One day (2026-01-09) had 7,056 messages**, 62× the median (114). This was the TBC26 rebrand day; inference: a userbot bulk-imported historical content into the new identity. Not normal operations.
- **User 7853873030 (BALFROCAK's userbot) posted 540 messages with median inter-post gap 0 seconds, 90.5% within 5 seconds.** Pure machine cadence.

When the takedown hit (March 2026):
- Daily max collapsed: 7,056 → 529.
- 9:00 UTC concentration collapsed: 61% → 14%; activity spread across 18:00–23:00 UTC (human evening hours).
- Top sender's share: 5.0% → 0.5%. The bot got rate-limited or banned.
- Forward share collapsed: 22.9% → 1.2%.
- **Reply rate stayed >95%** through the attack. Humans kept conversing; the bot infrastructure was what got hit.

**Important corollary:** the surviving group (TBC26) had forwards drop from 22.9% to 1.2% during the attack, yet survived. **This refutes v3-v4's central thesis that "forwarded-from-channel shape is what protects you from bans."** The actual protection (per §1.6) was structural isolation, not on-the-wire shape.

### 1.6 Adversary timeline — three distinct events, not one

Verified per the BALFROCAK + adversary passes:

1. **2025-03-21 — `@combot`-triggered forced migration.** Service-message-driven; not a malicious attack. `@combot` detected ToS violations and Telegram migrated/deleted the source group. TBC's response was to spin up "ADL ZONE BACKUP 1" (the export starts with this migration).

   > **VouchVault implication:** off-the-shelf moderation bots can themselves be enforcement vectors. Adopting GroupHelp/combot for "captcha + welcome" is not free; if their detection flags content, Telegram-side action follows. Treat them as dual-use.

2. **2026-03-14–17 — Spontaneous mass-report Python script attack.** Hit ≥5 sister groups including TSC. Multi-night crisis. BALFROCAK quote (msg 24130, 2026-03-17 22:18 UTC): "Once it has your IP you can make 1000 accounts it will mass report you non stop. Even with a VPN and hotspoting it kept finding me... At one point I had 4 phones going. This went on for multiple nights." Tony Soprano (msg 24115): "There is absolutely 0 defence to it as well." Mechanism: random post selection from group feed → @spambot 3-strike system → account/group restricted.

3. **2026-04-01–06 — Hired ethical-hacker attack with insider folder leak.** BALFROCAK msg 28196 (2026-04-06): "Someone has leaked a chat folder link from TBC channel to our ethical hacker friend. They have done this by copying the folder link by pressing down on the button to reveal the link. He has then put the mass user reporting python script on each group in that chat folder. They will pretty much all go down now except the ones that have nothing on the group feed and **TBC26. TBC26 was kept out of that folder for this very reason.**"

   This is the single most important sentence in the entire export for VouchVault's design. The protection that worked was **not in the folder**. TBC26 lived because the adversary couldn't enumerate it from the public folder link.

### 1.7 What BALFROCAK explicitly says (verified quotes)

Defensive philosophy, in their own words:

- **No backup groups except TBC26 itself** (msg 28259, 2026-04-07): "Back up groups? Been there done that.. no point, no benefit and no value added. Except this group.. This is the only group backed up and for obvious reasons.. **Member lists of a group hold more value and benefits.**"
- **Disable link sharing + adding-contacts permissions** (msg 28608, 2026-04-10): "Spot on and wanna know why? Because no group links were shared and adding contacts permissions was disabled. **One downside for these group settings, group membership growth is extremely slow... The consequence of this is the groups get boring.**" Explicitly accepted growth-vs-survival tradeoff.
- **Fatalism + ToS literacy** (msg 28259): "At the end of the day if someone wants a group or an account down, it's gonna go down. I've learnt a lot in the past couple years and learned something new every time I have an account or group go down. I learn stronger control measures to have in place, but at the point where it's fucking impossible to manage."
- **Bot rotation as routine** (msg 24359, 2026-03-19): "New balf bot was put into action the other day. Previous one was deleted intentionally."
- **Single-post takedown risk** (msg 29471, 2026-04-17): "One post. One post that's all it takes. One post can wipe this whole operation."
- **Mandatory training modules** (msg 30011, 2026-04-22): "Telegram training starts tonight and every single of the 811 members are going back to school."
- **Admins refuse transaction liability** (msg 26982, 2026-04-02): admins are not responsible for member-to-member transactions; "do your own due diligence."

### 1.8 Account-age guard is real practice

- BALFROCAK's "Background check completed 🟧MEDIUM RISK🟧 — notes: very fresh account. Request some screens of vouches / proofs of transactions or @usernames who can verify them" (2025-03-21).
- Other admin: "Please give him time to establish a new account. Check back in tomorrow."
- 45 messages mention "new account" as a red flag, 12 mention "fresh account", 13 mention "no username" as red flag.
- This isn't a coded rule — it's a community-enforced norm. Members ask "can anyone vouch?" and the response calibrates against account age.

### 1.9 Group settings (verified)

- **Username-required at gate.** GroupHelp captcha responds "BALFROCAK, To be accepted in the Group [name], please, set a username. Please, join again in the Group if and when you will have one." (msgs 24602–24605). This is the captcha rule, configured via GroupHelp.
- **Member permissions tight.** "no group links were shared and adding contacts permissions was disabled" (BALFROCAK direct quote).
- **Slow mode**: not directly visible in export but consistent with low burst rate after bot suppression.

### 1.10 Vouch and lookup shapes (the surface culture)

- Positive vouches are loose-templated: "Vouch for @X / Big vouch for @X / Huge vouch for @X / Massive vouch for @X" + free-form prose. 3,159 instances. Wide variation in length and tone. Member-authored prose.
- Negative vouches are forensic: longer, evidence-based, often include account-history snippets pasted from SangMata. 678 instances.
- Lookup requests are ultra-templated: "Can anyone vouch [for] @X" — almost zero variation. 435 instances.

Implication: members write vouches in their own voice. There is no bot-generated templated post. The on-the-wire fingerprint of a TBC26 vouch is therefore varied prose with a `@username` mention, not "POS Vouch &gt; @target" with structured fields.

---

## 2. What v1–v4 got wrong

Naming the errors so they don't recur in v5:

| v1–v4 claim | Reality from data | Correction |
|---|---|---|
| TBC26 is forum-mode with 13 topics | 0 forum_topic_created events; flat feed | Withdraw "forum-mode + 2 topics" recommendation. |
| Forwarded-from-channel shape is the protection | Survived group's forward share collapsed under attack and it still survived | Protection is structural isolation (kept out of folder), not on-the-wire shape. |
| Content laundering via delete-and-re-post-as-forward | 0 text-equality pairs across top-10 gaps | Withdraw Phase 3 recovery technique. |
| TBC26 is "human-shaped cadence" | 44.8% messages within 1s; 28.4% in single UTC hour; user 7853873030 = pure bot | Acknowledge: TBC is hybrid bot+human, not human-shaped. The human layer is real but rides on top of automated infrastructure. |
| 5–7 bots in stack | 21 distinct bots verified, including a TOS-violating userbot | Multi-bot ecosystem is real; userbot is core to their architecture; we cannot fully replicate. |
| Backup groups are useless (TBC says) → so don't make any | Same source says "Member lists of a group hold more value" | Reframe: the recovery asset is the member list, not parallel groups. Building a backup group is not the bug; relying on it as the recovery asset is. |
| Folder distribution = inherently bad | Folder is dual-use: adversary leaks → mass attack vector. But TBC kept ONE group hidden from the folder and it survived. | Folders are usable for sister/sacrificial groups; the main group hides. We don't have sister groups so the question is moot. |
| Multi-bot split is the central architectural win | TBC's many bots are scale-driven and feature-driven, not failover-driven | At ~100 members, single-bot is fine if its fingerprint is clean. Multi-bot deferred. |

---

## 3. What actually protects a community at our scale (synthesis)

Reading across all 6 passes, the resilient core (verified by TBC's survival, distinct from their bigger-scale architecture) is:

1. **Hidden distribution.** TBC26 was not findable via the leaked folder. A small private community with a single Request-to-Join invite link, never publicly searchable, is the simplest realization. Don't post the invite link in public channels.
2. **Username-required + captcha at gate.** Off-the-shelf via GroupHelp or equivalent. Filters the cheapest attack vector (numbered/throwaway accounts).
3. **Account-age threshold before vouching.** Community norm, easy to encode at the wizard level (24h+ since first interaction with the bot).
4. **Light publish volume per real submission.** V3's 2,234-publish-in-24h burst was the textbook spam-ring fingerprint. The current rebuild (replay-as-DB-only) already eliminates the bulk-publish vector. Don't reintroduce it under any scheme.
5. **Member-list as the recovery asset.** Operator's personal Telegram saves all member @s as contacts pre-emptively. After takedown, manually re-create one new supergroup, re-add 10–20 members per day from the saved list.
6. **Tight admin list (≤5).** Each admin is an attack surface; one compromised account = group dismantled. TBC keeps it tight; we should too.
7. **Bot rotation hygiene.** Treat bot replacement as routine, not emergency. If a bot starts misbehaving, swap the token and let the old one revoke.
8. **Light-touch moderation.** TBC deletes ~12 msgs/day (mostly automated rule enforcement: missing username, deleted account). Don't stricter than that.

These are the verified-to-work elements. None require multi-bot, channel-pair, forum-mode, or content-laundering.

---

## 4. What does NOT clearly help at our scale

Verified or strongly inferred to be irrelevant or harmful:

- **Multi-bot split (3 custom bots).** TBC has many bots because they have many features and many sister groups; they're not split for failover. At ~100 members one bot is fine.
- **Channel-pair architecture (paired channel auto-forward to supergroup).** The forward share collapsed during the attack on TBC26 itself; the surviving group did not survive *because of* its forward share. Channel-pair adds operator complexity for no clearly verified ban-resilience benefit at our scale.
- **Forum-mode + topics.** TBC isn't forum-mode. We have no scale reason to be either.
- **Userbot for cross-channel forwarding.** TOS-violating; not for us.
- **Folder-of-sister-groups.** Single community; no sister groups.
- **Sacrificial sister groups.** Single community.
- **Mandatory training modules.** TBC's response to repeat takedowns; we don't have that history yet, and it's a community-process feature, not platform.
- **GroupHelp clones, custom GHClone5/TBC_grouphelp_bot, etc.** TBC rotates these because their off-the-shelf instances get banned. We don't yet have evidence VouchVault's bot is being targeted at that level.

---

## 5. The actual VouchVault ban-risk model (reset)

The dominant risk for VouchVault, evidence-weighted:

1. **Bulk publish fingerprint** — V3's documented takedown vector. Fully mitigated by the existing `feat/v4-hardening-search-rename` branch (replay-as-DB-only). **No further work needed here.**
2. **Mass-report attack from adversary with Python script + Telegram API + IP-based targeting.** TBC's experience: "There is absolutely 0 defence to it." VPN rotation delays but doesn't stop. Mitigation is structural (hide), not technical (defend).
3. **`@combot`-style off-the-shelf moderation bot detecting ToS violations and triggering migration.** Real risk if we adopt one. Mitigate by: (a) being conservative about which off-the-shelf bots we add to the group, (b) not running aggressive auto-moderation that could itself trigger Telegram's ToS pipeline.
4. **Insider report / leaked invite link.** TBC's experience. Mitigations: tight admin list, single Request-to-Join invite link, never share invite in public.
5. **ML/keyword classifier hit on platform-shaped visual signature.** Existing OPSEC doc (§2 of opsec.md) already addresses: no marketplace vocabulary in group profile, etc. Already in place.
6. **Datacenter IP scoring.** Railway runs in a datacenter. Acknowledged unmitigated risk; banking on bot identity quality.

Notice what's NOT a top-5 risk based on the data:

- **Post body templated-vs-prose shape.** The free-form prose body in v3-v4 was prescribed as the "biggest single classifier-resistance win". The data does not support that. TBC posts mostly varied prose, but they got hit anyway (just structurally protected by folder-isolation). And TBC's surviving group dramatically reduced its forward share during the attack and survived. The fingerprint argument is weaker than v3-v4 made it.
- **On-the-wire forward shape.** Same — refuted by attack-window data.
- **Number of bot identities (single vs three).** No evidence in TBC's data that multi-bot identity protected them; their bots got hit (the userbot at 7853873030 was rate-limited / silenced during the attack, and the TBC operator team rotated to "new balf bot").

---

## 6. Minimal candidate changes for VouchVault (deliberately small)

Each is a candidate, not committed work. Each is small enough to ship as its own commit if approved. Order is rough cost/payoff (cheapest first).

### 6.1 Account-age guard at wizard start (small code change)

Reject vouches submitted by Telegram accounts whose first interaction with our bot was <24h ago. Existing `processed_telegram_updates` table has timestamps for every update we've ever seen from a user_id; the first row's timestamp is the floor on "established account."

Cost: ~50 LOC — one helper in `archiveStore.ts` (`getUserFirstSeen(telegramId)`), one wizard guard at the start of the DM flow in `telegramBot.ts`, one locked-text rejection message ("please come back in 24 hours — we wait for new accounts to establish"), one test.

Evidence: TBC explicitly practices this norm (§1.8). Cheap, decoupled from any other architectural change.

### 6.2 Member-contact export script (small ops tool)

`scripts/exportMemberContacts.ts` — admin-only script that queries DB for all known member @usernames + numeric Telegram IDs and writes a CSV to stdout. Operator runs it monthly, saves the CSV locally, uses it for save-as-contacts pre-migration.

Cost: ~40 LOC, no new schema (we already have `users` table with telegram_id + username).

Evidence: TBC's actual recovery asset, per BALFROCAK's "member lists hold more value than backup groups" quote (§1.7).

### 6.3 OPSEC doc additions (no code, just doc)

Append to `docs/runbook/opsec.md`:

- **§10. Adversary-aware operations.** The Python mass-report script attack is real and undefendable at the technical level. Mitigations are structural: tight admin list, single Request-to-Join invite link, never share invite in public, save-as-contacts pre-emptively, alt admin account in case main is compromised.
- **§11. Bot replacement runbook.** Treat as routine, not emergency. Procedure (create new bot via @BotFather → swap token → redeploy → verify → delete old bot). Don't preserve dead bots.
- **§12. Off-the-shelf moderation bots are dual-use.** `@combot` triggered the original 2025 ADL ZONE migration. Be conservative about which auto-moderation we adopt. Don't add stricter rules than the existing `runChatModeration` lexicon. Don't introduce mutes/bans/strikes.
- **§13. TBC re-export cadence.** Every ~3 months or after known events, re-export and re-run the 6-pass analysis. Apply learnings additively. Resist mirroring scale-driven architecture.

Cost: ~one page of writing. No code.

### 6.4 SangMata as a recommended community tool (no code, just doc)

When operator announces operational hygiene to members, include "use `@SangMata_beta_bot allhistory <user_id>` to check name/username history before vouching" as a recommended self-service primer. Members vetting each other reduces operator load.

Cost: a paragraph in opsec.md or a /help text update.

Evidence: TBC's exact pattern; SangMata is community-facing, not admin-only.

### 6.5 GroupHelp captcha + username-required at the join gate (no code, operator-side)

Add `@GroupHelpBot` (or equivalent — `@shieldy_bot`) to the supergroup. Configure: captcha on join, username-required. This is the single highest-leverage operator-side action; replaces any "grow our own captcha surface" temptation.

Cost: zero code. Adds a ~5 minute operator setup. Documented in opsec.md.

**Caveat:** GroupHelp's parent (`@GroupHelpBot`) is itself a moderation bot whose ToS-detection could flag content. Use conservatively. Disable any banned-words / anti-flood feature that's stricter than our existing `runChatModeration` lexicon.

### 6.6 NOT recommended (explicit anti-scope)

For clarity:

- ❌ Multi-bot split (lookup bot, admin bot). No evidence this protects at our scale.
- ❌ Channel-pair architecture / paired channel + auto-forward link. Refuted by attack-window data.
- ❌ Forum-mode supergroup. TBC isn't forum-mode.
- ❌ Free-form prose body for group posts (replacing the structured `POS Vouch > @target` shape). The fingerprint argument is weaker than v3-v4 claimed; the existing `/search`-driven structured archive depends on the structured shape; switching is a large surface change with unclear payoff.
- ❌ Wizard prose-collection step (the V3.5 locked-text addition). Same reasoning.
- ❌ `is_automatic_forward` capture handler. Not needed without channel-pair.
- ❌ DB schema additions for `channel_message_id`, `body_text`. Not needed without channel-pair.
- ❌ Userbot for any purpose. TOS violation.
- ❌ Folder-based distribution. Single community; no folder needed.
- ❌ Sister groups / sacrificial groups. Single community.
- ❌ Mandatory training modules. Out of scope.
- ❌ Per-post timing jitter. Not the actual fingerprint vector at low volume.

If the user wants any of these later, they get their own brainstorm + spec from a clean slate, not as inheritance from the v1–v4 bias.

---

## 7. Open questions (things we still don't know)

These are real gaps in our understanding, listed so they don't get silently filled by speculation:

1. **What does Telegram's classifier actually score on?** We have BALFROCAK's empirical observations + our own analysis but no ground truth. Continued re-exports + comparison to known-banned vs. known-surviving groups would help, but we can't get ground truth from a single dataset.
2. **Did `@combot` directly trigger the 2025 migration, or did it merely alert the admin to an action Telegram took?** We have BALFROCAK's interpretation; we don't have Telegram-side records.
3. **How exactly does the Python mass-report script work?** Tony Soprano (msg 24114): "Someone is running a simple python script that just mass reports." The mechanism (script source, exact API endpoints abused, account-acquisition pipeline) is not in the export.
4. **Who is the insider that leaked the folder link?** Not identified in the export. BALFROCAK msg 30067 (2026-04-23) flags two specific accounts (`@ifyouknowyouknow333`, `@crackkkkshackkk`) for cross-reference; whether they're the leaker is undetermined.
5. **What's TBC26's actual member count?** Various BALFROCAK messages cite 750, 780, 811. Snapshot inconsistency. Known to be in the ~750–800 range.
6. **Are TBC26's many bots a defense or a feature surface?** Both, partly. The repeated bot rotation (`@SangMata_BOT` → `@SangMata_beta_bot`; GroupHelp → GHClone5 → TBC_grouphelp_bot) suggests TBC treats bots as fungible and replaceable, but the trigger for each rotation isn't always documented.
7. **Why was forwarding removed during the attack window?** Inference: the userbot at 7853873030 was the publisher; when that account got rate-limited, the daily 9:00 UTC dumps stopped. But we can't fully verify.
8. **What in the export is classifier-flag content vs. just legal community content?** TBC's vocabulary cluster (drug-trade direct vocab) is illegal content under Telegram ToS even though the *community* hasn't been deleted. This is a key reason TBC's lessons need to be filtered for transferability.

These open questions should be pulled forward in future re-export readings.

---

## 8. Revised re-read protocol

The user's instruction to keep reading TBC over time: confirmed correct approach. Each re-export should run the same 6 passes:

1. Top admin's full message timeline (BALFROCAK's role-equivalent in our data, which may shift over time).
2. Bot footprint inventory (changes are intel signal — new bots = new defenses adopted; missing bots = banned).
3. Deletion archaeology (gap distribution; mass-deletion event analysis; do NOT confuse with `from: "Deleted Account"` artifacts).
4. Cadence/timing (especially: is the 9:00 UTC hour still dominant? Has the userbot been replaced?).
5. Adversary timeline (new attacks since last read; defensive innovations; mistakes admitted publicly).
6. Member behavior + rules + onboarding (any new gating or onboarding requirements).

Compare each re-read to the previous. Flag changes. Apply *additively* to opsec.md. Do not rewrite opsec.md based on a single re-read; only adjust when a finding is corroborated across two consecutive reads.

---

## 9. What to do next (concrete, small)

If the user approves any items from §6, each becomes its own commit. Suggested order, lowest cost first:

1. §6.3 — OPSEC doc additions. Pure doc. ~1 hour.
2. §6.4 — SangMata recommendation. ~10 min doc.
3. §6.5 — GroupHelp captcha (operator action documented in §6.3). ~10 min doc.
4. §6.2 — Member-contact export script. ~1 hour code + test.
5. §6.1 — Account-age guard. ~2 hours code + test + locked text.

Total: ≤1 day of work to ship the entire candidate set if all are approved.

If the user wants none of them, that's also fine — the existing branch (replay-as-DB-only, structured archive, light-touch chat moderation, takedown-resilience early-warning) already addresses the V3 takedown vector. Nothing in v5 is urgent.

---

## 10. What this doc explicitly is NOT

- Not an implementation plan. No work is committed.
- Not a final architecture. Reading more TBC exports over time will refine it.
- Not exhaustive about TBC. 6 passes is a lot but not the same as a full forensic study; some questions stay open (§7).
- Not generalizable to other communities at different scales. At 800+ members with adversarial threat model and multi-platform federation, the calculus differs. We're at ~100 members, single platform, no documented adversary yet.

The point of v5 is **stability** — a doc the user can come back to in 3 months, re-read alongside a new TBC export, and update without rewriting the foundation.
