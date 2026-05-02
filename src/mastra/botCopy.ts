/**
 * All user-facing bot text lives here. Edit the strings, save, restart the bot.
 * Nothing in this file affects logic — it is purely what users read.
 *
 * Telegram limits:
 *   description       max 512 chars   (shown on the bot's profile page)
 *   shortDescription  max 120 chars   (shown in chat list / share previews)
 */

export const BOT_COPY = {
  // Bot profile page. Seen before a user starts the bot.
  description:
    "Post vouches to the group through a short DM form. Lawful marketplace use only.",

  // Bot share preview / chat list blurb.
  shortDescription: "Vouch archive bot. Open from the group, submit in DM.",

  // First DM the user sees after /start.
  welcome: [
    "How it works:",
    "1. Tap the launcher in the group.",
    "2. Send the target @username here.",
    "3. Pick a result and tags.",
    "4. I post the entry to the group.",
    "",
    "Lawful marketplace use only. No ToS violations.",
  ].join("\n"),

  // Group message that holds the "Open Vouch Flow" button.
  launcher: "Need to post a vouch? Tap below to open the DM form.",

  // Pinned post in the group explaining the workflow.
  pinnedGuide: [
    "How to use this group:",
    "1. Tap Open Vouch Flow.",
    "2. DM me the target @username, then use the buttons.",
    "3. I post the entry back here.",
    "",
    "Legal marketplace. No ToS violations.",
  ].join("\n"),

  // Brief reply shown in-group when someone taps the launcher.
  groupLauncherReply: "Tap below to open the DM form.",

  // Reply when a non-admin tries an admin-only command.
  adminOnly: "Admin only.",

  // Short in-group ack after a vouch list (lookup/recent) was DM'd to the caller.
  dmSent: "Sent to your DMs.",

  // In-group reply when we couldn't DM the caller (they haven't opened the bot yet).
  dmStartBotFirst: "Open the bot in DM first, then run the command again.",

  // Label on the button that deep-links into the bot DM from the group.
  openBotButton: "Open Bot",

  // Result emoji used in /lookup and /recent output. Edit if you want different ones.
  resultEmoji: {
    positive: "🟢",
    mixed: "🟡",
    negative: "🔴",
  },
};
