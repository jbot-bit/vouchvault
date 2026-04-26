# VouchVault — Surface entry ID on published post

**Status:** v1
**Date:** 2026-04-26
**Builds on:** `2026-04-25-vouchvault-redesign-design.md` (V3)

## 0. One-paragraph summary

The published group post does not currently surface the entry's numeric ID, even though the ID already exists in the database and is the reference token used by every existing admin command (`/remove_entry <id>`, `/lookup`, `/profile`, `/recent`). Combined with `protect_content`-style group settings that block forwarding, this leaves community members with no way to point an admin at a specific entry they want to flag, dispute, or ask about. This spec adds a small bottom-line `#<id>` to the published post format so users can copy/paste the entry reference into a DM. No behaviour change, no schema change, no admin command change.

## 1. Context: ledger semantics

VouchVault is a ledger, not an editable wall. A reviewer cannot edit or delete their own entry once the bot publishes it. Only an admin can remove an entry, via `/remove_entry <id>`. This is intentional product policy:

- Reviewers can't strategically delete a negative after the target makes it right (or pays them off, or threatens them).
- The vouch record stays trustworthy because the data is append-only.
- Honest typos / wrong-target / wrong-verdict mistakes go through the admin path.

The friction point this spec addresses is not deletion. It is **identification**. When a community member wants to flag an entry to an admin (genuine typo, dispute, perceived abuse), they currently have no clean way to say *which* entry. Forwarding a single message is blocked by the group's `protect_content` posture; quoting requires the user to retype the post; describing the entry by date+reviewer is ambiguous when the same reviewer has multiple entries.

## 2. Goals & non-goals

### Goals

- Make every published post carry its numeric entry ID in a visible, copyable form.
- Use the same `#<id>` convention already shipped by `/lookup`, `/profile`, `/recent` so the system speaks one reference dialect.
- Keep the visual footprint as small as possible — the ID is a service token, not an editorial element.

### Non-goals

- **Reviewer self-service deletion / amendment.** Out of scope. Ledger remains immutable to the reviewer.
- **Permanence warning copy in welcome / preview.** Considered and explicitly rejected — the support burden of confused users is treated as a filter rather than something to fix with copy.
- **Linkifying the ID** (e.g. deep-linking `#42` back to the original message). Out of scope; deep links already exist for the reviewer's own confirmation message and the broader linkifying question is its own UX call.
- **Rendering the ID on the in-DM preview.** The preview is for the reviewer; the ID is a post-publish reference. Adding it pre-publish would just be visual noise.

### Success criteria

- A community member who wants to report an entry can long-press / tap the ID on the published post, get it copied to clipboard, and paste it into a DM to an admin in two interactions.
- The published post stays under one screen-height on a phone (current footprint is ~3 lines + 1 line for legacy `Date:`; this spec adds 1 line, total ≤ 5 lines).
- `/remove_entry <id>` keeps working unchanged with the IDs displayed.

## 3. The change

### 3.1 Live entries

Current published format (V3, post-`854aa89` / `7502a15`):

```
<b>POS Vouch &gt; @target</b>
<b>From:</b> <b>@reviewer</b>
<b>Tags:</b> Good Comms, On Time
```

After this spec:

```
<b>POS Vouch &gt; @target</b>
<b>From:</b> <b>@reviewer</b>
<b>Tags:</b> Good Comms, On Time
<code>#42</code>
```

### 3.2 Legacy entries

Legacy entries already render an extra `Date:` line beneath the tags. The ID line goes after the date:

```
<b>NEG Vouch &gt; @oldvendor</b>
<b>From:</b> <b>@legacyop</b>
<b>Tags:</b> Poor Comms
<b>Date:</b> 02/11/2025
<code>#7</code>
```

### 3.3 Why `<code>` not `<i>` not bold

`<code>` renders in monospaced font in Telegram and — crucially — it's **tap-to-copy on iOS, long-press-to-copy on Android**. That's the entire UX point of surfacing the ID: the user copies it without selecting text. Bold or italic would render the ID, but the user would have to text-select it manually.

### 3.4 Where in the codebase

- `buildArchiveEntryText` in `src/core/archive.ts` is the single rendering function for both live and legacy entries.
- It already accepts `entryId: number` as input but does not currently include it in the output.
- The change is to append one line: `<code>#${input.entryId}</code>`.
- No call-site changes — the entry ID is already being passed in.

### 3.5 Preview (in-DM) and "Posted to the group" confirmation

`buildPreviewText` and `buildPublishedDraftText` do **not** include the ID:

- The preview runs *before* publish — the entry doesn't have an ID yet (or the ID would change if cancelled and resubmitted). Showing a placeholder is misleading.
- The published-draft confirmation already has a "View this entry" deep link button as the primary action; surfacing the numeric ID here is redundant.

The ID appears **only** on the post that lands in the group — the canonical, referenceable artifact.

## 4. Test plan

| File | What it asserts |
|---|---|
| `src/core/archiveUx.test.ts` (existing, extend) | `buildArchiveEntryText` for a live entry includes a final `<code>#42</code>` line; for a legacy entry it includes the same line *after* the `Date:` line. |
| `src/core/formattingCeiling.test.ts` (existing) | Should keep passing — adding ~10 chars per entry doesn't push any list rendering past the 4096-char ceiling. (Verify by running, no new test needed.) |

No DB changes, no migration, no new test file.

## 5. Migration & rollout

- **Existing entries:** the ID has always been in the DB. Re-rendering is a no-op for past entries (we don't edit historical Telegram posts), and any future `/lookup` / `/profile` output that *re-renders* an old entry will gain the new line automatically. No backfill.
- **Spec-locked text:** `buildArchiveEntryText` is documented in `CLAUDE.md` under "Group post format". This spec amendment authorises the locked-format change. The CLAUDE.md section needs a one-line update reflecting the new bottom line.
- **No deploy ordering.** Drop-in change; once it ships, every new published post carries the ID.

## 6. Out of scope (explicit rejections)

- Permanence warning copy on the preview step (rejected per ledger philosophy).
- Reviewer-side retract / amend flow (rejected: deletion-after-resolution is the abuse pattern this product is designed to *prevent*).
- Tappable ID-as-deep-link to the original message (deferred — separate UX call about whether IDs should navigate or just identify).
- Surface the ID on the in-DM preview or the post-publish confirmation (rejected: those are reviewer-facing, the ID is a post-publish reference).

## 7. Open questions

None at spec time. Implementation is mechanical.
