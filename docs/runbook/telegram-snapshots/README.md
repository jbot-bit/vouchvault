# Telegram canonical-source snapshots

Raw HTML pulled directly from Telegram, untouched. **These are not summaries** — they are the bytes Telegram served at the fetch timestamp below. Future Claude sessions and human reviewers should `grep` / open these in a browser when they need ground truth on Telegram API or ToS, not reason from memory.

## Fetched 2026-04-26

| File | Source URL | Size | SHA-256 |
|---|---|---|---|
| `telegram-tos.html` | <https://telegram.org/tos> | 25K | `943b552c15f66541d686c7a256f25e861e50608d3ba90d61f26af5bbc6810383` |
| `telegram-bot-developers-tos.html` | <https://telegram.org/tos/bot-developers> | 66K | `92344864949952d9fa6f3c061ff3dd31e3acd5e2c8c2d7c76c516ee8a82b086f` |
| `telegram-moderation.html` | <https://telegram.org/moderation> | 145K | `ed407b83740602937b3e03990789dd214b2b313e18751e4bd7e01f7b59d25b6a` |
| `telegram-bot-api.html` | <https://core.telegram.org/bots/api> | 679K | `a5436e749081eda659339f0e619087226aa7881b4018cb08e1b00461f37dc2de` |
| `telegram-bot-faq.html` | <https://core.telegram.org/bots/faq> | 19K | `4e02fd7ba621a518c2efde8fd9bfd93631bbdc9b6a77526aa72c5dfeb2491182` |
| `telegram-bot-features.html` | <https://core.telegram.org/bots/features> | 83K | `6b0eb6fb71061d7cfd5ed7cfe3a40d9a92e811bcad4d571aeee26f878ce297fe` |

## How to use

```
# Read a method spec verbatim (open in browser):
start docs/runbook/telegram-snapshots/telegram-bot-api.html
# or via Linux/Mac:
xdg-open docs/runbook/telegram-snapshots/telegram-bot-api.html

# Grep for a specific method:
grep -A 30 'restrictChatMember' docs/runbook/telegram-snapshots/telegram-bot-api.html | head -60

# Check ToS for a specific term:
grep -B 2 -A 5 -i 'spam' docs/runbook/telegram-snapshots/telegram-tos.html
```

## How to refresh

Re-pull when:
- Telegram announces a Bot API version bump (watch <https://t.me/botnews>).
- Working on Telegram-touching code and the existing snapshot looks outdated against current observed API behaviour.
- Quarterly, as a cadence.

```bash
cd docs/runbook/telegram-snapshots
curl -fsSL --max-time 30 "https://telegram.org/tos" -o telegram-tos.html
curl -fsSL --max-time 30 "https://telegram.org/tos/bot-developers" -o telegram-bot-developers-tos.html
curl -fsSL --max-time 30 "https://telegram.org/moderation" -o telegram-moderation.html
curl -fsSL --max-time 60 "https://core.telegram.org/bots/api" -o telegram-bot-api.html
curl -fsSL --max-time 30 "https://core.telegram.org/bots/faq" -o telegram-bot-faq.html
curl -fsSL --max-time 30 "https://core.telegram.org/bots/features" -o telegram-bot-features.html

# Update SHAs in this README:
for f in *.html; do sha256sum "$f"; done
```

After refresh, update the "Fetched" date and SHA column, then commit. Diff the new HTML against the previous version (`git diff HEAD~1 -- docs/runbook/telegram-snapshots/`) to see what Telegram actually changed — hugely useful for tracking deprecations and new features.

## Why this exists

These snapshots solve the "future Claude session reasons from memory and gets it wrong" problem. The class of issue caught during chat-moderation v4 implementation:

- `can_send_media_messages` was deprecated; my memory said the field still works — actual API doc shows it's still listed but with a note. Snapshot lets future sessions confirm.
- `edited_message` was missing from `allowed_updates` in `setTelegramWebhook.ts`; my memory thought the default included it. Actual Bot API doc confirms it must be explicit.

Pull the snapshot, search for the method/field, get the truth. No more reasoning from training data that may be 18 months stale.
