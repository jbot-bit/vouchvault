# VouchVault v9.1 — GroupHelp moderation (option-3, deferred from v8.1)

**Date:** 2026-04-27
**Status:** spec, not yet implemented. **Blocked on operator pre-conditions** in `docs/runbook/opsec.md` §22.4.
**Supersedes:** v8.1 moderation decision (deferred for TBC test which is now cancelled).
**Builds on:** v9 simplification (`docs/superpowers/specs/2026-04-27-vouchvault-v9-simplification-design.md`).
**Grounded in:** KB:F2.1 (TBC's GroupHelp + clones), opsec §19 (privacy posture), v9-shipped memory entry.

---

## §1 Why

v9 shrunk the bot's surface to: search (`/lookup`), admin commands, chat moderation lexicon, backup mirror. The lexicon is the only feature still requiring privacy-OFF (mirror also needs message visibility, but if we move moderation off-bot, both reasons disappear simultaneously — see §3).

TBC runs `@GroupHelpBot` and clones (`@GHClone5Bot`, `@TBC_grouphelp_bot`) for word/phrase moderation. KB:F2.1 confirms the pattern. Privacy-ON ingest bot + privacy-ON GroupHelp moderation = TBC's exact moderation posture. Operator (this session) confirmed GroupHelp is safe across multiple groups.

Replacing the on-bot lexicon with GroupHelp:
- Drops `src/core/chatModeration.ts` (orchestration) + `src/core/chatModerationLexicon.ts` (PHRASES + REGEX_PATTERNS) — about 400 LOC.
- Lets us drop `message` + `edited_message` from `allowed_updates` (only `callback_query`, `my_chat_member`, `chat_member`, `chat_join_request` remain).
- Lets us flip BotFather `/setprivacy` → ENABLE for the ingest bot.
- Bot's only group-side function becomes the v9 mirror — but mirror also needs message visibility. So we either keep privacy-OFF for mirror, or move mirror off-bot too.

§3 covers the mirror tension explicitly. Two options inside §3.

---

## §2 Pre-conditions (operator, not code)

Before any of the §3 code changes, the operator must complete:

1. **Add GroupHelp** (or a clone — `@GHClone5Bot` is verified-running per KB:F2.1; `@TBC_grouphelp_bot` is the latest TBC variant) to the host group as an admin with **Delete messages** + **Ban users** permissions.
2. **Configure GroupHelp filters** to match the current lexicon coverage. Use `/config@<grouphelpbot>` in DM. Translate `src/core/chatModerationLexicon.ts:PHRASES` and `REGEX_PATTERNS` into GroupHelp's word/phrase rules. Most are direct (substring + case-insensitive); regex patterns may need GroupHelp's regex feature enabled.
3. **Observe for ≥ 7 days** with both GroupHelp AND VouchVault's lexicon active. Cross-check `admin_audit_log` rows tagged `chat_moderation:delete` against GroupHelp's deletion log (visible in GroupHelp's per-group dashboard). If GroupHelp catches everything VouchVault's lexicon does, proceed. If GroupHelp misses a category, expand its rules first; do not proceed until parity.
4. **Operator decision recorded** in opsec §20.5 audit log: `2026-MM-DD §22.4 GroupHelp parity confirmed; v9.1 ready to ship`.

If any pre-condition fails, the v9.1 code change does not ship. The lexicon stays.

---

## §3 What ships in v9.1 code

### §3.1 Moderation removal

Delete:
- `src/core/chatModeration.ts` (orchestration: `runChatModeration`, `logBotAdminStatusForChats`).
- `src/core/chatModerationLexicon.ts` (PHRASES, REGEX_PATTERNS, `findHits`, `normalize`).
- `src/core/chatModeration.test.ts`, `src/core/chatModerationLexicon.test.ts`.

Modify:
- `src/telegramBot.ts`: remove `runChatModeration` import + call sites in `handleGroupMessage` and `processTelegramUpdate`'s `edited_message` branch. Remove `moderationDeleted` plumbing in `maybeMirrorToBackupChannel` (it's a constant `false` after this change).
- `src/server.ts`: remove `logBotAdminStatusForChats` boot helper call.
- `src/core/archive.ts`: remove `buildModerationWarnText` (its only caller is gone).
- `package.json` `test` script: drop the two deleted test files.

### §3.2 Privacy-mode flip

- BotFather: `@<ingest-bot>` → `/setprivacy` → **Enable**. The bot now only sees `/cmd@bot` and explicit @mentions in groups; DMs are unaffected.
- `scripts/setTelegramWebhook.ts`: drop `"message"` and `"edited_message"` from `allowed_updates`. Resulting list: `["callback_query", "my_chat_member", "chat_member", "chat_join_request"]`.
- `npm run telegram:webhook` to apply.

### §3.3 Mirror tension — two options

The v9 mirror needs full message visibility to forward member posts. Privacy-ON breaks this: bot would only see commands, mirror produces ~zero forwards.

**Option A (recommended): keep privacy-OFF, but for mirror only.**
- Reverts §3.2: leave `message` in `allowed_updates`, leave BotFather privacy DISABLED.
- We still drop `edited_message` (no moderation = no edit re-scan); shrinks scope by one update type.
- Bot identity surface narrows materially (no moderation, no DM wizard, no templated publish — only mirror + lookup + admin), even if privacy stays OFF.
- TBC asymmetry remains but the underlying-feature justification is mirror, not moderation.

**Option B: drop privacy-OFF entirely; sacrifice the mirror.**
- Privacy-ON ingest bot. Cannot mirror. Backup channel becomes operator-curated only (operator manually forwards, the way TBC's anonymous-admins curate per KB:F2.5).
- Higher operator load; not viable solo.
- Closer to TBC posture but loses the v9 takedown-recovery automation.

**Default: Option A.** Mirror is load-bearing for takedown recovery; we don't sacrifice it to chase privacy-ON parity. Document the asymmetry in opsec §19 as "mirror is the sole reason for privacy-OFF post-v9.1; moderation is now off-bot."

If owner explicitly approves Option B (accepting operator curation load), revisit at that point.

### §3.4 Documentation updates

- `opsec.md` §19: rationale list updates — moderation reason removed, mirror is the sole reason for privacy-OFF (assuming Option A).
- `opsec.md` §20.5 audit log: add a 2026-MM-DD entry recording v9.1 deployment.
- `CLAUDE.md`: drop chat moderation section (or rewrite as "moderation is off-bot via GroupHelp; see opsec §22.4").
- `DEPLOY.md` Step 11: update privacy-mode rationale to mirror-only (Option A) or remove if Option B.
- `DEPLOY.md` Step 14: rewrite as "verify GroupHelp moderation in test group" instead of the deleted lexicon e2e checklist.

---

## §4 Risk assessment

| Risk | Mitigation |
|---|---|
| GroupHelp misses lexicon hits VouchVault would have caught | §2.3 requires ≥7-day parity observation before ship |
| GroupHelp itself triggers a takedown | Operator-confirmed safe across multiple groups (2026-04-27); risk is observed-low. Fallback: re-enable on-bot lexicon (revert PR). |
| GroupHelp privacy posture changes | Periodic check: KB re-export every quarter (per memory). If TBC abandons GroupHelp, investigate why before our pivot decisions. |
| Mirror still needs privacy-OFF (Option A) | Documented asymmetry in opsec §19; identity surface still smaller than v9 because moderation is gone. |
| Lexicon expertise lost (deleted module) | Lexicon is preserved in git history; reviving is `git revert` away. Tests in deleted files document the rules. |

---

## §5 Implementation order

1. Operator: complete §2 pre-conditions over ≥7 days.
2. Code branch: `feat/v9.1-grouphelp-moderation`.
3. Commit 1: §3.1 deletions + test wiring.
4. Commit 2: §3.4 documentation updates (opsec, CLAUDE.md, DEPLOY.md).
5. PR + CI green + merge.
6. Operator: §3.2 BotFather flip + `npm run telegram:webhook`. Verify boot log + test moderation in test group.
7. Owner records §20.5 audit-log entry.

Each step reversible: the on-bot lexicon code is in git; reverting the merge restores moderation; webhook update is one command. No DB migration in v9.1 — no schema change.

---

## §6 Decisions locked

- §3.3 default: **Option A** (privacy-OFF for mirror; moderation goes to GroupHelp; lexicon deleted).
- §2 pre-conditions are mandatory; ship blocked on them.

---

## §7 Open questions for operator

- Vanilla GroupHelp (`@GroupHelpBot`) or a clone (`@GHClone5Bot`, `@TBC_grouphelp_bot`)? KB:F2.1 has all three; clones are functionally equivalent. Default: vanilla — fewest unknowns.
- Donation/quota tier — GroupHelp's free tier covers most communities; revisit if rate limits surface.
