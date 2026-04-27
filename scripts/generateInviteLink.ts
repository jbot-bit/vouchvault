// v8.0 commit 3 (U2): one-shot invite-link operator CLI.
//
// Usage:
//   npm run invite:new -- --member-limit=1 --expire-hours=24 --name "twitter-2026-04"
//
// Required envs:
//   TELEGRAM_BOT_TOKEN — bot must be admin in the supergroup with
//     can_invite_users right (Bot API requirement, snapshot 11345).
//   TELEGRAM_ALLOWED_CHAT_IDS — picks the first listed chat as default;
//     pass --chat-id explicitly to override.
//
// Bot API params verified against
// docs/runbook/telegram-snapshots/telegram-bot-api.html line 11344:
//   - member_limit: 1-99999. Default 1 here for one-shot semantics.
//   - expire_date: Unix-seconds integer (we accept hours and convert).
//   - name: 0-32 characters. Logged as-is on the operator's side.
import process from "node:process";

import { generateInviteLink } from "../src/core/inviteLinks.ts";
import { createLogger } from "../src/core/logger.ts";

interface CliOptions {
  chatId: number | null;
  memberLimit: number;
  expireHours: number;
  name: string | null;
}

function printUsage(): void {
  console.info(
    [
      "Usage:",
      "  generateInviteLink [--chat-id <id>] [--member-limit <n>] [--expire-hours <h>] [--name <text>]",
      "",
      "Defaults:",
      "  --member-limit 1   (one-shot link; auto-revokes after first use)",
      "  --expire-hours 24  (link expires 24h from mint time)",
      "",
      "Environment:",
      "  TELEGRAM_BOT_TOKEN — required",
      "  TELEGRAM_ALLOWED_CHAT_IDS — first listed chat is the default --chat-id",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const opts: CliOptions = {
    chatId: null,
    memberLimit: 1,
    expireHours: 24,
    name: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inlineValue] = arg.includes("=") ? arg.split("=", 2) : [arg, undefined];
    const next = inlineValue ?? argv[i + 1];
    const consumeNext = inlineValue === undefined;

    switch (flag) {
      case "--chat-id":
        opts.chatId = Number(next);
        if (!Number.isFinite(opts.chatId)) {
          throw new Error(`--chat-id must be numeric (got ${next})`);
        }
        if (consumeNext) i++;
        break;
      case "--member-limit":
        opts.memberLimit = Number(next);
        if (!Number.isInteger(opts.memberLimit) || opts.memberLimit < 1) {
          throw new Error(`--member-limit must be a positive integer (got ${next})`);
        }
        if (consumeNext) i++;
        break;
      case "--expire-hours":
        opts.expireHours = Number(next);
        if (!Number.isFinite(opts.expireHours) || opts.expireHours <= 0) {
          throw new Error(`--expire-hours must be > 0 (got ${next})`);
        }
        if (consumeNext) i++;
        break;
      case "--name":
        opts.name = String(next ?? "");
        if (consumeNext) i++;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return opts;
}

function resolveChatId(explicit: number | null): number {
  if (explicit != null) return explicit;
  const env = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").trim();
  if (!env) {
    throw new Error(
      "no --chat-id provided and TELEGRAM_ALLOWED_CHAT_IDS env is empty",
    );
  }
  const first = env.split(",")[0]!.trim();
  const parsed = Number(first);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `TELEGRAM_ALLOWED_CHAT_IDS first entry is not numeric (got "${first}")`,
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const logger = createLogger();

  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    throw new Error("TELEGRAM_BOT_TOKEN env var is required");
  }

  const chatId = resolveChatId(opts.chatId);

  const generated = await generateInviteLink(
    {
      chatId,
      memberLimit: opts.memberLimit,
      expireHours: opts.expireHours,
      name: opts.name ?? undefined,
    },
    logger,
  );

  console.info("Generated invite link:");
  console.info(`  link:         ${generated.link}`);
  console.info(`  member_limit: ${generated.memberLimit}`);
  console.info(
    `  expires at:   ${generated.expireDate?.toISOString() ?? "(no expiry)"}`,
  );
  console.info(`  name:         ${generated.name ?? "(unnamed)"}`);
  console.info(`  chat_id:      ${chatId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
