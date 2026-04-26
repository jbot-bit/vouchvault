import process from "node:process";

type CliOptions = {
  exportFilePath: string;
  reviewReportPath?: string;
  checkpointPath?: string;
  sourceChatId?: number;
  targetGroupChatId?: number;
  dryRun: boolean;
  maxImports?: number;
  throttleMs: number;
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
      "  [--max-imports <N>]      Stop after N successful imports",
      "  [--throttle-ms <N>]      Sleep N ms before each live send (default 3100)",
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
  let maxImports: number | undefined;
  let throttleMs = 3100;

  for (let index = 0; index < argv.length; index += 1) {
    // index < argv.length guarantees element is defined
    const arg = argv[index]!;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--max-imports") {
      maxImports = readNumberFlag(argv[index + 1], "--max-imports");
      index += 1;
      continue;
    }

    if (arg === "--throttle-ms") {
      throttleMs = readNumberFlag(argv[index + 1], "--throttle-ms");
      index += 1;
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
    maxImports,
    throttleMs,
  };
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const { replayLegacyExport } = await import("../src/core/legacyImport.ts");

  // SIGINT/SIGTERM handler. First signal aborts the controller — the import
  // loop checks input.signal.aborted at the top of each iteration, finishes
  // the in-flight step, and persists a final checkpoint. Second signal
  // hard-exits in case the in-flight step is itself stuck.
  const controller = new AbortController();
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) {
      console.error(`Received second ${signal}; hard-exiting.`);
      process.exit(130);
    }
    interrupted = true;
    console.error(
      `Received ${signal}; stopping after current step. Press Ctrl-C again to hard-exit.`,
    );
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const result = await replayLegacyExport({
    exportFilePath: options.exportFilePath,
    reviewReportPath: options.reviewReportPath,
    checkpointPath: options.checkpointPath,
    sourceChatId: options.sourceChatId,
    targetGroupChatId: options.targetGroupChatId,
    dryRun: options.dryRun,
    maxImports: options.maxImports,
    throttleMs: options.throttleMs,
    logger: console,
    signal: controller.signal,
  });

  console.info(
    JSON.stringify(
      {
        completed: result.completed,
        aborted: result.aborted,
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

  // 130 is the conventional exit code for SIGINT-interrupted CLI processes.
  // 1 is generic failure. 0 only on a clean full-completion run.
  if (result.aborted) {
    process.exitCode = 130;
  } else if (!result.completed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
