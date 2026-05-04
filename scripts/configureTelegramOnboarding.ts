import process from "node:process";

import {
  buildBotDescriptionText,
  buildBotShortDescription,
  buildPinnedGuideText,
} from "../src/core/archive.ts";

type BotCommand = {
  command: string;
  description: string;
};

type CliOptions = {
  dryRun: boolean;
  guideChatId: number | null;
  pinGuide: boolean;
  botUsername: string | null;
};

// User-facing slash-popup menu. Admin commands (/freeze, /unfreeze,
// /frozen_list, /remove_entry, /recover_entry, /pause, /unpause,
// /admin_help, /teach, /untrain, /learned, /reviewq, /dbstats,
// /mirrorstats, /modstats) keep working when typed; intentionally kept
// off the BotFather popup so the visible surface stays small. Admins
// run /admin_help in DM for the full reference.
//
// v9 commands: members write vouches as plain group messages, the bot
// is read-only lookup. Old wizard-era /cancel + "vouch flow" copy is
// gone; /search is the primary surface.
const DEFAULT_COMMANDS: BotCommand[] = [
  { command: "search", description: "Look up vouches on @user" },
  { command: "help", description: "How this bot works" },
];

const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "start", description: "Welcome + commands list" },
  { command: "search", description: "Look up vouches on @user" },
  { command: "me", description: "Your own vouch summary" },
  { command: "forgetme", description: "Wipe vouches you wrote + your bot record" },
  { command: "policy", description: "What's stored + Telegram rules" },
  { command: "help", description: "How this bot works" },
];

const GROUP_COMMANDS: BotCommand[] = [
  { command: "search", description: "Look up vouches on @user (reply lands in DM)" },
  { command: "help", description: "How this bot works" },
];

const ADMIN_COMMANDS: BotCommand[] = [];

function printUsage() {
  console.info(
    [
      "Usage:",
      "  configureTelegramOnboarding [--dry-run] [--guide-chat-id <id>] [--pin-guide] [--bot-username <username>]",
      "",
      "Notes:",
      "  TELEGRAM_BOT_TOKEN is required unless you only use --dry-run.",
      "  If --guide-chat-id is supplied, the script will post the pinned guide with the launcher button.",
      "  --pin-guide only applies when --guide-chat-id is provided.",
      "  BOT_DISPLAY_NAME (env) overrides the BotFather display name (default: 'Vouch Hub').",
      "",
      "Manual @BotFather steps the script can NOT do (do these once via @BotFather):",
      "  /setinline       — enable inline mode (welcome '🔍 Search someone' button uses it)",
      "  /setjoingroups   — enable group-add (so the bot can be added to the host group)",
      "  /setprivacy      — DISABLE privacy mode (mirror + lexicon need all messages)",
      "  Privacy Policy   — set the bot's privacy URL once docs/policies/privacy.md is hosted",
    ].join("\n"),
  );
}

function parseNumberFlag(value: string | undefined, flagName: string): number {
  if (!value || !/^-?\d+$/.test(value)) {
    throw new Error(`${flagName} requires an integer value.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flagName} must be a safe integer.`);
  }

  return parsed;
}

function parseStringFlag(value: string | undefined, flagName: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} requires a value.`);
  }

  return value;
}

function parseCliArguments(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let dryRun = false;
  let guideChatId: number | null = null;
  let pinGuide = false;
  let botUsername: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--pin-guide") {
      pinGuide = true;
      continue;
    }

    if (arg === "--guide-chat-id") {
      guideChatId = parseNumberFlag(argv[index + 1], "--guide-chat-id");
      index += 1;
      continue;
    }

    if (arg === "--bot-username") {
      botUsername = parseStringFlag(argv[index + 1], "--bot-username").replace(/^@+/, "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return {
    dryRun,
    guideChatId,
    pinGuide,
    botUsername,
  };
}

async function callTelegramAPI(method: string, payload: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error calling ${method}: ${result.description}`);
  }

  return result.result;
}

async function resolveBotUsername(explicitUsername: string | null): Promise<string> {
  if (explicitUsername) {
    return explicitUsername;
  }

  if (process.env.TELEGRAM_BOT_USERNAME) {
    return process.env.TELEGRAM_BOT_USERNAME.replace(/^@+/, "");
  }

  const me = await callTelegramAPI("getMe", {});
  if (typeof me?.username !== "string" || me.username.length === 0) {
    throw new Error("Could not resolve the bot username.");
  }

  return me.username.replace(/^@+/, "");
}

