---
source: https://core.telegram.org/api/rights
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. MTProto-side rights documentation — admin/banned/default rights, suggested bot admin rights.
---

# Admin, banned, default rights

## Overview

Telegram's channels and supergroups provide "granular permissions" for both admins and specific users, with global permission settings available across channels, supergroups, and basic groups.

## Admin Rights

The `channels.editAdmin` method modifies admin rights in channels or supergroups. Basic groups require `messages.editChatAdmin` instead. Admin permissions use the `chatAdminRights` constructor, with some rights applicable only to channels and others to both channels and supergroups.

## Banned Rights

The `channels.editBanned` method restricts user rights, bans, or removes users from channels or supergroups. Basic groups don't support granular individual user permissions—`messages.deleteChatUser` removes users entirely. Permissions derive from the `chatBannedRights` constructor.

## Default Rights

The `messages.editChatDefaultBannedRights` method applies restrictions to all users across channels, supergroups, or basic groups. Uses `chatBannedRights` constructor, with all flags available except `view_messages`.

## Suggested Bot Rights

Bots can suggest admin rights when added to groups and channels:

- `bots.setBotBroadcastDefaultAdminRights` suggests rights for channels
- `bots.setBotGroupDefaultAdminRights` suggests rights for groups

Suggested rights appear in the `bot_broadcast_admin_rights` and `bot_group_admin_rights` parameters of the `userFull` constructor. Client applications should fetch defaults, present them as editable options, then apply modifications before granting admin status. Bot deep link suggestions override these defaults but remain user-modifiable.
