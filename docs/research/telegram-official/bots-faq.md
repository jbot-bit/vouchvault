---
source: https://core.telegram.org/bots/faq
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. Bot developer FAQ — privacy mode rules, webhook ports, message rate limits.
---

# Bots FAQ

## General Questions

#### How do I create a bot?

Telegram bot creation requires programming skills. You must register with [@BotFather](https://telegram.me/botfather) and connect your bot to a backend server using the Bot API.

#### Where can I find code examples?

Two sample bots are available:
- **Hello Bot** - demonstrates basic Bot API functionality
- **Simple Poll bot** - a more complete example supporting long-polling and webhooks

The community maintains additional bot samples at the samples page.

#### Will you add features to the Bot API?

The team evaluates feature requests based on how developers use bots. Share ideas with [@BotSupport](https://telegram.me/botsupport).

#### What messages will my bot receive?

**All bots receive:**
- Service messages
- Messages from private chats
- Messages from channels where they're members

**Bot admins and non-privacy-mode bots receive:** All messages except from other bots

**Privacy-mode enabled bots receive:**
- Commands explicitly meant for them
- General commands if they last messaged the group
- Messages sent via the bot
- Replies to messages meant for them

#### Why can't my bot see messages from other bots?

"Bots talking to each other could potentially get stuck in unwelcome loops." This restriction prevents automated loops between bots.

---

## Getting Updates

#### How do I get updates?

Two methods exist: **long polling** or **webhooks**. You cannot use both simultaneously.

#### Long polling returns duplicate updates—why?

Use the `offset` parameter set to `update_id of last processed update + 1` to confirm updates and prevent duplicates.

#### I'm having webhook problems

Requirements include:
- Valid SSL certificate
- For self-signed certificates: upload public key via `certificate` parameter as InputFile
- Supported ports: **443, 80, 88, 8443**
- CN must exactly match your domain
- No wildcard certificates or redirects

Consult the webhook guide for additional details.

#### How can I verify webhook requests come from Telegram?

Use a secret path in your URL (e.g., `www.example.com/your_token`) since only Telegram knows your bot's token.

#### How do I make requests in response to updates?

With webhooks, you have two options:

1. POST to `https://api.telegram.org/bot<token>/method`
2. Reply directly with the method as JSON payload

---

## Handling Media

#### How do I download files?

Use the `getFile` method. Maximum file size: **20 MB**

#### How do I upload large files?

Bots can send files up to **50 MB**. Larger files aren't currently supported.

#### Are file_ids persistent?

Yes, file_ids can be treated as persistent identifiers.

---

## Broadcasting to Users

#### My bot is hitting limits—how do I avoid them?

Message rate limits:
- Single chat: maximum one message per second
- Group: maximum 20 messages per minute
- Bulk notifications: approximately 30 messages per second

#### How can I message all subscribers at once?

Enabling paid broadcasts via [@BotFather](https://t.me/botfather) allows up to **1000 messages per second**. Requirements:
- Minimum 100,000 Stars balance
- Minimum 100,000 monthly active users
- Cost: **0.1 Stars per message** above the free 30/second tier

---

**Contact [@BotSupport](https://telegram.me/botsupport) for additional questions.**
