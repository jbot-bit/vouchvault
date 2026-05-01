# ToS hardening — copy + data-deletion path

**Status:** in-flight (May 2026).
**Supersedes for spec-locked copy:** the v9 simplification design (2026-04-27) where it overlaps. v9's bot-as-tool architecture is unchanged; this spec adds disclosure surface and a `/forgetme` data-deletion path.

## Why

`docs/research/telegram-official-implications.md` flagged five compliance gaps. Two are user-facing copy:

1. No "I'm an automated tool" disclaimer in welcome / pinned guide / bot description.
2. No data-deletion path for members.

`docs/research/telegram-tos.md` and `tos-bot-developers.md` push for transparent identification, deletion path, and pointing reporters at `@notoscam` rather than ad-hoc routes.

`docs/research/tbc26-knowledge-base.md` warns against compliance-pageant theatre — survivors stay informal. Adds here are minimal, scoped, conversational.

## Spec changes

### 1. `rulesLine()` (welcome + pinned)

Append a fifth bullet:

```
• Report Telegram ToS violations to @notoscam — that's the official channel.
```

### 2. `buildWelcomeText` + `buildPinnedGuideText`

Insert two paragraphs near the top, after the heading:

```
I'm an automated lookup tool. Members post their own vouches in their own words — I never write vouches for anyone or DM members on my own.

Your data: usernames + the vouches mentioning you are stored for lookup. To request deletion, DM /forgetme.
```

### 3. `buildBotDescriptionText`

Append (within the 512-char Telegram cap):

```
Automated read-only tool — member-initiated only.
```

### 4. `buildModerationWarnText` (commerce branch)

```
Your message in <Group> was removed by automated moderation. To appeal, <admin pointer>.
```

The vouch-shape branch is unchanged.

## Data-deletion path

DM-only `/forgetme` command with two-step YES confirmation, 5-minute TTL, in-memory state.

Execute deletes (in FK-safe order):

1. `vouch_entries` where `reviewer_telegram_id = userId` OR `target_username = username`.
2. `vouch_drafts` where `reviewer_telegram_id = userId`.
3. `users_first_seen` where `telegram_id = userId`.
4. `users` where `telegram_id = userId`.

Audit row: `recordAdminAction({ command: '/forgetme', adminTelegramId: userId, adminUsername: username })`.

Mirror-log rows are deliberately retained — they do not contain message content (only message-id pointers) and the backup channel is the takedown-recovery substrate.

## Out of scope

- Privacy-policy URL — operator-hosted, pasted into `@BotFather`. Template at `docs/policies/privacy.md`.
- Lexicon edits.
- Any changes to publish path or moderation policy.

## Bytes

`buildBotDescriptionText` after change ≈ 446 chars (under the 512 cap).
