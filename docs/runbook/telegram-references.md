# Telegram API & ToS — canonical references for VouchVault

**Audience:** anyone touching `src/core/tools/telegramTools.ts`, `src/telegramBot.ts`, or `scripts/setTelegramWebhook.ts`. Before changing how the bot calls Telegram, verify against the snapshots in `docs/runbook/telegram-snapshots/` and the URLs below. The Bot API evolves; field names get deprecated; what worked 2 years ago may be wrong now.

**Two layers of canonical source:**

1. **Verbatim HTML snapshots** in `docs/runbook/telegram-snapshots/` — pulled directly via curl, untouched. Bytes-for-bytes Telegram. See `telegram-snapshots/README.md` for last-fetch date and refresh procedure.
2. **URLs + notes** below — the live versions, plus VouchVault-specific gotchas we've hit and want to remember.

If the snapshot and the live URL diverge, the live URL is current truth — refresh the snapshot.

---

## 1. Bot API — methods used by VouchVault

| Method | Doc | Notes / gotchas |
|---|---|---|
| `getMe` | <https://core.telegram.org/bots/api#getme> | Returns the bot's `User`. We cache `id` and `username` in `telegramTools.ts`. |
| `setWebhook` | <https://core.telegram.org/bots/api#setwebhook> | `allowed_updates` MUST include every update type the bot handles. Default omits some — explicit allowlist is mandatory. Currently: `message`, `edited_message`, `callback_query`, `my_chat_member`, `chat_member`. If you wire a new update type into `processTelegramUpdate`, also add it here AND re-run `npm run telegram:webhook`. |
| `getWebhookInfo` | <https://core.telegram.org/bots/api#getwebhookinfo> | Use the `--info` flag of `setTelegramWebhook` to inspect `allowed_updates`, pending update count, error stats. |
| `sendMessage` | <https://core.telegram.org/bots/api#sendmessage> | Supports `protect_content` (we set true on every published archive entry). `parse_mode` defaults to HTML in our wrapper. |
| `editMessageText` | <https://core.telegram.org/bots/api#editmessagetext> | Used for the in-place draft preview update. |
| `deleteMessage` | <https://core.telegram.org/bots/api#deletemessage> | Bot can delete its own messages always; deleting **member** messages requires admin with `can_delete_messages`. The chat-moderation handler relies on this; missing the permission silently fails. Boot-time admin-rights log surfaces it. |
| `answerCallbackQuery` | <https://core.telegram.org/bots/api#answercallbackquery> | Used at the end of every callback handler. |
| `restrictChatMember` | <https://core.telegram.org/bots/api#restrictchatmember> | Requires bot admin with `can_restrict_members`. **API ≥ 6.5 deprecated `can_send_media_messages`** in favour of granular fields (`can_send_audios`, `can_send_documents`, etc.). Our wrapper sets only `can_send_messages: false` — with `use_independent_chat_permissions` defaulting to false, this cascades to all granular send-permissions for a clean mute. `until_date` is Unix-seconds; mute < 30s or > 366d is treated as forever. |
| `banChatMember` | <https://core.telegram.org/bots/api#banchatmember> | Requires bot admin with `can_restrict_members`. Omit `until_date` for permanent. Reverse via `unbanChatMember`. |
| `unbanChatMember` | <https://core.telegram.org/bots/api#unbanchatmember> | Not currently used by code — admins unban manually via Telegram group settings. |
| `getChatMember` | <https://core.telegram.org/bots/api#getchatmember> | Used by the boot-time admin-rights check. Returns `ChatMember` (status: `creator` / `administrator` / `member` / `restricted` / `left` / `kicked`). |
| `setMyDescription` / `setMyShortDescription` / `setMyCommands` | <https://core.telegram.org/bots/api#setmydescription> et al. | Used by `scripts/configureTelegramOnboarding.ts`. |

### General API gotchas

