---
source: https://core.telegram.org/bots
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. Top-level bot platform introduction — links to features, API, tutorial.
---

# Bots: An introduction for developers

## Navigation
- [Twitter](https://twitter.com/telegram)
- [Home](//telegram.org/)
- [FAQ](//telegram.org/faq)
- [Apps](//telegram.org/apps)
- [API](/api)
- [Protocol](/mtproto)
- [Schema](/schema)

## Overview

Bots are "small applications that run entirely within the Telegram app" with flexible interfaces supporting various tasks and services. The Telegram Bot Platform hosts over 10 million bots and is free for users and developers.

Key resources:
- [Detailed Guide to Bot Features](/bots/features)
- [Full API Reference for Developers](/bots/api)
- [Basic Tutorial: From @BotFather to 'Hello World'](/bots/tutorial)

## What Can You Do with Bots?

- Replace Entire Websites
- Natively Integrate AI Chatbots
- Manage Your Business
- Receive Payments
- Create Custom Tools
- Integrate with Services and Devices
- Host Games
- Build Social Networks
- Monetize Your Service
- Promote Your Project
- Anything Else

### Replace Entire Websites
Telegram bots support Mini Apps built with JavaScript, offering "infinitely flexible interfaces" for online stores and games. They include seamless authorization and notifications through Telegram.

Example: [@DurgerKingBot](https://t.me/durgerkingbot)

### Natively Integrate AI Chatbots
Bots support threaded conversations for managing multiple topics in parallel, useful for AI chatbots. They can "stream live responses as they're generated" instead of waiting for full replies.

Enable topics via [@BotFather](https://t.me/botfather) with Threaded Mode.

**Note:** This feature requires an additional fee for Telegram Star purchases per Terms of Service Section 6.2.6.

### Manage Your Business
Telegram Business users can connect bots to "process and answer messages on their behalf" via personal accounts, enabling seamless integration of existing tools and workflows or adding AI assistants for increased productivity.

Enable Business Mode in [@BotFather](https://t.me/BotFather) for compatible bots.

### Receive Payments
Bots can sell goods and services globally using Telegram Stars for "digital products via in-app purchases." Physical products integrate with "third-party providers that support integration with Mini Apps."

Examples: [@ShopBot](https://t.me/shopbot)

Guides available for:
- [Digital products](https://core.telegram.org/bots/payments-stars)
- [Physical products](https://core.telegram.org/bots/payments)

### Create Custom Tools
Build bots for specific tasks like converting files, managing chats, or fetching weather forecasts. Users can interact directly or add them to groups and channels for extra features.

Mini apps can generate media and files for sharing to other chats or as stories.

### Integrate with Services and Devices
Mini apps "seamlessly integrate with third-party services, APIs and devices" to process and update information—like changing emoji status or hailing rides.

By default, Mini Apps integrate with Android and iOS, allowing users to add direct home screen shortcuts.

Popular official bots: [@GMailBot](https://t.me/gmailbot), [@GitHubBot](https://t.me/githubbot), [@Bing](https://t.me/bing), [@YouTube](https://t.me/youtube), [@wiki](https://t.me/wiki)

### Host Games
Developers can create lightweight HTML5 games and immersive full-screen modern games with detailed motion controls, location-based points of interest, and dynamic hardware optimizations.

Examples: [@Gamee](https://t.me/gamee) library

Resources:
- [HTML5 Games](/bots/games)
- [Mini App Games](/bots/webapps)

### Build Social Networks
Bots connect users based on shared interests and location to coordinate meetups, showcase local services, or facilitate second-hand sales.

Users can place direct home screen shortcuts for one-tap access.

### Monetize Your Service
Telegram provides "multiple revenue streams" including:
- Revenue Sharing from Telegram Ads
- Subscription plans
- Paid content and digital products via Telegram Stars

Telegram Stars can be used to increase message limits, send gifts to users, or accept rewards in Toncoin.

### Promote Your Project
Bots can host affiliate marketing programs offering "a transparent way to quickly scale with organic growth from user referrals."

Affiliate Programs support custom revenue sharing rates and variable commission periods.

Learn more in the [dedicated guide](https://telegram.org/tour/affiliate-programs).

### Anything Else
Possibilities are endless from simple scripts to complex mini apps. All Mini Apps are "highly customizable to fit your brand identity," including uploading high-quality media demos and custom Loading Screens with your logo and colors.

---

## How Do Bots Work?

For detailed explanation, see [Bot Features guide](/bots/features).

Telegram bots are special accounts not requiring phone numbers. Connected to owner servers, they process inputs from users. "Telegram's intermediary server handles all encryption and communication with the Telegram API." Developers use an "easy HTTPS-interface with a simplified version of the Telegram API" called the [Bot API](/bots/api).

### How Are Bots Different from Users?

Bots process inputs differently than user accounts:

- No 'last seen' or online statuses—show 'bot' label instead
- Limited cloud storage; older messages may be removed shortly after processing
- Cannot initiate conversations; users must add them to groups or message first
- By default, bots in groups "only see relevant messages" ([Privacy Mode](/bots/features#privacy-mode))
- Never eat, sleep, or complain (unless programmed otherwise)

### Bot Links

Bot usernames typically require a 'bot' suffix, but some exceptions exist: [@stickers](https://t.me/stickers), [@gif](https://t.me/gif), [@wiki](https://t.me/wiki), [@bing](https://t.me/bing).

Anyone can assign collectible usernames to bots, including those without the 'bot' suffix.

---

## How Do I Create a Bot?

Creating Telegram bots requires at least some computer programming skills. The Bot API streamlines creation with necessary tools and framework.

To start, message [@BotFather](https://t.me/botfather) to register and receive an authentication token.

**Important:** Your bot token is its unique identifier—store it securely and share only with those needing direct access. "Everyone who has your token will have full control over your bot."

### What Next?

Recommended resources:
- [Detailed Guide to Bot Features](/bots/features)
- [Full API Reference for Developers](/bots/api)
- [Basic Tutorial: From @BotFather to 'Hello World'](/bots/tutorial)
- [Code Examples](/bots/samples)

---

## Footer Information

### Telegram
A cloud-based mobile and desktop messaging app emphasizing security and speed.

### About
- [FAQ](//telegram.org/faq)
- [Privacy](//telegram.org/privacy)
- [Press](//telegram.org/press)

### Mobile Apps
- [iPhone/iPad](//telegram.org/dl/ios)
- [Android](//telegram.org/android)
- [Mobile Web](//telegram.org/dl/web)

### Desktop Apps
- [PC/Mac/Linux](//desktop.telegram.org/)
- [macOS](//macos.telegram.org/)
- [Web-browser](//telegram.org/dl/web)

### Platform
- [API](/api)
- [Translations](//translations.telegram.org/)
- [Instant View](//instantview.telegram.org/)

### Additional
- [Blog](//telegram.org/blog)
- [Press](//telegram.org/press)
- [Moderation](//telegram.org/moderation)
