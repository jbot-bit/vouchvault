# SC45 Launch Spec
**Date:** 2026-04-28  
**Status:** Draft  
**Scope:** Everything needed to launch SC45 — Sunshine Coast vouch community — from zero to live.

---

## Architecture summary

```
PUBLIC CHANNEL "SC45"          PRIVATE GROUP "SC45"
(discovery, pinned link)  ───► (community, vouches, bans)
         │                              │
         │                    ┌─────────┴──────────┐
    DM @SC45_bot              │    Bot stack        │
    /join command             │                     │
         │                    │  Group Help clone   │
         ▼                    │  (@SC45_grouphelp)  │
  Single-use invite           │  VouchVault bot     │
  link → Request-to-Join      │  (@SC45_bot)        │
         │                    │  SaaS Forwarder     │
         ▼                    │  SangMata (beta)    │
  JOIN REQUESTS topic         │  Remove Del Accts   │
  community votes ✅/❌        └─────────────────────┘
         │
         ▼
  Auto-approve on 1 vote
```

---

## Phase 0 — Before you touch Telegram

### Decisions confirmed
- **Name:** SC45
- **Region:** Sunshine Coast, QLD (postcode prefix 45)
- **Join flow:** Channel → DM bot → single-use link → Request-to-Join → community votes
- **Member add:** Any member can directly add contacts (bypasses queue, implicit vouch)
- **Vetting threshold:** 1 ✅ from any member = auto-approve
- **Moderation:** Group Help clone handles bans/captcha/wordfilter; VV bot handles join vetting + lookup

### Accounts and tokens you need before starting
1. **Bot token** — BotFather → `/newbot` → name "SC45" → username `@SC45_bot` → save token
2. **Group Help clone** — DM `@GHClone5Bot` → follow prompts → get your clone with username `@SC45_grouphelp_bot`
3. **Your Telegram owner account** — whatever account you'll use as group owner. Doesn't need to be a pseudonym but don't use your real full name.

---

## Phase 1 — Create the group

### Step 1: Create the supergroup
- New group → name it **SC45** → add at least one contact temporarily to create it
- Settings → Convert to supergroup (if not already)
- Settings → **Group type: Private**
- Settings → **Who can add members: All Members** ← critical, enables organic growth
- Settings → Topics → **Enable** ← turns it into forum/supergroup mode

### Step 2: Group permissions
Set member default permissions:
- ✅ Send messages
- ✅ Send media
- ✅ Send stickers/GIFs (optional, can restrict later)
- ❌ Add members (handled by "All Members can invite" — separate from this)
- ❌ Pin messages
- ❌ Change group info

### Step 3: Create topics (in this order)
Create each topic. Note the message_thread_id for each — you'll need them for bot config.

| Topic name | Who can post | Purpose |
|---|---|---|
| `ADMIN LOGS` | Admins + bots only | Bot activity, ban records, SangMata changes |
| `JOIN REQUESTS` | Admins + bots only (members press buttons) | New member vetting |
| `GOOD CUNTS` | All members | Positive vouches |
| `SHIT CUNTS` | All members | Negative vouches / warnings |
| `BANNED LOGS` | Admins only | Formal bans with ID + reason |
| `CHAT` | All members | General discussion |
| `HOW TO USE` | Admins only | Pinned instructions |

To lock a topic to admins only: tap topic name → Edit → toggle off member posting.

### Step 4: Group description
```
SC45 — Sunshine Coast vouching community.
Members post vouches for people they've dealt with.
Search this group before any deal.
To join: DM @SC45_bot
```

### Step 5: Group invite link
Settings → Invite links → Create link → **Enable "Request admin approval"**  
This means even if someone shares the link, joiners still go into the approval queue. Save this link — it's your permanent entry point.

---

## Phase 2 — Create the channel

### Step 6: Create the channel
- New channel → name **SC45** → type **Public** → set username `@SC45` (or `@SC45_QLD` if taken)
- Channel description:
```
SC45 — Sunshine Coast vouch community.
Check someone before a deal. Post your vouches.
To join the group: DM @SC45_bot
```

### Step 7: Link channel to group
Channel settings → Discussion → select your SC45 group.  
This makes the channel the "comments" layer and links the two together officially.

### Step 8: Channel pinned post
Pin this as the first post:

```
👋 SC45 — Sunshine Coast Vouch Community

To join the group, DM @SC45_bot and send /join
You'll get a private link.

Already a member? You can add trusted people directly.

Search this channel for vouches on anyone before a deal.
```

