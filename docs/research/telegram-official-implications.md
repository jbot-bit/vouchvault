---
source: synthesis from docs/research/telegram-official/raw/*.html
captured: 2026-04-29
status: synthesis — when refreshing source HTMLs, regenerate this doc
---

# Telegram Official-Doc Implications for VouchVault

## How to use this doc

Each section pairs a **verbatim quote** from one of the canonical HTML pages saved under `docs/research/telegram-official/raw/` with a short architectural implication for VouchVault. The HTML files are the bible — the `.md` summaries beside them are AI-generated and not authoritative. If a claim does not have a verbatim quote in this doc, treat it as unverified.

Verdict tags:
- **aligned** — current code/doctrine matches the quote
- **gap** — current code/doctrine does not match and we should adjust
- **open question** — the quote constrains a future decision (V1 → V4 forwarding, paid broadcasts, etc.) that has not been made yet

---

## 1. Rate limits

### 1.1. Per-chat: 1 msg/sec, with bursts allowed

> "In a single chat, avoid sending more than one message per second. We may allow short bursts that go over this limit, but eventually you'll begin receiving 429 errors."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

**Implication for VouchVault:** Mirror writes are 1:1 with member group posts; in a small private group this is naturally well below 1/sec. The risk vector is *replay* — `scripts/replayToTelegramAsForwards.ts` writes to the backup channel, then any future re-injection into a recovery group must respect the per-chat ceiling. The current 25-msg/sec replay throttle is per-channel safe, but if anything ever batches sends into a single group/channel, it must stay ≤1/sec sustained.

**Verdict:** aligned (member-post + bot-mirror is structurally below this ceiling). Open question on V1→V4 replay throttle.

### 1.2. Per-group: 20 msgs/min

> "In a group, bots are not be able to send more than 20 messages per minute."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

**Implication for VouchVault:** This is the explicit ceiling for any bot-authored content in a group. v9 deleted the templated publish path, so the bot now sends near-zero messages into the group itself (only admin replies, lookup confirmations, moderation DMs). The 20/min ceiling effectively forbids ever returning to anything resembling V3's bulk-replay vector inside a group — even paid broadcasts (1.4 below) are framed as "to users" / "to subscribers", not "to a group."

**Verdict:** aligned. Anchors the v9 scope-boundary doctrine: "no bot-authored bulk into the group, ever."

### 1.3. Bulk broadcast (DM): ~30 msgs/sec

> "For bulk notifications, bots are not able to broadcast more than about 30 messages per second, unless they enable paid broadcasts to increase the limit."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

**Implication for VouchVault:** Concerns only DM broadcast. VouchVault never broadcasts; DMs are reactive (member `/lookup`, admin replies). The number is useful as the *headroom for replay tooling* if we ever forward backup-channel content out as DMs, which we don't do today.

**Verdict:** aligned (we do not broadcast).

### 1.4. Paid broadcasts (1000/sec) — eligibility constraints

> "Enabling paid broadcasts in @BotFather allows a bot to broadcast up to 1000 messages per second. Each message broadcasted over the free amount of 30 per second incurs a cost of 0.1 Stars per message, paid with Telegram Stars from the bot's balance. In order to enable this feature, a bot must have at least 100,000 Stars on its balance and at least 100,000 monthly active users."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-39s-subscribers-at-once

**Cross-ref Bot API:** "By default, all bots are able to broadcast up to 30 messages per second to their users. Developers can increase this limit by enabling Paid Broadcasts in @Botfather - allowing their bot to broadcast up to 1000 messages per second… In order to use this feature, a bot must have at least 10,000 Stars on its balance." (`bots-api.html`, https://core.telegram.org/bots/api#paid-broadcasts)

**Implication for VouchVault:** Paid broadcasts are gated behind 100k MAUs (per the FAQ; the Bot API page cites a lower 10k Stars balance threshold for activation only — the FAQ's 100k/100k is the eligibility floor). VouchVault has nowhere near that scale. **Architectural meaning: paid broadcasts are not a recovery-tooling escape hatch.** Any future "replay 10k legacy entries to subscribers" idea is structurally blocked by MAU eligibility.

**Verdict:** open question — but practically blocked.

### 1.5. Avoidance pattern when broadcasting normally

> "If you do not wish to enable paid broadcasts, consider spreading them over longer intervals (e.g. 8-12 hours) to avoid hitting the limit. The API will not allow bulk notifications to more than ~30 users per second – if you go over that, you'll start getting 429 errors."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-39s-subscribers-at-once

**Implication for VouchVault:** The stated remediation for V3-shaped bulk operations is *spreading over 8-12 hours*. V3's 2,234 msgs in 24 hours is ~93/hr or ~1.5/min — which is *under* the per-group 20/min ceiling on paper. The takedown was therefore not a pure rate-limit violation. The empirical takedown signal was **shape**, not throughput (KB:F2.5, project_takedown_empirical_2026-04-27). This quote anchors why v9 doctrine is "no bot-authored content in the group at all," not "throttle the bot harder."

**Verdict:** aligned (v9 doctrine).

---

## 2. Bot privacy mode + UI visibility

### 2.1. Default-on, definition

> "By default, all bots added to groups run in Privacy Mode and only see relevant messages and commands: [...] All bots will also receive, regardless of privacy mode: [...] All service messages. All messages from private chats. All messages from channels where they are a member."

**Source:** `bots-features.html` — https://core.telegram.org/bots/features#privacy-mode

**Implication for VouchVault:** Privacy mode ON would prevent the bot from seeing arbitrary member group posts → mirror cannot work, lexicon moderation cannot work. `docs/runbook/opsec.md` §19 already captures privacy-mode-OFF posture. This quote is the canonical justification.

**Verdict:** aligned (privacy-OFF posture is correct and load-bearing).

### 2.2. Admin override

> "Privacy mode is enabled by default for all bots, except bots that were added to a group as admins (bot admins always receive all messages)."

**Source:** `bots-features.html` — https://core.telegram.org/bots/features#privacy-mode

**Implication for VouchVault:** Even with privacy mode ON, an admin bot receives all messages. So "make the bot admin" is a fallback if privacy-mode toggle UX is ever a barrier. Currently we ship privacy-OFF *and* admin — the admin clause is what makes `can_delete_messages` work for the lexicon enforcement (see CLAUDE.md "Chat moderation").

**Verdict:** aligned.

### 2.3. Privacy setting is publicly visible to group members

> "Users can always see a bot's current privacy setting in the list of group members."

**Source:** `bots-features.html` — https://core.telegram.org/bots/features#privacy-mode

**Implication for VouchVault:** This is **load-bearing for OPSEC**. A member who taps the bot in the member list sees "has access to messages" — which truthfully discloses that the bot can read everything posted. The owner has previously asked about classifier-resistance. This UI visibility cannot be hidden; it is enforced client-side. Any future thinking about "look like a benign moderation bot" must accept that members and any reporter see the bot's privacy posture.

**Verdict:** aligned, but adds a constraint to the identity-surface story (`docs/runbook/opsec.md` §20).

### 2.4. Bot-to-bot blindness (loop prevention)

> "Bots talking to each other could potentially get stuck in unwelcome loops. To avoid this, we decided that bots will not be able to see messages from other bots regardless of mode."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#why-doesn-39t-my-bot-see-messages-from-other-bots

**Implication for VouchVault:** The mirror skip on `is_bot` / `via_bot` in `chatModeration.ts` is consistent with this. More importantly: **this quote prevents a "second bot relays into the group on first bot's behalf" architecture** from being a loophole — Telegram won't even deliver the relay's messages to the moderation bot. If we ever explored a multi-bot architecture for resilience, the bots can't observe each other's traffic.

**Verdict:** aligned.

---

## 3. Webhook delivery semantics

### 3.1. IP source ranges

> "Accepts incoming POSTs from subnets `149.154.160.0/20` and `91.108.4.0/22` on port 443, 80, 88, or 8443."

**Source:** `bots-webhooks.html` — https://core.telegram.org/bots/webhooks

**Implication for VouchVault:** If we ever tighten the Railway ingress (currently we accept any IP + verify via path token + secret_token header), these are the canonical CIDRs. Note: IPv4 only; "IPv6 is currently not supported for webhooks" (same source).

**Verdict:** open question (we currently rely on path + header secret rather than IP allowlist; that is correct per FAQ §"How can I make sure that Webhook requests are coming from Telegram?" which recommends path secret).

### 3.2. Supported ports

> "Ports currently supported for Webhooks: 443, 80, 88, 8443."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#i-39m-having-problems-with-webhooks (also restated in `bots-webhooks.html` and `bots-api.html` setWebhook notes)

**Implication for VouchVault:** Railway HTTPS is on 443 — fine. Don't try to put the webhook behind any non-standard port.

**Verdict:** aligned.

### 3.3. TLS posture

> "We support any SSL/TLS version TLS1.2 and up for your webhook. This means that SSLV2/3/TLS1.0/TSL1.1 are NOT supported, due to security issues associated with those older versions."

**Source:** `bots-webhooks.html` — https://core.telegram.org/bots/webhooks#not-all-ssl-tls-is-equal

**Implication for VouchVault:** Railway's edge does TLS 1.2+. Not a constraint we touch.

**Verdict:** aligned.

### 3.4. Redirects forbidden

> "Redirects are not supported."

**Source:** `bots-faq.html` — https://core.telegram.org/bots/faq#i-39m-having-problems-with-webhooks

**Implication for VouchVault:** If we ever sit Cloudflare in front and it 301s `http→https` or trims a trailing slash, webhook delivery breaks silently. Keep the webhook URL exact and final.

**Verdict:** aligned (single direct URL today).

### 3.5. Retry semantics — non-2XX is retried

> "In case of an unsuccessful request (a request with response HTTP status code different from 2XY), we will repeat the request and give up after a reasonable amount of attempts."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#setwebhook

**Implication for VouchVault:** This is *the* reason `processed_telegram_updates` exists with `(bot_kind, update_id)` uniqueness, and why `server.ts` wraps `processTelegramUpdate` in a 25s race — Telegram retries non-2XX, including server timeouts. We must always 200 (even on bad input), and idempotency is mandatory not optional. The mirror `mirror_log` unique on `(group_chat_id, group_message_id)` (migration 0014) implements the same defense for the side-effect.

**Verdict:** aligned. CLAUDE.md "Storage / DB" already captures this.

### 3.6. Authenticity: `secret_token` header

> "If you'd like to make sure that the webhook was set by you, you can specify secret data in the parameter secret_token. If specified, the request will contain a header 'X-Telegram-Bot-Api-Secret-Token' with the secret token as content."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#setwebhook

**Implication for VouchVault:** Combined with the FAQ recommendation ("we recommend using a secret path in the URL you give us, e.g. www.example.com/your_token") we have two layers of authenticity. Verify the header in `server.ts` ingress.

**Verdict:** aligned (path token + header are both honoured).

### 3.7. `allowed_updates` is server-side, sticky across calls

> "Please note that this parameter doesn't affect updates created before the call to the setWebhook, so unwanted updates may be received for a short period of time."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#setwebhook

> "If not specified, the previous setting will be used."

**Source:** `bots-api.html` — same row, `allowed_updates` description

**Implication for VouchVault:** The set of update types we receive lives on Telegram's side, not in our code. Adding a new handler (e.g. `chat_join_request`) requires re-running `npm run telegram:webhook`. CLAUDE.md "Telegram I/O" already calls this out — these quotes are why.

**Verdict:** aligned.

### 3.8. `max_connections` cap

> "The maximum allowed number of simultaneous HTTPS connections to the webhook for update delivery, 1-100. Defaults to 40."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#setwebhook

**Implication for VouchVault:** The 10-connection setting matches CLAUDE.md "Storage / DB" comment; we have plenty of headroom inside the 100-cap.

**Verdict:** aligned.

---

## 4. Forwarding mechanics

### 4.1. `forwardMessage` — sender attribution preserved

> "Use this method to forward messages of any kind. Service messages and messages with protected content can't be forwarded. On success, the sent Message is returned."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#forwardmessage

> "forward_origin … Optional. Information about the original message for forwarded messages"

**Source:** `bots-api.html` — Message object, https://core.telegram.org/bots/api#message

**Implication for VouchVault:** A `forwardMessage` produces a new message in the destination chat that carries `forward_origin` referencing the original sender/chat. **This is the structural difference from V3's templated `sendMessage` rewrites.** The mirror is content-neutral: Telegram's own infrastructure renders the forwarded message with native "forwarded from @user" attribution; the bot is not authoring text. Recovery via `forwardMessages` back from the channel preserves the same chain — a recovery group is reconstructed without the bot ever being a content author.

**Verdict:** aligned. **This is the load-bearing v9 architectural quote.**

### 4.2. `forwardMessages` — batch up to 100, ordered

> "Use this method to forward multiple messages of any kind. If some of the specified messages can't be found or forwarded, they are skipped. Service messages and messages with protected content can't be forwarded. Album grouping is kept for forwarded messages."

> "message_ids … A JSON-serialized list of 1-100 identifiers of messages in the chat from_chat_id to forward. The identifiers must be specified in a strictly increasing order."

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#forwardmessages

**Implication for VouchVault:** `replayToTelegramAsForwards.ts` should batch in groups of ≤100 with strictly-increasing `message_id` arrays. "Skipped if not found" is friendly: a partially-pruned source channel still produces a best-effort recovery with no per-message error handling.

**Verdict:** aligned (current replay tool throttles to 25/sec; should also batch ≤100 if not already).

### 4.3. Forwards are subject to the same rate limits

The Bot API does not exempt forwards from the rate limits in §1. The `bots-faq.html` rate-limit text is generic to "send" — it does not say "except forwards". The current `replayToTelegramAsForwards.ts` 25 msgs/sec limit aims under §1.3's ~30/sec broadcast ceiling — but also note §1.1's 1/sec per chat: a recovery channel is one chat, so even at 25/sec we are above the per-chat ceiling. Telegram allows "short bursts" — the burst tolerance is the only reason this works.

**Verdict:** open question — we should empirically test the replay tool against a fresh test channel before relying on it for a real recovery, and document the observed sustained-rate behaviour in `docs/runbook/opsec.md`.

### 4.4. `protect_content` — disables further forwarding

> "protect_content … Protects the contents of the forwarded message from forwarding and saving"

**Source:** `bots-api.html` — https://core.telegram.org/bots/api#forwardmessage

**Implication for VouchVault:** If we ever want the backup channel to be a true takedown-resilience replica, do **not** set `protect_content` — we *want* to be able to re-forward to a recovery group. If we ever wanted to harden the V4 group itself against screenshot-amplified takedowns, we'd consider setting it on bot-originated content (we have none). Mirror writes today do not set this flag — correct.

**Verdict:** aligned.

---

## 5. Account-level enforcement chain

### 5.1. Bot ban → owner-account ban explicitly authorized

> "Failure to comply with these Terms or the Telegram Terms of Service may result in a temporary or a permanent ban from Bot Platform or Telegram apps. In such instances, your TPA will be removed from Bot Platform and become partially or fully inaccessible to some or all users. Should we have reason to do so, at our sole discretion, the Telegram account tied to your TPA may also be banned from the Telegram platform, as well as any channels or communities affiliated with your TPA."

**Source:** `tos-bot-developers.html` §10 Termination — https://telegram.org/tos/bot-developers#10-termination

**Implication for VouchVault:** This is the explicit collateral-ban clause. The owner's 1-year-old account that owns V3 is **already exposed**: V3 was banned, and Telegram retains discretion to chain-ban "channels or communities affiliated with your TPA." The pre-existing flag on the owner account is consistent with this clause already having activated partially. **Architectural meaning:**
- BotFather ownership and group-creator accounts should be different where possible.
- Future bots in this lineage should be created by a fresh, clean BotFather-owner account, not the V3-owner account.
- Any group migration (V1 → V4) should not be created *by* the same account that owns the bot, if that can be avoided.

**Verdict:** gap — current operational posture has not formalized owner-account isolation. Should be a follow-up to `docs/runbook/opsec.md`.

### 5.2. Survivability of liability after termination

> "The following paragraphs will continue to apply and survive the termination of Bot Platform and, by extension, of these Bot Developer Terms: 2.1., 4.2., 4.4., 5, 5.1., 5.2., 6.1., 6.2., 6.3., 6.4., 7., 7.2., 8., 8.1., 11. and 11.2.."

**Source:** `tos-bot-developers.html` §10.2 — https://telegram.org/tos/bot-developers#10-2-survivability

**Implication for VouchVault:** Even after a bot is terminated, the data-retention obligations (4.2.) and the Code of Conduct (5.) survive. So if Telegram bans the bot, we still owe deletion of user data on request and we still cannot, for example, re-host the data on an external site that violates §5.1. Practically: the DB content (legacy V3 archive + member content captured via mirror) remains under retention discipline forever.

**Verdict:** aligned in principle, but our retention SOP isn't written down — see §7.

### 5.3. Modification of services without notice

> "We may, at our sole and absolute discretion and without liability, at any time and without notice, modify Bot Platform in any way we deem necessary."

**Source:** `tos-bot-developers.html` §13 — https://telegram.org/tos/bot-developers#13-modification-of-the-services

**Implication for VouchVault:** Confirms that *every* limit cited in this doc can change unilaterally. The doc is a snapshot; a quarterly re-export of the HTMLs is the only durable defense.

**Verdict:** aligned (this doc explicitly says "regenerate when refreshing source HTMLs").

---

## 6. Spam / abuse moderation

### 6.1. Reports are forwarded to human moderators

> "When users press the 'Report spam' button in a chat, they forward these messages to our team of moderators for review. If the moderators decide that the messages deserved this, the account becomes limited temporarily."

**Source:** `faq-spam.html` — https://telegram.org/faq_spam#q-what-happened-to-my-account

**Implication for VouchVault:** Enforcement is **report-driven** (a user has to press Report Spam) and human-reviewed. It is not proactive scanning of group content (with one carve-out — see §6.4 below). This is consistent with project memory `reference_telegram_tos.md`. Architecturally: as long as members don't report each other (private group, vetted entry via Request-to-Join), the bot itself almost never triggers Spam-FAQ enforcement. The V3 takedown was therefore not a `faq-spam` incident — it was a Bot-Developer-ToS §5.2 enforcement (bot operating outside intended scope), which is a different chain.

**Verdict:** aligned.

### 6.2. Group admins can also report

> "In addition to this, group admins can also report users who post spam in their groups."

**Source:** `faq-spam.html` — https://telegram.org/faq_spam#q-why-was-i-reported

**Implication for VouchVault:** A hostile user who sneaks in and gets admin (we do not give member admin) could weaponize this. Doctrine: only the operator account is admin in V4. Already enforced.

**Verdict:** aligned.

### 6.3. Appeals via @SpamBot

> "If you are sure that the limit was wrongfully applied to your account, please contact our @SpamBot."

**Source:** `faq-spam.html` — https://telegram.org/faq_spam#q-i-read-all-of-the-above-and-im-certain-that-i-didnt-break-any

**Implication for VouchVault:** Applies to *user accounts*, not bots. Bot bans go through @BotSupport / @BotNews channels (not formally documented in the canonical pages we captured). For owner-account flag remediation, @SpamBot is the entry point.

**Verdict:** aligned.

### 6.4. Cloud-chat content is subject to automated analysis

> "We may also use automated algorithms to analyze messages in cloud chats to stop spam and phishing."

**Source:** `privacy.html` §5.3 — https://telegram.org/privacy#5-3-spam-and-abuse

**Implication for VouchVault:** This is the **structural classifier** that took out V3. Member group messages and private DMs in cloud chats are scanned. The algorithm is opaque; the empirical signals are listed in `project_takedown_empirical_2026-04-27` (group title, bot name, supergroup status). This quote is the canonical license for that scanning — it's why "shape" matters more than per-message content.

**Verdict:** aligned (v9 doctrine treats this as the threat model).

### 6.5. Critical restrictions require a human moderator (DSA)

> "We will always favor the least restrictive measure possible to sustain a safe digital environment and decisively address malicious content. While certain limitations may be automatically imposed or lifted, any critical restrictions require approval from a human moderator."

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#how-we-moderate-content

**Implication for VouchVault:** A full bot/group/account ban (a "critical restriction") theoretically goes through a human review gate. V3's ban was therefore reviewed by a human, not just an algorithm. This is *small comfort* but it informs framing: appeals via formal channels are not facing pure automation.

**Verdict:** aligned (informs appeal posture, not architecture).

### 6.6. Notification-of-action commitment

> "Unless applicable law prevents us, we will notify you of any restrictions applied to your account and guide you on how to possibly remove them. Certain restrictions may be lifted automatically. If we made a mistake, we will lift or update your restriction and inform you accordingly."

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#what-action-we-can-take

**Implication for VouchVault:** If we get hit again, we should expect a notification (in-app or via @SpamBot). Don't infer a ban purely from "bot stopped working" — also confirm via @SpamBot / BotFather to distinguish enforcement from infrastructure failure.

**Verdict:** aligned.

---

## 7. Data retention

### 7.1. 12-month metadata window

> "To improve the security of your account, as well as to prevent spam, abuse, and other violations of our Terms of Service, we may collect metadata such as your IP address, devices and Telegram apps you've used, history of username changes, etc. If collected, this metadata can be kept for 12 months maximum."

**Source:** `privacy.html` §5.2 — https://telegram.org/privacy#5-2-safety-and-security

**Implication for VouchVault:** Telegram's retention of user metadata caps at 12 months. **This is what the owner is up against if Telegram tries to correlate the V3-owner account with a future operator account**: signals older than 12 months are gone (per policy). A new owner-account stood up *now* will, by 2027-04-29, no longer share metadata-history with any V3-era footprint. **Strategic implication:** the 12-month clock matters for any "fresh start" account hygiene.

**Verdict:** open question — anchors a potential operational decision (delay V4 → V1 transition by 12 months from V3 ban so owner-account metadata trail expires).

### 7.2. Bot developer retention obligations

> "Without limiting Sections 4 and 9, and except as expressly required by applicable law, Telegram imposes certain obligations regarding the degree to which you may continue to retain user data over time. You acknowledge and agree that failing to comply with any such obligation may lead to the immediate termination of your account, your TPA, or both. Namely, insofar as you are allowed to do so under applicable law, you must, without undue delay:
> (a) Delete user data upon their (or our, as the case may be) request that you do so;
> (b) Delete user data when retention thereof becomes unnecessary to operate your TPA or to fulfill any other obligation as the case may be and as expressly agreed between you and your users;
> (c) Delete all user data obtained through or in connection with Bot Platform upon the cessation of your TPA's operations therein, except for data that users have expressly agreed can be retained, which may be kept until such agreement remains in effect;
> (d) Delete all user data obtained through or in connection with Bot Platform in response to a lawful request from an authorized legal entity;"

**Source:** `tos-bot-developers.html` §4.2 — https://telegram.org/tos/bot-developers#4-2-data-storage-and-retention

**Implication for VouchVault:** We **must** support a user-deletion path. Today we have admin-driven freezing/redaction (`admin_audit_log`-backed) but no public "delete me" endpoint or DM command. Given the bot is private to a vetted community this hasn't been pressing, but if anyone challenges retention we are exposed unless we can delete on request promptly. Relevant entry points to spec:
- A `/forgetme` DM command, gated and auditable
- A documented operator SOP for handling out-of-band deletion requests
- §4.2(c) — when the bot is decommissioned, all DB content must be deleted unless explicitly retained by user agreement (we have no such agreement)

**Verdict:** gap — should land in `docs/runbook/opsec.md` as a documented SOP, plus a future `/forgetme` design.

### 7.3. Data scraping prohibition

> "You agree not to use your TPA to collect, store, aggregate or process data beyond what is essential for the operation of your services. Always prohibited uses include any form of data collection aimed at creating large datasets, machine learning models and AI products, such as scraping public group or channel contents."

**Source:** `tos-bot-developers.html` §4.3 — https://telegram.org/tos/bot-developers#4-3-data-scraping

**Implication for VouchVault:** Mirror to backup channel and DB-only legacy archive are both within "essential to operation" — they're for takedown resilience and lookup, not dataset construction. The phrasing "scraping public group or channel contents" specifically calls out *public* groups. V4 is private. Still: avoid framing the legacy archive as a "dataset" in any user-facing copy. Avoid cross-group surveillance features.

**Verdict:** aligned (current scope is operational, not dataset-construction).

### 7.4. Privacy policy is mandatory

> "all TPA must be bound by a privacy policy that is easily accessible to their users, detailing what data they store, how they collect it, and for what purpose."

**Source:** `tos-bot-developers.html` §4 — https://telegram.org/tos/bot-developers#4-privacy

> "If the Standard Policy does not properly detail the ways in which you collect, process and use personal data, or if your TPA provides services that are fully or partially incompatible with one or more of the stipulations therein, you must provide a separate privacy policy that is easily accessible to your users. In such cases, TPAs must set up a Privacy Policy in @BotFather"

**Source:** `tos-bot-developers.html` §4 — same

**Implication for VouchVault:** A reputation/vouch archive that retains member-authored content beyond pure messaging operation is *probably* outside the bounds of Telegram's [Standard Privacy Policy](https://telegram.org/privacy-tpa) (which is written for general bots). VouchVault therefore likely needs **its own privacy policy registered in @BotFather**. The current shipped state lacks one (no record in `docs/runbook/` of a published PP URL set in BotFather).

**Verdict:** gap — likely needs a short PP page + `setMyCommands`/BotFather privacy URL configuration. Add to launch checklist.

---

## 8. Group rights / admin permissions

### 8.1. ChatPermissions are the canonical default-rights surface

> "messages.editChatDefaultBannedRights can be used to modify the rights of all users in a channel, supergroup or basic group, to restrict them from doing certain things."

**Source:** `api-rights.html` — https://core.telegram.org/api/rights#default-rights

**Implication for VouchVault:** This is the MTProto method underlying what Bot API exposes as `setChatPermissions`. Default-banned-rights is how we lock down posting (see `docs/runbook/opsec.md` §18). Note `view_messages` cannot be defaulted-off — anyone who joins can read. That's why entry control (Request-to-Join) is the actual gate, not posting permissions.

**Verdict:** aligned.

### 8.2. Bot suggested admin rights

> "Bots can suggest a set of admin rights when being added to groups and channels."

**Source:** `api-rights.html` — https://core.telegram.org/api/rights#suggested-bot-rights

**Implication for VouchVault:** We can pre-populate admin rights via `bots.setBotGroupDefaultAdminRights` so the operator gets the right rights box pre-checked when adding the bot. Reduces "I forgot to grant `can_delete_messages`" launch-time errors. Currently we rely on `logBotAdminStatusForChats` boot warning (CLAUDE.md "Chat moderation"). This is a small UX upgrade for new-group launches.

**Verdict:** open question — minor improvement to consider.

---

## 9. Bot Developer ToS — explicit prohibitions

### 9.1. No spam / unsolicited messages

> "Your TPA must not harass or spam users with unsolicited messages;"

**Source:** `tos-bot-developers.html` §5.2(b) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** Bot does not initiate DMs to members it has not interacted with (the `chat_join_request` flow gives a 5-minute DM window, used; lookups are member-initiated). No outbound broadcast.

**Verdict:** aligned.

### 9.2. No impersonation

> "You and your TPA (including its name, username and branding) must not impersonate (both explicitly and implicitly or by association) Telegram or any entity which did not authorize you to represent them;"

**Source:** `tos-bot-developers.html` §5.2(c) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** Bot name/username should not impersonate other vouch communities or pretend to be official Telegram tooling. Relevant to the bot-name choice for V4 (`project_takedown_empirical_2026-04-27` — bot name was a classifier signal).

**Verdict:** aligned (and informs naming).

### 9.3. No misrepresentation; explicit forbidden categories

> "Your TPA (including its name, username and branding) must not misrepresent the services or functions it provides, including but not limited to misleading users into performing certain actions in the pursuit of an unachievable outcome. Without limiting the foregoing and by way of example, the following use cases are forbidden
> (i) MLM or ponzi schemes
> (ii) Social growth manipulation
> (iii) Deceptive practices to collect personal information (i.e., phishing scams)
> (iv) Asking users for their Telegram password or OTP
> (v) Misrepresenting an illegal product as legally purchasable."

**Source:** `tos-bot-developers.html` §5.2(d) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** None of (i)–(v) describe VouchVault. The relevant constraint for the owner's broader interests is (v) — "misrepresenting an illegal product as legally purchasable" — which directly applies to vouch-trading communities for regulated goods. The owner's scope-boundary memory (`project_vouchvault_scope_boundary.md`) requires verifying the legitimate-community framing.

**Verdict:** aligned with the bot itself; **the controlling factor is whether members themselves post (v) content**, which is a §5.1 (Content) responsibility — see §9.5 below.

### 9.4. No circumvention of rate limits or moderation

> "Your TPA must not attempt to circumvent or otherwise undermine Telegram rate limits and moderation. Without limiting the foregoing and by way of example, your TPA must not operate by proxy (i.e., using Bot API credentials supplied by other users) in an attempt to circumvent bans or content moderation."

**Source:** `tos-bot-developers.html` §5.2(f) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** Two implications:
1. Multi-bot architectures where bots share traffic to dodge per-bot limits are explicitly forbidden.
2. After a ban, we cannot stand up "the same bot under a new token" with the same operational shape; the language "circumvent bans or content moderation" suggests Telegram views identity continuity as the ban target, not the literal bot account.

**Verdict:** open question — anchors why a clean V4 launch should meaningfully differ from V3 (different bot, different name, different group title — already in `project_takedown_empirical_2026-04-27`).

### 9.5. Operator responsibility for member-uploaded content

> "The content hosted on your TPA must comply with the Telegram Terms of Service. You are responsible for any content uploaded by your TPA, including the moderation of user-generated content that is accessible via your TPA, and agree that Telegram may also intervene to moderate content hosted by your TPA, but is not obligated to do so."

**Source:** `tos-bot-developers.html` §5.1 — https://telegram.org/tos/bot-developers#5-1-content

**Implication for VouchVault:** **Operator (you) is responsible for moderating user-generated content "accessible via your TPA."** The mirror channel and the legacy DB archive both surface user-generated content via the bot. Lexicon moderation in V4 group is the active control; for the backup channel + legacy archive, content is not moderated at point of capture. This is a real obligation gap — though Telegram explicitly says it "may also intervene" (i.e., they can take it down but don't have to). In practice the lexicon module + admin freeze + replay-skip records cover the active-group surface.

**Verdict:** aligned for live group; gap for legacy archive (though risk is low because archive is DB-only, not exposed publicly).

### 9.6. No facilitating illegal goods

> "Your TPA must not be used to provide, link to, aggregate, host, index, distribute, lend out, exchange, trade, rent, sell or facilitate the sale of illegal, pirated, regulated or questionable goods and services."

**Source:** `tos-bot-developers.html` §5.2(h) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** This is the load-bearing clause for the scope-boundary doctrine. A reputation system *for* a community whose offerings would fall into this list is itself "facilitating." This is the line. Honour `project_vouchvault_scope_boundary.md`: confirm legitimate-community framing.

**Verdict:** aligned (operator awareness; not a code constraint).

### 9.7. No personal info / doxing facilitation

> "Your TPA must not upload, promote or facilitate the spread of violence, hate speech, harassment, violent threats, personal information or media belonging to unconsenting third parties and similar content."

**Source:** `tos-bot-developers.html` §5.2(i) — https://telegram.org/tos/bot-developers#5-2-operation

**Implication for VouchVault:** Vouches that publish a third-party's identifying info (real name, address, phone) without consent fall under "personal information … belonging to unconsenting third parties." The lexicon module currently focuses on hostile-actor speech, not PII. Worth a future audit of whether the legacy V3 archive contains entries that would be PII-violations under a strict read.

**Verdict:** open question — possible audit task for the legacy archive.

---

## 10. EU DSA obligations

### 10.1. Single point of contact for users

> "To contact Telegram, you can use @EURegulation bot. This bot accepts communications from users as a single point of contact under the Digital Services Act."

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#how-to-get-in-touch-with-telegram-as-a-user

**Implication for VouchVault:** This is the user-side contact, not a developer obligation. The corresponding *user-of-the-TPA* DSA contact is the operator (us). If a member ever cites DSA, we should know that for a plain user-to-Telegram channel, @EURegulation is the answer; we as an operator are *separately* responsible for being reachable.

**Verdict:** informational.

### 10.2. Sub-VLOP threshold (current size)

> "Some non-essential elements of the services provided by Telegram may qualify as 'online platforms' under the DSA. As of February 2026, these services had significantly fewer than 45 million average monthly active recipients in the EU over the preceding 6 months — which is below the threshold required for designation as a 'very large online platform.'"

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#average-monthly-active-recipients-of-service-in-the-eu

**Implication for VouchVault:** Telegram itself disclaims VLOP status. As a hosted bot we are several orders of magnitude smaller; the heaviest DSA obligations (statement of reasons, transparency reports, crisis protocols) are not triggered for us at our scale.

**Verdict:** aligned (not load-bearing at our scale).

### 10.3. Reporting illegal content requires identifiable submission

> "Note that if you report illegal content under the Digital Services Act, you will be prompted to include more details, including your name, contact information and a clear and convincing explanation why the content in question is illegal. We may have to dismiss your report if the information provided by you is insufficient to support it and may suspend the processing of your notices and complaints if you repeatedly submit manifestly unfounded, fraudulent or misleading reports."

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#how-to-report-illegal-content

**Implication for VouchVault:** Hostile actors trying to take down V4 via DSA reports must put their name on it. Anonymous mass-reporting through the DSA channel is not a frictionless attack. Still, this does not protect against in-app "Report spam" (§6.1) which is anonymous and the actual common-case threat vector.

**Verdict:** informational.

### 10.4. EU contact (corporate)

> "EU Member States' competent authorities (as defined in Article 49 of the Digital Services Act), the EU Commission and the European Board for Digital Services (the Board) who wish to contact Telegram under the Digital Services Act can obtain the necessary contact details from European Digital Services Representative (EDSR), Telegram's representative pursuant to Article 13 of the Digital Services Act, registered at Avenue Huart Hamoir 71, 1030 Brussels, Belgium. EDSR can be contacted by email at dsa.telegram@edsr.eu, by phone +32 2 216 19 71 or by post."

**Source:** `tos-eu-dsa.html` — https://telegram.org/tos/eu#legal-representative-under-article-13-of-the-digital-services-ac

**Implication for VouchVault:** Reference data only. Useful if Telegram's response to a future ban appears non-responsive — the DSA contact gives a formal escalation path that bypasses @SpamBot.

**Verdict:** informational.

---

## Summary — load-bearing architectural quotes (top 5)

1. **`forwardMessage` preserves `forward_origin`** (§4.1) — this is *the* reason v9's mirror works as takedown resilience. Any future move that loses `forward_origin` breaks the recovery story.
2. **Per-group 20 msgs/min** (§1.2) — anchors the v9 doctrine that the bot does not author content in the group, ever.
3. **Privacy mode is publicly visible** (§2.3) — every member can see "has access to messages" in the bot's row in the member list. Cannot be hidden. Constrains the identity-surface story.
4. **Bot ban → owner-account ban** (§5.1) — explicit collateral-ban authorization. The V3-owner account is exposed; future bots should be created by a different owner account.
5. **Cloud-chat content is subject to automated analysis** (§6.4) — license for the structural classifier that took out V3, which makes "shape" matter more than per-message content.

## Outstanding gaps to close

- **§5.1 / §7.1**: formalize owner-account isolation and write the 12-month expiration timing into `docs/runbook/opsec.md`.
- **§7.2**: draft a `/forgetme` DM command + operator deletion SOP.
- **§7.4**: register a VouchVault-specific privacy policy URL in @BotFather.
- **§4.3**: empirically test the replay tool's sustained-rate behaviour against a fresh test channel; document.
- **§9.7**: audit legacy V3 archive entries for unconsenting-third-party PII.
