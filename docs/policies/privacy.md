# Privacy policy — SC45 bot

_Template only. Current runbook posture is to keep policy disclosure inside Telegram via `/policy` and a pinned group copy, not a public BotFather URL._

## Who we are

Community-run Telegram bot for member-to-member vouches. Automated read-only lookup/moderation tool; members write vouches in their own words. Operated on a volunteer basis; no commercial entity.

## What we store

- Telegram `user_id`, `username`, and first/last name for members who interact with the bot.
- Vouch entries posted in the host group: timestamp, reviewer username, target username, message body, tags.
- Operational metadata: webhook update IDs (deduplication), audit log of admin actions, mirror log linking each group message to its backup-channel forward, invite-link usage.

We do not store message content from any chat outside the configured host group(s).
The bot does not write vouches for members and does not initiate unsolicited DMs.

## How we use it

- Lookup by `@username` — members and admins query the archive via DM.
- Backup-channel mirror — every member-posted message in the host group is forwarded to a private backup channel for takedown resilience.
- Audit — admin actions (freeze, remove_entry, etc.) are logged for accountability.

We do not sell, rent, or share data with third parties. We do not run analytics on member data.

## Retention

Records persist until deletion is requested or the bot is decommissioned. Webhook deduplication rows are pruned after 14 days.

## Deletion

DM the bot `/forgetme` and reply `YES` to confirm. This permanently deletes:

- every vouch entry where you are the reviewer,
- your draft state,
- your first-seen timestamp,
- your stored profile.

Vouches written about you by other reviewers stay because they are the reviewer's words, not your bot account data.
Messages mirrored to the backup channel before your deletion request are not automatically removed from Telegram's servers; contact the operator if you need those redacted.

## Telegram's own policies

This bot operates on Telegram and is bound by Telegram's terms. Read these:

- Telegram Terms of Service — <https://telegram.org/tos>
- Telegram Privacy Policy — <https://telegram.org/privacy>
- Telegram Bot Terms for users — <https://telegram.org/tos/bots>
- Telegram Bot Platform Developer Terms — <https://telegram.org/tos/bot-developers>
- Telegram Moderation Overview — <https://telegram.org/moderation>

## Reporting abuse

Use Telegram's native reporting UI (long-press the message → Report) for ToS violations. Operator contact for bot-specific concerns: _[insert contact handle]_.

## Changes

This policy may change. Material changes will be announced in the host group.

_Last updated: 2026-05-01._
