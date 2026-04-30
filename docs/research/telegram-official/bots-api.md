---
source: https://core.telegram.org/bots/api
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: TRUNCATED. The Bot API reference is enormous (every method + every type). WebFetch returned a summarized capture covering: HTTP transport, response format, getUpdates/setWebhook surface, core types (User, Chat, Message, Poll, Update), recent Bot API 9.6 changes (Apr 3 2026), Local Bot API server, and high-level messaging features. Per-method parameter tables, the full type catalog (InlineKeyboardMarkup, InputMedia*, ChatPermissions, etc.), and method-by-method signatures are NOT captured here — refer to the live page at https://core.telegram.org/bots/api for those. For VouchVault specifically, see also docs/runbook/telegram-references.md (project-local index of methods actually used).
---

# Telegram Bot API Documentation

## Overview

The Telegram Bot API is "an HTTP-based interface created for developers keen on building bots for Telegram." Developers must authenticate using unique tokens and make HTTPS requests to `https://api.telegram.org/bot<token>/METHOD_NAME`.

## Request Methods

The API supports **GET** and **POST** HTTP methods with four parameter-passing mechanisms:
- URL query strings
- application/x-www-form-urlencoded
- application/json (except file uploads)
- multipart/form-data (for file uploads)

## Response Format

All responses contain a JSON object with:
- **ok** (Boolean): indicates success
- **result**: contains query results on success
- **description** (String, optional): human-readable explanation
- **error_code** (Integer, optional): error identifier

## Getting Updates

Two mutually exclusive approaches exist:

### getUpdates Method
Uses long polling to receive [Update](#update) objects. Parameters include:
- **offset** (Integer): identifier of first update to retrieve
- **limit** (Integer): 1-100 updates (default: 100)
- **timeout** (Integer): long polling duration in seconds
- **allowed_updates** (Array): filter update types

### Webhooks (setWebhook)
Sends HTTPS POST requests to specified URLs containing serialized updates. Configuration includes:
- **url**: HTTPS endpoint for updates
- **certificate** (InputFile): public key certificate
- **max_connections**: 1-100 simultaneous connections (default: 40)
- **secret_token**: 1-256 character verification header value

## Core Types

### User
Represents Telegram users or bots with fields:
- **id**: unique identifier (up to 52 significant bits)
- **is_bot**: Boolean flag
- **first_name**, **last_name** (optional)
- **username**, **language_code** (optional)
- **is_premium**: "True if this user is a Telegram Premium user"
- **can_manage_bots** (optional): bot management capability

### Chat
Represents chat entities with:
- **id**: unique identifier
- **type**: "private", "group", "supergroup", or "channel"
- **title**, **username** (optional)
- **is_forum**: "True if the supergroup chat is a forum"

### Message
Core message object containing:
- **message_id**: unique identifier
- **from** (User, optional): sender information
- **chat**: associated chat
- **date**: Unix timestamp
- **text** (optional): message content
- **entities**: special elements (URLs, mentions, commands)
- **reply_to_message** (optional): replied-to message
- **poll**, **location**, **venue** (optional): specific content types

### Poll
"This object contains information about a poll" with:
- **id**: unique identifier
- **question**, **options**: poll content
- **type**: "regular" or "quiz"
- **allows_multiple_answers**: Boolean
- **correct_option_ids** (optional): quiz answers
- **description** (optional): poll description
- **allows_revoting**: Boolean for answer changes

### Update
Represents incoming updates with:
- **update_id**: unique identifier
- **message**, **edited_message** (optional)
- **callback_query**, **poll_answer** (optional)
- **chat_member**, **my_chat_member** (optional)
- **managed_bot** (optional): managed bot updates

## Recent API Changes (April 3, 2026 - Bot API 9.6)

### Managed Bots
- Added **can_manage_bots** field to User class
- New **KeyboardButtonRequestManagedBot** class for button requests
- Added **ManagedBotCreated** and **ManagedBotUpdated** classes
- New methods: **getManagedBotToken**, **replaceManagedBotToken**

### Poll Enhancements
- Support for "quizzes with multiple correct answers"
- Replaced **correct_option_id** with **correct_option_ids**
- Added **allows_revoting** field
- New parameters: **shuffle_options**, **allow_adding_options**, **hide_results_until_closes**
- Added **description** and **description_entities** fields
- **PollOption** now includes **persistent_id**, **added_by_user**, **added_by_chat**, **addition_date**

### Checklist & Task Features
- Service message types: **PollOptionAdded**, **PollOptionDeleted**
- **reply_to_poll_option_id** field in Message
- Support for "date_time" entities in various contexts

## Local Bot API Server

Source code available at [telegram-bot-api](https://github.com/tdlib/telegram-bot-api) enables:
- Unlimited file downloads
- 2000 MB file uploads
- Local file path uploads
- HTTP webhook URLs
- Higher connection limits (up to 100,000)
- Absolute local file paths in responses

## Key Messaging Features

**Formatting**: Supports bold, italic, underline, strikethrough, spoilers, blockquotes, and code formatting through MessageEntity types and parse modes.

**Rich Content**: Messages support text, photos, audio, documents, videos, stickers, animations, polls, checklists, locations, venues, contacts, and games.

**Replies**: "For replies in the same chat and message thread, the original message" appears in the reply_to_message field.

**Reactions**: Message reactions and reaction counts tracked through MessageReactionUpdated and MessageReactionCountUpdated updates.
