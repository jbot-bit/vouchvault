# Policies — local mirror + bot surface

Local copies of every policy this bot is bound by, plus the bot-side surface that links to them.

## Local copies (verbatim, do not edit)

| File | Source |
| --- | --- |
| `../research/telegram-tos.md` | <https://telegram.org/tos> + `/moderation` + `/privacy` (captured 2026-04-29) |
| `../research/telegram-official/privacy.md` | <https://telegram.org/privacy> verbatim |
| `../research/telegram-official/bots-overview.md` | <https://core.telegram.org/bots> verbatim |
| `../research/telegram-official/bots-faq.md` | <https://core.telegram.org/bots/faq> verbatim |
| `../research/telegram-official/api-bots.md` | <https://core.telegram.org/api/bots> verbatim |
| `privacy.md` | This bot's privacy policy template — operator hosts it, pastes URL into BotFather |

Refresh by re-fetching wholesale (don't selectively edit).

## Bot surface

**No public-URL surface, by design.** A hosted policy page would be search-indexed, third-party-trackable, and just another classifier-visible link tied to the group identity. We surface the policy in-Telegram only.

- DM `/policy`, `/privacy`, or `/tos` — returns `buildPolicyText()` (see `src/core/archive.ts`). Self-contained: lists what's stored, the deletion path, links to Telegram's ToS / Privacy / Bot Terms (their canonical URLs, not ours), and `@notoscam` for abuse reports.
- DM `/forgetme` — two-step YES confirmation, then deletes vouches the user authored + their account record. Vouches written ABOUT them by other reviewers stay (see "scope" below).
- Welcome + pinned guide point at `/policy` and `/forgetme`.
- Bot description (BotFather profile) carries `Automated read-only tool — member-initiated only.` plus the compact rules line.
- Pin a copy of the policy as a group message — admins can `/policy` in DM, copy the response, post + pin it in the group as a permanent in-Telegram artefact.

## Scope of `/forgetme`

Reviewer-side only. Deletes `vouch_entries` where `reviewer_telegram_id = user`, plus `vouch_drafts`, `users_first_seen`, and `users` rows for that user. **Does not** delete vouches written ABOUT the user by other reviewers — those are the reviewers' words, and removing them would let bad actors wipe negative feedback about themselves and weaponise the bot to launder reputations. That's a community-trust failure and a "complicit bot" report vector that has historically driven takedowns.

`mirror_log` rows are also retained — they hold message-id pointers, not content; the backup channel is the takedown-recovery substrate.

## Operator runbook — privacy-policy URL in BotFather

We **do not** set a privacy-policy URL in BotFather. A public URL adds an external surface (search-indexed, classifier-visible, third-party-trackable) tied to the group identity. The DM `/policy` command + a pinned policy message in the group cover the disclosure surface without leaking outside Telegram.

If a future BotFather change makes the privacy-policy URL field mandatory, point it at a `t.me/<groupname>/<pinned_msg_id>` deep link — that keeps the surface in-Telegram.

## Reporting abuse

`@notoscam` — Telegram's official ToS-violation channel. Surfaced in welcome, pinned guide, and `/policy`.
