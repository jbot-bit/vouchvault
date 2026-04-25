import { createServer } from "node:http";

import { validateBootEnv } from "./core/bootValidation.ts";
import { installGracefulShutdown } from "./core/gracefulShutdown.ts";
import { createLogger } from "./core/logger.ts";
import { processTelegramUpdate } from "./telegramBot.ts";

const logger = createLogger();

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
  validateBootEnv();

  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { pool } = await import("./core/storage/db.ts");
  await migrate(drizzle(pool), { migrationsFolder: "./migrations" });

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

      if (req.method === "GET" && req.url === "/readyz") {
        try {
          const { pool } = await import("./core/storage/db.ts");
          await pool.query("SELECT 1");
          const response = jsonResponse({ ok: true });
          res.writeHead(response.statusCode, response.headers);
          res.end(response.body);
        } catch (error) {
          const response = jsonResponse(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            503,
          );
          res.writeHead(response.statusCode, response.headers);
          res.end(response.body);
        }
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

        const TIMEOUT_MS = 25_000;
        const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
          setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS).unref?.(),
        );
        const work = processTelegramUpdate(payload, logger).then(() => ({
          timeout: false as const,
        }));
        const outcome = await Promise.race([work, timeoutPromise]);
        if (outcome.timeout) {
          logger.error(
            { update_id: payload.update_id },
            "Telegram update processing exceeded 25s; returning 200 to avoid retry loop",
          );
        }

        const response = textResponse("OK");
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
        return;
      }

      const response = textResponse("Not Found", 404);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    } catch (error) {
      logger.error({ err: error }, "Request handling failed");
      const response = textResponse("Internal Server Error", 500);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    }
  });

  server.listen(port, host, () => {
    logger.info(
      {
        port,
        host,
        webhookPath: "/webhooks/telegram/action",
        healthPath: "/healthz",
        readyzPath: "/readyz",
      },
      "server listening",
    );
  });

  installGracefulShutdown({
    server,
    dbPool: pool,
    drainMs: 5_000,
    hardCeilingMs: 8_000,
    logger,
  });
}

main().catch((error) => {
  logger.error({ err: error }, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
