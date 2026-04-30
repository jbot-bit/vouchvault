---
source: https://core.telegram.org/api/bots
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. MTProto-API bot reference (different from Bot API HTTP wrapper).
---

# Bots

Working with bots using the MTProto API.

## Login

```
auth.importBotAuthorization#67a3ff2c flags:int api_id:int api_hash:string bot_auth_token:string = auth.Authorization;
```

To authenticate as a bot, provide the bot token from [@botfather](https://t.me/botfather) instead of following the standard login flow. You still need an API ID. After authorization, bots can access "most MTProto API methods" just like regular users.

## Features

- **Edit bot information** – Customize profile picture, name, about text, and descriptions
- **Commands** – Set commands for private or group chats
- **Buttons** – Enable user interaction through buttons and inline buttons
- **Menu button** – Configure menu button behavior
- **Suggested bot admin rights** – Propose admin permissions when added to groups/channels
- **Inline queries** – Allow users to interact via text input field in any chat
- **Games** – Offer HTML5 games for solo or competitive play
- **Web apps** – Provide interactive HTML5 applications
- **Affiliate programs** – Enable content creators and developers to earn commissions
- **Attachment menu** – Install convenient web app entries
- **Business bots** – Connect bots to handle messages on behalf of businesses
- **Bot API dialog IDs** – Convert between MTProto peer IDs and bot API formats
- **Third-party verification** – Assign verification icons to prevent scams
