# Telegram Official Documentation Corpus

Verbatim captures of canonical Telegram documentation pages, used as ground-truth source material for VouchVault architecture decisions. Each file has YAML frontmatter recording source URL, capture date, and any caveats.

**Refresh policy:** re-fetch wholesale (do not selectively edit). When refreshing, update `captured:` in frontmatter and overwrite the body.

**Capture date:** 2026-04-29

## Files

### Terms of Service & policy
- [`tos-bot-developers.md`](./tos-bot-developers.md) — Bot Platform Developer ToS (sections 1–14: privacy, conduct, payments, blockchain, license, termination). https://telegram.org/tos/bot-developers
- [`tos-bots-users.md`](./tos-bots-users.md) — End-user ToS for the Bot Feature (TBF); SP/Telegram liability split. https://telegram.org/tos/bots
- [`tos-eu-dsa.md`](./tos-eu-dsa.md) — EU Digital Services Act guidance; prohibited content categories, moderation approach, EDSR contact. https://telegram.org/tos/eu-dsa
- [`privacy.md`](./privacy.md) — Telegram Privacy Policy summary (data collection, storage jurisdictions, deletion rights). https://telegram.org/privacy
- [`faq-spam.md`](./faq-spam.md) — User-facing spam FAQ; @SpamBot appeal flow and limitation behavior. https://telegram.org/faq_spam

### Bot platform reference (HTTP Bot API)
- [`bots-overview.md`](./bots-overview.md) — Top-level "Bots: An introduction for developers" page; capability survey + how-bots-work. https://core.telegram.org/bots
- [`bots-features.md`](./bots-features.md) — Detailed feature guide; privacy mode, BotFather commands, monetization, language support. https://core.telegram.org/bots/features
- [`bots-faq.md`](./bots-faq.md) — Bot developer FAQ; privacy-mode message visibility rules, webhook ports, message rate limits (1/sec chat, 20/min group, 30/sec bulk). https://core.telegram.org/bots/faq
- [`bots-webhooks.md`](./bots-webhooks.md) — "Marvin's Marvellous Guide to All Things Webhook"; TLS 1.2+, ports 443/80/88/8443, IP ranges 149.154.160.0/20 + 91.108.4.0/22, setWebhook curl examples. https://core.telegram.org/bots/webhooks
- [`bots-api.md`](./bots-api.md) — Bot API reference. **TRUNCATED** — WebFetch summarized; per-method parameter tables not captured. Use https://core.telegram.org/bots/api for definitive method/type signatures. https://core.telegram.org/bots/api

### MTProto-side reference (lower level, not used by Bot API but useful for context)
- [`api-rights.md`](./api-rights.md) — Admin/banned/default rights; chatAdminRights, chatBannedRights, suggested bot admin rights. https://core.telegram.org/api/rights
- [`api-bots.md`](./api-bots.md) — MTProto bot login + capability list; auth.importBotAuthorization. https://core.telegram.org/api/bots

## Notes on capture

Each page exists in **two forms** in this directory:

- `<page>.md` — readable AI-converted markdown summary (faithful but not byte-for-byte verbatim).
- `raw/<page>.html` — raw HTML pulled via `curl`. **This is the canonical byte-faithful capture.** Use this when exact wording matters (legal questions, ToS quoting, method-signature lookup).

When citing in architecture decisions, prefer the `.html` for exact wording; use the `.md` for readability. If the two disagree, the HTML wins.

### File pairings

| Topic | Readable | Canonical | Source URL |
|---|---|---|---|
| Bot Developer ToS | `tos-bot-developers.md` | `raw/tos-bot-developers.html` | https://telegram.org/tos/bot-developers |
| Bot Users ToS | `tos-bots-users.md` | `raw/tos-bots-users.html` | https://telegram.org/tos/bots |
| EU DSA guidance | `tos-eu-dsa.md` | `raw/tos-eu-dsa.html` | https://telegram.org/tos/eu-dsa |
| Privacy Policy | `privacy.md` | `raw/privacy.html` | https://telegram.org/privacy |
| Spam FAQ | `faq-spam.md` | `raw/faq-spam.html` | https://telegram.org/faq_spam |
| Bot overview | `bots-overview.md` | `raw/bots-overview.html` | https://core.telegram.org/bots |
| Bot features | `bots-features.md` | `raw/bots-features.html` | https://core.telegram.org/bots/features |
| Bot FAQ | `bots-faq.md` | `raw/bots-faq.html` | https://core.telegram.org/bots/faq |
| Webhooks guide | `bots-webhooks.md` | `raw/bots-webhooks.html` | https://core.telegram.org/bots/webhooks |
| Bot API reference | `bots-api.md` (summary only) | `raw/bots-api.html` (~700 KB, **definitive**) | https://core.telegram.org/bots/api |
| MTProto admin rights | `api-rights.md` | `raw/api-rights.html` | https://core.telegram.org/api/rights |
| MTProto bot login | `api-bots.md` | `raw/api-bots.html` | https://core.telegram.org/api/bots |

### Refresh policy

To refresh: re-run `curl` to overwrite `raw/<page>.html`, then re-run WebFetch (or read the HTML and re-summarize) to update the `.md`. Do not selectively edit individual paragraphs — replace wholesale. Update `captured:` in frontmatter on refresh.
