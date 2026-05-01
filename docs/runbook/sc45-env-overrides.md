# SC45 — env-driven copy overrides

Change bot copy without touching code. Set the env var in Railway, save, redeploy. Done.

All overrides accept HTML (`<b>`, `<i>`, `<u>`, `<code>`, `<a href="...">...</a>`) and `\n` for line breaks. Empty / unset / whitespace-only → falls back to the default in `src/core/archive.ts`.

## Available overrides

| Env var | What it controls | Default | Notes |
|---|---|---|---|
| `BOT_DISPLAY_NAME` | Bot's display name shown in Telegram | `SC45` | Max 64 chars. Telegram rate-limits name changes — use sparingly |
| `BOT_DESCRIPTION` | Long description shown when opening the bot's profile | `buildBotDescriptionText()` | Max 512 chars |
| `BOT_SHORT_DESCRIPTION` | One-line description shown above the start screen | `buildBotShortDescription()` | Max 120 chars |
| `BOT_WELCOME_TEXT` | First message body when a user DMs `/start` | spec-locked default | Rules block auto-appended after — don't include rules here |
| `BOT_PINNED_GUIDE_TEXT` | Pinned guide body (different verbiage from welcome — uses "this group" instead of "the group") | spec-locked default | Rules block auto-appended after |
| `BOT_RULES_TEXT` | The Rules block at the bottom of welcome + pinned guide | 4-bullet ToS block | Replaces the entire `<b>Rules</b>` block |

## Format

Multi-line via `\n` (literal backslash-n). Railway's variable input also accepts real line breaks if you paste them.

Example `BOT_WELCOME_TEXT`:
```
<b>SC45</b>\n\n🔍 <code>/search @username</code>\n📄 <code>/policy</code>\n🗑 <code>/forgetme</code>\n\nPost vouches in the group. Tag the @, say what happened.
```

That renders as:
```
SC45

🔍 /search @username
📄 /policy
🗑 /forgetme

Post vouches in the group. Tag the @, say what happened.
```

## Workflow

1. Edit the env var in Railway → bot service → Variables.
2. Save. Railway auto-redeploys.
3. DM `/start` to the bot to verify the new welcome.
4. To revert: delete the env var (or set it empty). Bot falls back to the spec-locked default in code.

## What's NOT env-overridable (and why)

- `/policy` text — security-sensitive copy that lists what's stored + the deletion path. Keep it locked in code so an env-edit can't accidentally drop the deletion-pointer or the abuse channel.
- `/forgetme` confirmation prompt — same rationale.
- Moderation-warn text — needs to remain plain so it doesn't leak group identity to a takedown reporter.
- Rules block COULD be overridden via `BOT_RULES_TEXT` but be careful: keep the `@notoscam` line for ToS-compliance posture.

## See also

- `docs/runbook/sc45-setup.md` — full pre-launch checklist
- `docs/runbook/sc45-launch-stack.md` — buy-not-build operational catalogue
- `scripts/bootstrap.ts` — where bot name + description envs are read
- `src/core/archive.ts` — where welcome / pinned / rules envs are read
