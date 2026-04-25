import process from "node:process";

type CliOptions = {
  baseUrl: string | null;
  deleteWebhook: boolean;
  dropPendingUpdates: boolean;
  infoOnly: boolean;
};

function printUsage() {
  console.info(
    [
      "Usage:",
      "  setTelegramWebhook [--base-url <url>] [--delete] [--drop-pending-updates] [--info]",
      "",
      "Environment:",
      "  TELEGRAM_BOT_TOKEN is required.",
      "  PUBLIC_BASE_URL, RAILWAY_PUBLIC_DOMAIN, or REPLIT_DOMAINS can be used instead of --base-url.",
      "  TELEGRAM_WEBHOOK_SECRET_TOKEN is optional but recommended.",
    ].join("\n"),
  );
}

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function parseCliArguments(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let baseUrl: string | null = null;
  let deleteWebhook = false;
  let dropPendingUpdates = false;
  let infoOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--delete") {
      deleteWebhook = true;
      continue;
    }

    if (arg === "--drop-pending-updates") {
      dropPendingUpdates = true;
      continue;
    }

    if (arg === "--info") {
      infoOnly = true;
      continue;
    }

    if (arg === "--base-url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--base-url requires a value.");
      }

      baseUrl = normalizeBaseUrl(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown flag: ${arg}`);
  }

  return { baseUrl, deleteWebhook, dropPendingUpdates, infoOnly };
}

function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  return token;
}

function resolveBaseUrl(explicitBaseUrl: string | null): string {
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  if (publicBaseUrl) {
    return normalizeBaseUrl(publicBaseUrl);
  }

  const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayPublicDomain) {
    return normalizeBaseUrl(`https://${railwayPublicDomain}`);
  }

  const replitDomains = process.env.REPLIT_DOMAINS?.trim();
  if (replitDomains) {
    const firstDomain = replitDomains.split(",")[0]?.trim();
    if (firstDomain) {
      return normalizeBaseUrl(`https://${firstDomain}`);
    }
  }

  throw new Error("Missing base URL. Use --base-url or set PUBLIC_BASE_URL.");
}

async function callTelegramAPI(method: string, payload: Record<string, unknown>) {
  const token = getTelegramToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error calling ${method}: ${data.description}`);
  }

  return data.result;
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));

  if (options.infoOnly) {
    const webhookInfo = await callTelegramAPI("getWebhookInfo", {});
    console.info(JSON.stringify(webhookInfo, null, 2));
    return;
  }

  if (options.deleteWebhook) {
    const result = await callTelegramAPI("deleteWebhook", {
      drop_pending_updates: options.dropPendingUpdates,
    });
    const webhookInfo = await callTelegramAPI("getWebhookInfo", {});
    console.info(JSON.stringify({ ok: result, webhookInfo }, null, 2));
    return;
  }

  const baseUrl = resolveBaseUrl(options.baseUrl);
  const webhookUrl = `${baseUrl}/webhooks/telegram/action`;
  const payload: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    max_connections: 10,
    drop_pending_updates: true,
  };

  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  if (secretToken) {
    payload.secret_token = secretToken;
  }

  await callTelegramAPI("setWebhook", payload);
  const webhookInfo = await callTelegramAPI("getWebhookInfo", {});

  console.info(
    JSON.stringify(
      {
        ok: true,
        webhookUrl,
        webhookInfo,
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