- **Bot can't initiate DMs.** Telegram blocks `sendMessage` to a user who has never DM'd the bot (error `Forbidden: bot can't initiate conversation with a user`). We catch this with `safeSendDm` and treat warning DMs as best-effort. The welcome/pinned guide instructs members to `/start` the bot once.
- **Webhook allowed_updates is server-side state.** Updating the constant in `setTelegramWebhook.ts` does nothing until you re-run `npm run telegram:webhook`. Telegram remembers the last `allowed_updates` you set.
- **Rate limits.** Documented at <https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-s-subscribers-at-once>. Group messages: ~20/min sustained. Bursts above that get 429s — `withTelegramRetry` handles them by honouring `retry_after`.
- **Chat IDs are big.** Supergroup IDs are typically `-100…` followed by 13 digits. Always use `bigint`/`number` (Node `Number` is safe up to 2^53−1; chat IDs fit). Don't cast to int32.
- **Bot doesn't see its own posts via webhook** by default. Updates for messages the bot itself sent are not delivered. The chat-moderation `is_bot` + bot-id self-skip is belt-and-braces against malformed updates and inline-bot relays.
- **Forum topics.** Supergroups can have topics (`message_thread_id` on a message). All current methods (delete, restrict, ban) work transparently with topics.

### Update types

| Update type | Where handled | When delivered |
|---|---|---|
| `message` | `handleGroupMessage` / `handlePrivateMessage` | Any new message in any chat the bot is in. Filtered by `allowed_updates`. |
| `edited_message` | Inline `processTelegramUpdate` branch via `runChatModeration` | Any edit to a message in a chat the bot is in. Must be in `allowed_updates`. |
| `callback_query` | `handleCallbackQuery` | Inline keyboard taps. |
| `my_chat_member` | `handleMyChatMember` | Bot's own chat-member status changed (joined, kicked, demoted, etc.). |
| `chat_member` | `handleChatMember` | Other users' chat-member status changed. Requires `chat_member` in `allowed_updates`. |

### Update types we deliberately don't handle

- `channel_post`, `edited_channel_post` — VouchVault is in supergroups, not channels.
- `inline_query` — bot has no inline mode.
- `chosen_inline_result` — same.
- `shipping_query`, `pre_checkout_query` — bot doesn't take payments.
- `poll`, `poll_answer` — bot doesn't run polls.
- `chat_join_request` — request-to-join is admin-handled in Telegram itself.

---

## 2. Telegram Terms of Service & policy references

| Reference | URL | Relevance |
|---|---|---|
| Telegram ToS | <https://telegram.org/tos> | General platform terms. Every group/bot is bound by these. |
| Bot ToS | <https://telegram.org/tos/bot-developers> | Specific to bot developers. Anti-spam rules, prohibited bot behaviours. |
| Telegram moderation overview | <https://telegram.org/moderation> | High-level policy on what gets moderated. Categories: incitement to violence, CSAM, illegal goods. |
| Bot privacy mode | <https://core.telegram.org/bots/features#privacy-mode> | Bots default to privacy mode = only see commands and replies. We disable privacy via BotFather (`/setprivacy off`) so the bot sees all group messages — required for chat moderation. |
| Anti-spam guidelines | <https://core.telegram.org/bots/faq#what-can-i-do-about-broadcasting> | Explicit rules on bot-initiated DMs (forbidden) and rate limits. |

### Practical ToS compliance notes for VouchVault

- **No bot-initiated DMs.** Standard pattern: only DM users who have DM'd the bot first. Our warning DMs follow this — silent fail when the user hasn't initiated.
- **No mass DM to subscribers.** We never have. The freeze flow does NOT broadcast (deliberate per v1.1 spec).
- **Auto-deletion is fine.** Bots are explicitly permitted to delete messages where they have admin rights. Documented in moderation overview.
- **Auto-ban is fine** with the same admin-rights requirement.
- **The bot must not facilitate prohibited categories** (CSAM, violence, illegal goods). The chat moderation explicitly removes commerce-shape arrangements; the v1.1 vendetta-resistant posture removes public NEG vouches. Project posture per CLAUDE.md and `docs/runbook/opsec.md`.
- **Privacy mode off is required** for the bot to receive all group messages (not just commands). Set via BotFather. If a future Claude turns it back on by accident, chat moderation breaks silently.

### When in doubt

- Read the spec: <https://core.telegram.org/bots/api>
- Read the ToS: <https://telegram.org/tos> and <https://telegram.org/tos/bot-developers>
- Use BotFather's `/help` and per-bot settings (`/mybots → <bot> → Bot Settings`) to verify state.
- Use `npm run telegram:webhook -- --info` to check current `allowed_updates`.

This doc is the canonical first-stop reference. If a future change to a Telegram-touching file (`telegramTools.ts`, webhook setup, command setup) needs to make a decision, the answer is here or in the linked Telegram docs — not in someone's memory.