---

## Phase 3 — Install Group Help clone

### Step 9: Add your clone to the group
Add `@SC45_grouphelp_bot` to the group as admin with:
- ✅ Delete messages
- ✅ Ban users
- ✅ Invite users
- ✅ Manage topics
- ✅ Pin messages

### Step 10: Configure Group Help clone
DM your clone bot to open settings. Configure:

**Username requirement:**
- Enable: kick anyone who joins without a @username
- Message: `SC45 requires a @username. Set one in Telegram settings and request to join again.`

**Welcome message** (sent to new members when approved):
```
👋 Welcome to SC45!

A few things:
• Post vouches in GOOD CUNTS — always include @username
• Check SHIT CUNTS + BANNED LOGS before any deal
• Search by Telegram ID not @username (people change those)
• DM @SC45_bot for help or to look someone up

Your rep here is everything.
```

**Wordfilter — vouch enforcement:**
- Rule: posts in GOOD CUNTS that don't contain "@" → delete + warn
- Message: `Vouches must include the @username. Post deleted.`

**Captcha:** Optional — enable if you start getting bot-account spam joiners.

**Log channel:** Point Group Help logs to your ADMIN LOGS topic.

**Blacklist:** Import any existing blacklist you have via `.blacklist [url]`.

---

## Phase 4 — Install utility bots

### Step 11: SangMata (beta)
- Add `@SangMata_beta_bot` to group as admin (needs message access to track changes)
- It will auto-post name/username changes to the chat — configure it to post to ADMIN LOGS topic if possible, otherwise it posts to general

### Step 12: Remove Deleted Accounts
- Add `@DeletedAccountsBot` (or similar — the one you already have) as admin
- It runs periodic sweeps and posts results to chat/ADMIN LOGS

### Step 13: SaaS forwarder
- Go to `@AdvanceForwarderRobot` or `autoforwardtelegram.com`
- Set up: Source = SC45 group → Destination = SC45 channel
- Enable: forward all member messages
- This is your live backup mirror. If the group goes down, channel survives with full history.

---

## Phase 5 — Deploy VouchVault bot

### Step 14: Add @SC45_bot to group as admin
Permissions needed:
- ✅ Invite users (`can_invite_users`) — required for approving join requests + creating invite links
- ✅ Manage topics (`can_manage_topics`) — required to post to specific topics

### Step 15: Configure environment variables
```
TELEGRAM_GROUP_ID=-100[your group ID]
TELEGRAM_CHANNEL_ID=-100[your channel ID]
TOPIC_ADMIN_LOGS=[thread ID of ADMIN LOGS topic]
TOPIC_JOIN_REQUESTS=[thread ID of JOIN REQUESTS topic]
JOIN_VOTE_THRESHOLD=1
JOIN_LINK_EXPIRY_SECONDS=86400
JOIN_LINK_RATE_LIMIT_MS=600000
```

### Step 16: Update setWebhook allowed_updates
```
chat_join_request, callback_query, message, my_chat_member
```
Run `npm run telegram:webhook` after deploying.

---

## Phase 6 — New features to build in VouchVault bot

### Feature A: `/join` DM command
**Trigger:** User DMs bot `/join`  
**Flow:**
1. Check rate limit — 1 request per user per 10 minutes. If hit: "You already requested a link recently. Try again in X minutes."
2. Call `createChatInviteLink` with:
   - `creates_join_request: true` (routes through Request-to-Join queue)
   - `expire_date: now + 1h` (short window limits shareability)
   - NOTE: `member_limit` and `creates_join_request` are mutually exclusive per Bot API — omit `member_limit` when using `creates_join_request`
3. Reply: "Here's your join link (expires in 1 hour): [link]"
4. Log to ADMIN LOGS: "🔗 Join link issued to @username [ID]"

**Security note:** The link is shareable but short-lived (1h) and the bot rate-limits issuance (1 per user per 10 min). Everyone who uses the link still goes through the approval queue — they can't see group content until a member vouches them in. Sharing the link just adds more people to the queue, not to the group.

