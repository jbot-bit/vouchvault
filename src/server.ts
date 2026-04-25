import { createServer } from "node:http";

import { ensureDatabaseSchema } from "./mastra/storage/bootstrap.ts";
import { getAllowedTelegramChatIdSet } from "./mastra/telegramChatConfig.ts";
import { processTelegramUpdate } from "./telegramBot.ts";

function requireRuntimeEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function jsonResponse(body: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

function textResponse(body: string, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    body,
  };
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<any> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  requireRuntimeEnv("DATABASE_URL");
  requireRuntimeEnv("TELEGRAM_BOT_TOKEN");
  if (getAllowedTelegramChatIdSet().size === 0) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_IDS is required.");
  }

  await ensureDatabaseSchema();

  const port = Number(process.env.PORT || "5000");
  const host = "0.0.0.0";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() || null;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        const response = jsonResponse({ ok: true });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        const response = textResponse("VouchVault Telegram bot is running.");
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
        return;
      }

      if (req.method === "POST" && req.url === "/webhooks/telegram/action") {
        if (webhookSecret) {
          const providedSecret = req.headers["x-telegram-bot-api-secret-token"];
          if (providedSecret !== webhookSecret) {
            const response = textResponse("Forbidden", 403);
            res.writeHead(response.statusCode, response.headers);
            res.end(response.body);
            return;
          }
        }

        const payload = await readJsonBody(req);
        await processTelegramUpdate(payload, console);

        const response = textResponse("OK");
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
        return;
      }

      const response = textResponse("Not Found", 404);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    } catch (error) {
      console.error("Request handling failed", error);
      const response = textResponse("Internal Server Error", 500);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    }
  });

  server.listen(port, host, () => {
    console.info(
      JSON.stringify({
        ok: true,
        port,
        host,
        webhookPath: "/webhooks/telegram/action",
        healthPath: "/healthz",
      }),
    );
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
