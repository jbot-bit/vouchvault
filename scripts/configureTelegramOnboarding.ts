import process from "node:process";

import {
  buildBotDescriptionText,
  buildBotShortDescription,
  buildPinnedGuideText,
} from "../src/mastra/archive.ts";

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

const DEFAULT_COMMANDS: BotCommand[] = [
  { command: "help", description: "How the archive works" },
  { command: "recent", description: "Show recent entries" },
];

const PRIVATE_COMMANDS: BotCommand[] = [
  { command: "vouch", description: "Start a new vouch" },
  ...DEFAULT_COMMANDS,
];

const ADMIN_COMMANDS: BotCommand[] = [
  ...DEFAULT_COMMANDS,
  { command: "freeze", description: "Freeze @username" },
  { command: "unfreeze", description: "Unfreeze @username" },
  { command: "remove_entry", description: "Remove an entry by id" },
];

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

function buildLauncherUrl(botUsername: string, chatId: number): string {
  return `https://t.me/${botUsername}?start=vouch_${chatId}`;
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

  if (options.dryRun) {
    const botUsername =
      options.botUsername ??
      process.env.TELEGRAM_BOT_USERNAME?.replace(/^@+/, "") ??
      "your_bot_username";
    const guideUrl =
      options.guideChatId == null ? null : buildLauncherUrl(botUsername, options.guideChatId);

    console.info(
      JSON.stringify(
        {
          description,
          shortDescription,
          commands: {
            default: DEFAULT_COMMANDS,
            private: PRIVATE_COMMANDS,
            groups: DEFAULT_COMMANDS,
            admins: ADMIN_COMMANDS,
          },
          pinnedGuideText: buildPinnedGuideText(),
          launcherUrl: guideUrl,
        },
        null,
        2,
      ),
    );
    return;
  }

  const botUsername = await resolveBotUsername(options.botUsername);

  await callTelegramAPI("setMyDescription", {
    description,
  });
  await callTelegramAPI("setMyShortDescription", {
    short_description: shortDescription,
  });

  await setCommands(null, DEFAULT_COMMANDS);
  await setCommands({ type: "all_private_chats" }, PRIVATE_COMMANDS);
  await setCommands({ type: "all_group_chats" }, DEFAULT_COMMANDS);
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
          [{ text: "Submit Vouch", url: buildLauncherUrl(botUsername, options.guideChatId) }],
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
