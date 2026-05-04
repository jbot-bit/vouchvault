# SC45 launch stack — buy-not-build

The minimum viable operational stack. Off-the-shelf bots cover ~90% of admin tooling; your custom SC45 bot only handles the irreducibles (legacy archive lookup, takedown-mirror, custom lexicon, data deletion).

Modelled on Balf's TBC26 stack (KB:F9.2 / F9.4 / F1.4): Group Help + clones + auto-forwarder + native Telegram features + 1–2 thin custom DM bots.

## Bot roster

| Bot | Purpose | Add as admin? | Notes |
|---|---|---|---|
| **`@GroupHelpBot`** (or a clone) | Welcome msgs, captcha, anti-spam, **admin log topic**, join request handling, blacklist | Yes — `can_delete_messages`, `can_restrict_members` | Free tier covers welcomes/captcha/anti-spam/log topic. Pro adds blacklist sync + extended `/info`. Configure via DM `/config` |
| **`@GateShieldBot`** | Removes deleted/ghost accounts | Yes — `can_restrict_members` | Set-and-forget. No DM config needed |
| **`@SangMata_beta_bot`** | Username/display-name history lookup (admin-only vetting tool) | **No** — DM use only | Daily quota on free tier; fallback `@userinfo3bot` if exhausted |
| **Your custom SC45 bot** | `/search`, `/policy`, `/forgetme`, v9 mirror, custom lexicon | Yes — `can_delete_messages`, privacy-mode OFF | Only the irreducibles. Set-and-forget once running |

Optional adds (don't need for launch):
- **`@username_to_id_bot`** — DM-only ID lookup
- **A second Group Help clone** as a redundancy layer (Balf runs `@GHClone5Bot` so if the main bot is suspended the clone takes over)

## Group settings (Telegram-native, no bot involved)

1. **Group Type:** Private. No public @username, no t.me/sc45 link.
2. **Join method:** Request to Join enabled.
3. **Verify question** (group settings → invite links → request settings):
   ```
   Who in the group referred you? Reply with their @ and a sentence about how you know them.
   ```
   This is what Telegram shows the prospective member before they can submit the request. It's free intake — no bot needed.
4. **Member permissions:** strip `change_info`, `pin_messages`, `invite_users`. Members can `send_messages` only.
5. **Slow mode:** 10–30 seconds.
6. **Forwarding & saving:** disable "save content" if you want a non-screenshottable group.

## Topics

Pin order (top-to-bottom, max 5 pinned):

1. **General** (forced).
2. **Vouches** — main vouch posting.
3. **Admin Log** — Group Help posts join/leave/ban/mod events here.
4. **Chat** — off-topic, keeps Vouches clean for native search.

Configure Group Help to log to "Admin Log" via DM:
```
/config@GroupHelpBot
→ Logs → enable → topic: Admin Log
```

## Joining flow (no link in the wild)

Three paths in priority order:

1. **Direct add (preferred).** Existing member tells admin "X knows me, can you add Y?". Admin opens group → Members → Add → searches @Y → adds. No link minted. System message in Admin Log topic auto-records it via Group Help.
2. **One-shot link via DM.** Target's privacy settings block direct-add, or admin doesn't have them as contact. Admin runs `npm run invite:new` to mint a one-shot link, DMs it directly to target. Target requests-to-join, admin approves. Link auto-revokes after one use; usage stamped in `invite_links` table.
3. **Self-request via verify question.** Prospective member somehow finds the group (a member shared a request-to-join link). They submit the request with the verify-question answer. Admin reviews their answer + runs `@SangMata_beta_bot` for username history, decides.

Members never have invite rights — they ask an admin.

## What your custom bot does (and only this)

After launch, the SC45 bot's responsibilities collapse to:

- **`/search` / `/lookup` (alias) `@username`** — query legacy V3 archive (DB-only). Case-insensitive at both layers.
- **`/policy`, `/privacy`, `/tos`** — return policy text in DM.
- **`/forgetme`** — two-step YES, deletes vouches you authored + your account record.
- **v9 mirror** — every group message → backup channel via `forwardMessage`. Idempotent via `mirror_log`.
- **Custom lexicon moderation** — deletes commercial-shape posts that Group Help's generic anti-spam misses. Boot log shows admin-rights status.
- **Admin commands** — `/freeze`, `/unfreeze`, `/frozen_list`, `/remove_entry`, `/pause`, `/unpause`, `/admin_help`. Audit-logged.

Set-and-forget once deployed. No new features needed for ongoing operation.

## Launch checklist

- [ ] Custom SC45 bot deployed (Railway), `/healthz` + `/readyz` green.
- [ ] `npm run bootstrap` pushed name + descriptions to BotFather (env: `BOT_DESCRIPTION`, `BOT_SHORT_DESCRIPTION` if overriding the defaults from `archive.ts`).
- [ ] `npm run telegram:webhook` re-pushed `allowed_updates`.
- [ ] SC45 bot added to group, admin with `can_delete_messages`. Boot log confirms admin status.
- [ ] Group Help added, configured (welcome / captcha / anti-spam / log topic).
- [ ] GateShieldBot added.
- [ ] SangMata in admin DMs (personal, not in group).
- [ ] Topics created + pinned in order.
- [ ] Group set Private + Request-to-Join + verify question filled.
- [ ] Member permissions stripped to `send_messages` only.
- [ ] Pinned guide message posted (output of `buildPinnedGuideText()` — DM SC45 bot `/start`, copy, post + pin).
- [ ] Pinned policy message posted (DM `/policy`, copy, post + pin in General).
- [ ] First admin direct-adds — verified shows up in Admin Log topic via Group Help.
- [ ] Smoke test `/search @somerealmember` from a member account, both `@SOMEONE` and `@someone` casings → resolves.
- [ ] Smoke test `/forgetme` on a throwaway account → confirmation prompt → YES → deletion confirmed; vouches authored ABOUT the throwaway by other members stay.
- [ ] Smoke test commercial-shape post → auto-removed → DM warn arrives with "removed by automated moderation" wording.
- [ ] Smoke test normal vouch post → not removed → mirror_log row written → backup channel shows the forwarded message.
- [ ] BotFather `/setinline` → enable inline mode → set placeholder to `@username` (e.g. `@bobbiz`). Smoke test by typing `@<bot> @somerealmember` in any chat — a single result with the trust headline must appear within ~1s. Inline mode is read-only + member-scope (NEG counts never surfaced); same 5s/user rate limit as DM /search.

## Recovery

If group is taken down:

1. Spin up fresh private group. Add the bot stack (Group Help / GateShield / SangMata).
2. Update `TELEGRAM_ALLOWED_CHAT_IDS`, redeploy, re-bootstrap, re-set webhook.
3. `npm run replay:to-telegram` — replays backup channel into new group via `forwardMessages`. Throttled, idempotent via `replay_log`.
4. Re-pin guide + policy in new group.

Full recovery procedure: `docs/runbook/opsec.md` + `DEPLOY.md` §9–10.
