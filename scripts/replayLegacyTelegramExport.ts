import process from "node:process";

type CliOptions = {
  exportFilePath: string;
  reviewReportPath?: string;
  checkpointPath?: string;
  sourceChatId?: number;
  targetGroupChatId?: number;
  dryRun: boolean;
};

function readStringFlag(value: string | undefined, flagName: string): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} requires a value.`);
  }

  return value;
}

function readNumberFlag(value: string | undefined, flagName: string): number {
  if (!value || !/^-?\d+$/.test(value)) {
    throw new Error(`${flagName} requires an integer value.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flagName} must be a safe integer.`);
  }

  return parsed;
}

function printUsage() {
  console.info(
    [
      "Usage:",
      "  replayLegacyTelegramExport <export-json-path> [--target-chat-id <id>] [--source-chat-id <id>] [--review-report <path>] [--checkpoint <path>] [--dry-run]",
      "",
      "Notes:",
      "  --target-chat-id defaults to the first TELEGRAM_ALLOWED_CHAT_IDS entry.",
      "  --source-chat-id is only needed if the export JSON does not expose the original chat id.",
    ].join("\n"),
  );
}

function parseCliArguments(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let exportFilePath: string | undefined;
  let reviewReportPath: string | undefined;
  let checkpointPath: string | undefined;
  let sourceChatId: number | undefined;
  let targetGroupChatId: number | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    // index < argv.length guarantees element is defined
    const arg = argv[index]!;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--review-report") {
      reviewReportPath = readStringFlag(argv[index + 1], "--review-report");
      index += 1;
      continue;
    }

    if (arg === "--checkpoint") {
      checkpointPath = readStringFlag(argv[index + 1], "--checkpoint");
      index += 1;
      continue;
    }

    if (arg === "--source-chat-id") {
      sourceChatId = readNumberFlag(argv[index + 1], "--source-chat-id");
      index += 1;
      continue;
    }

    if (arg === "--target-chat-id") {
      targetGroupChatId = readNumberFlag(argv[index + 1], "--target-chat-id");
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (exportFilePath) {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }

    exportFilePath = arg;
  }

  if (!exportFilePath) {
    throw new Error("Missing export JSON path.");
  }

  return {
    exportFilePath,
    reviewReportPath,
    checkpointPath,
    sourceChatId,
    targetGroupChatId,
    dryRun,
  };
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const { replayLegacyExport } = await import("../src/core/legacyImport.ts");
  const result = await replayLegacyExport({
    exportFilePath: options.exportFilePath,
    reviewReportPath: options.reviewReportPath,
    checkpointPath: options.checkpointPath,
    sourceChatId: options.sourceChatId,
    targetGroupChatId: options.targetGroupChatId,
    dryRun: options.dryRun,
    logger: console,
  });

  console.info(
    JSON.stringify(
      {
        completed: result.completed,
        sourceChatId: result.sourceChatId,
        targetGroupChatId: result.targetGroupChatId,
        reviewReportPath: result.reviewReportPath,
        checkpointPath: result.checkpointPath,
        summary: result.summary,
        failure: result.failure,
      },
      null,
      2,
    ),
  );

  if (!result.completed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