// v9: members post vouches as plain group messages; there's no DM
// wizard launcher anymore. Pinned-guide button (when --guide-chat-id is
// passed) deep-links to /search instead — it's the primary user-facing
// surface and the "Look someone up" affordance most newbies want.
function buildSearchLauncherUrl(botUsername: string): string {
  return `https://t.me/${botUsername}`;
}

async function setCommands(scope: Record<string, unknown> | null, commands: BotCommand[]) {
  const payload: Record<string, unknown> = {
    commands,
  };

  if (scope) {
    payload.scope = scope;
  }

  await callTelegramAPI("setMyCommands", payload);
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const description = buildBotDescriptionText();
  const shortDescription = buildBotShortDescription();

  // BotFather display name. Defaults to a generic "Vouch Hub" so the
  // bot's identity surface doesn't read as community-coded (research
  // §2.3 + classifier-targeting empirics). Override per deployment via
  // env when needed.
  const botName = process.env.BOT_DISPLAY_NAME?.trim() || "Vouch Hub";

  if (options.dryRun) {
    const botUsername =
      options.botUsername ??
      process.env.TELEGRAM_BOT_USERNAME?.replace(/^@+/, "") ??
      "your_bot_username";
    const launcherUrl = buildSearchLauncherUrl(botUsername);

    console.info(
      JSON.stringify(
        {
          name: botName,
          description,
          shortDescription,
          commands: {
            default: DEFAULT_COMMANDS,
            private: PRIVATE_COMMANDS,
            groups: GROUP_COMMANDS,
            admins: ADMIN_COMMANDS,
          },
          pinnedGuideText: buildPinnedGuideText(),
          launcherUrl: options.guideChatId != null ? launcherUrl : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  const botUsername = await resolveBotUsername(options.botUsername);

  await callTelegramAPI("setMyName", { name: botName });
  await callTelegramAPI("setMyDescription", {
    description,
  });
  await callTelegramAPI("setMyShortDescription", {
    short_description: shortDescription,
  });

  // Pre-populate the admin-rights checklist that Telegram surfaces when
  // an operator adds the bot to a new group (Bot API setMyDefaultAdmin
  // istratorRights). v9 chat moderation needs can_delete_messages; the
  // mirror works with privacy-mode-OFF + bot membership alone, no extra
  // rights required. Pre-checking the box avoids the silent-failure
  // path where moderation runs but Telegram refuses the delete because
  // can_delete_messages was unchecked at add-time. (Research §8.2.)
  await callTelegramAPI("setMyDefaultAdministratorRights", {
    rights: {
      is_anonymous: false,
      can_manage_chat: true,
      can_delete_messages: true,
      can_manage_video_chats: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_invite_users: false,
      can_post_messages: false,
      can_edit_messages: false,
      can_pin_messages: false,
      can_post_stories: false,
      can_edit_stories: false,
      can_delete_stories: false,
      can_manage_topics: false,
    },
    for_channels: false,
  });

  await setCommands(null, DEFAULT_COMMANDS);
  await setCommands({ type: "all_private_chats" }, PRIVATE_COMMANDS);
  await setCommands({ type: "all_group_chats" }, GROUP_COMMANDS);
  await setCommands({ type: "all_chat_administrators" }, ADMIN_COMMANDS);

  let guideMessageId: number | null = null;
  if (options.guideChatId != null) {
    const sentGuide = await callTelegramAPI("sendMessage", {
      chat_id: options.guideChatId,
      text: buildPinnedGuideText(),
      parse_mode: "HTML",
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔍 Open the bot DM", url: buildSearchLauncherUrl(botUsername) }],
        ],
      },
    });

    guideMessageId = sentGuide.message_id;

    if (options.pinGuide) {
      await callTelegramAPI("pinChatMessage", {
        chat_id: options.guideChatId,
        message_id: guideMessageId,
        disable_notification: true,
      });
    }
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        botUsername,
        guideChatId: options.guideChatId,
        guideMessageId,
        pinnedGuide: options.pinGuide && guideMessageId != null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