### Feature B: Join request vetting
**Trigger:** `chat_join_request` update  
**Flow:**
1. Extract: `user.id`, `user.username`, `user.first_name`, `user.last_name`, `date`
2. Post to JOIN REQUESTS topic:
```
🔔 Join Request
👤 [First Last] @username
🆔 ID: 1234567890
📅 [timestamp]

[✅ Vouch In]  [❌ Decline]
```
3. Store pending request in DB: `{ user_id, chat_id, message_id, votes: [], status: 'pending' }`
4. On `callback_query`:
   - If `✅ Vouch In` pressed:
     - Check voter is a group member (not the requester themselves)
     - Add voter to `votes[]` (deduplicate — one vote per member)
     - If `votes.length >= JOIN_VOTE_THRESHOLD`: call `approveChatJoinRequest`, update message to "✅ Approved by @voter"
   - If `❌ Decline` pressed (any member OR admin):
     - Call `declineChatJoinRequest`, update message to "❌ Declined"
     - If admin: immediate, no threshold needed

5. Pending requests expire after 48h — auto-decline with log.

### Feature C: Admin override
Any existing admin command `/approve [user_id]` or `/decline [user_id]` bypasses voting threshold immediately.

---

## Phase 7 — Pinned posts copy

### HOW TO USE topic (pin this)
```
🔍 HOW TO SEARCH BEFORE A DEAL

@usernames change. Telegram IDs never change.

Step 1 — Get their ID:
  @userdatabot or @SangMata_beta_bot
  Send their @username → get ID back

Step 2 — Search banned logs:
  Go to BANNED LOGS topic
  Tap ⋮ → Search → enter the ID

Lookup bots:
  @userdatabot
  @SangMata_beta_bot
  @username_to_id_bot
  @ScanIDBot

DM @SC45_bot to look someone up from the legacy archive.

━━━━━━━━━━━━━━━

🤝 HOW TO VOUCH

Post in GOOD CUNTS. Must include @username.

Example:
"Vouch @username — reliable, on time, product was as described"

No @username = auto-deleted.

━━━━━━━━━━━━━━━

❌ HOW TO REPORT

Post in SHIT CUNTS. Include @username + what happened.
If serious: DM @SC45_bot or an admin.
```

### BANNED LOGS topic pinned post
```
🚫 BANNED LOGS

Search by Telegram ID — not @username.

How to find someone's ID:
  @userdatabot → send their @username

Then tap ⋮ → Search in this topic → enter the ID.

Format for bans posted here:
🆔 ID: [id]  👤 Name: [name]  📛 @username
💬 Reason: [reason]  📅 Date: [date]
```

### ADMIN LOGS topic pinned post
```
📋 ADMIN LOGS

Automated log of:
• Join approvals / declines
• Bans + blacklist imports
• Name/username changes (SangMata)
• Deleted account sweeps

Admins: @[your username]
Direct line: @SC45_bot
```

---

## Phase 8 — Migrate v4 members

v4 had ~70 unvetted members (open invite link, no approval). Options:

**Option A — Soft migration (recommended):**
1. Post in v4: "Moving to SC45. DM @SC45_bot and send /join to get the new link."
2. Trusted members you know personally: add them directly via "Add member" (bypasses queue).
3. Everyone else: goes through the /join → vote flow. Unknown people get vetted by the community.
4. Leave v4 up for 2 weeks then archive.

**Option B — Hard cutover:**
1. Post in v4: "SC45 is live. Link below." Post the Request-to-Join link directly.
2. Everyone goes through the approval queue at once.
3. You approve people you recognise; unknown ones get voted on.

Option A is lower friction. Option B gives cleaner vetting.

---

## Phase 9 — Go-live checklist

- [ ] Bot token created, deployed, webhook set
- [ ] Group created: private supergroup, topics enabled, All Members can invite
- [ ] All 7 topics created, topic IDs noted in env vars
- [ ] ADMIN LOGS + JOIN REQUESTS locked to admin-only posting
- [ ] Channel created, linked to group, pinned post up
- [ ] Group Help clone installed, username requirement + welcome + wordfilter configured
- [ ] SangMata installed as admin
- [ ] Remove Deleted Accounts installed as admin
- [ ] SaaS forwarder running (group → channel)
- [ ] VouchVault bot installed as admin (can_invite_users, can_manage_topics)
- [ ] /join DM flow tested end-to-end
- [ ] Join request → vote → approve flow tested
- [ ] HOW TO USE, BANNED LOGS, ADMIN LOGS pinned posts published
- [ ] v4 migration message posted

---

## What this group is NOT

- Not a bot-posted vouch system — members post in their own words
- Not a templated output — Group Help enforces @username, that's it
- No bulk bot messages — the V3 takedown vector is structurally absent
- No wizard, no DM submit flow — everything happens in the group natively
