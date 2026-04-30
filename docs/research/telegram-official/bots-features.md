---
source: https://core.telegram.org/bots/features
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. Bot platform feature guide — covers privacy mode, BotFather commands, monetization.
---

# Telegram Bot Features

## Overview

This documentation describes Telegram bot elements and capabilities in detail. The page covers inputs, interactions, integration options, monetization features, and bot management tools.

## Key Feature Categories

### Inputs
Bots accept multiple message types including text, files, locations, stickers, and voice messages. Interface tools include:

- **Commands**: Keywords prefixed with `/` (up to 32 characters using Latin letters, numbers, underscores)
- **Keyboards**: Custom reply keyboards with predefined options
- **Inline Keyboards**: Buttons appearing below messages supporting callbacks, URLs, and payments
- **Menu Button**: Opens command lists or Web Apps

Commands should be "as specific as possible" rather than generic options requiring additional parameters.

### Interactions

**Inline Mode**: Users activate bots via `@username` from any chat's message field, with results sent to the relevant conversation.

**Deep Linking**: Special links pass parameters to bots on startup. Private chats use the `start` parameter (up to 64 characters), while groups use `startgroup`. Parameters accept "A-Z, a-z, 0-9, _ and -" characters.

**Attachment Menu**: Approved bots gain direct access from users' attachment menus across chats.

### Integration Features

- **Mini Apps**: Custom JavaScript interfaces launching within Telegram with full-screen support, emoji status setting, media sharing, and geolocation access
- **Business Mode**: Enables bots to connect with Telegram Business accounts for client interaction management
- **Managed Bots**: Bots can create and manage other bots on behalf of users
- **Bot-to-Bot Communication**: Bots interact in groups via mentions or replies when communication mode is enabled
- **Payments**: Accept payments through third-party providers using Telegram Stars for digital goods
- **Web Login**: Widgets and inline login for website authentication
- **HTML5 Games**: Standalone gaming platforms with score tracking
- **Stickers**: Create, edit, and share sticker packs and custom emoji

### Monetization Options

- **Telegram Stars**: Digital currency for user-bot transactions
- **Digital Products**: Sell courses, artwork, and game items
- **Paid Media**: Unlock photos/videos after payment
- **Subscription Plans**: Multiple tiers of content and features
- **Ad Revenue Sharing**: "50%" of earnings from Telegram Ads displayed in bot chats

### Language Support

Bots receive user `language_code` with each update and should "adapt seamlessly" without user intervention. Bot names, descriptions, and command lists support native localization.

### Bot Management

**Privacy Mode**: Enabled by default. Bots in groups receive only relevant messages—commands directed to them, service messages, and replies. Group admins and disabled privacy mode receive all messages.

**Testing**: Create separate test bots via @BotFather without affecting production instances. A dedicated test environment supports HTTP links without TLS for Web Apps and login testing.

**Status Alerts**: @BotFather monitors response rates and sends alerts for abnormally low reply counts. Developers can mark issues fixed, contact support, or mute alerts.

**Local Bot API**: Self-hosted open-source API instance supporting unlimited file downloads, 2GB uploads, and custom webhook configurations.

## BotFather Commands

**Bot Creation/Management**:
- `/newbot` – Create new bot
- `/mybots` – List and edit bots
- `/token` – Generate new authentication token
- `/deletebot` – Delete bot and free username

**Profile Configuration**:
- `/setname`, `/setdescription`, `/setabouttext` – Update bot information
- `/setuserpic` – Change profile picture
- `/setcommands` – Define command list
- `/setdomain` – Link website domain

**Feature Toggles**:
- `/setinline` – Enable inline mode
- `/setjoingroups` – Allow group addition
- `/setprivacy` – Configure privacy mode
- `/newgame`, `/editgame`, `/deletegame` – Game management

## Important Requirements

Developers must implement "all developers" support for global commands (`/start`, `/help`, `/settings`) ensuring consistent user experience. Bot-to-bot communication requires "safeguards to ensure interactions terminate" to prevent infinite loops through deduplication, rate limits, and timeout enforcement.

For digital goods sales, "be sure to carry out the payment in Telegram Stars" by specifying XTR currency per third-party store policies.
