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

// Per takedown-resilience spec §3.2. Runs a `getMe` fetch with an explicit
// 3-second timeout. A 429 response is treated as healthy (the bot account
// is fine, just throttled). Any other Telegram error or socket timeout is
// returned to the caller so /readyz can flip to 503 — which catches
// bot-account-level problems (token revoked, account ban) that the DB
// probe cannot.
async function telegramGetMeProbe(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      signal: controller.signal,
    });
    if (response.status === 429) {
      return { ok: true };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `getMe HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; error_code?: number; description?: string }
      | null;
    if (data?.ok === true) {
      return { ok: true };
    }
    if (Number(data?.error_code ?? 0) === 429) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `getMe failed: ${data?.description ?? "unexpected response"}`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "getMe timed out" };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
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
        } catch (error) {
          const response = jsonResponse(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            503,
          );
          res.writeHead(response.statusCode, response.headers);
          res.end(response.body);
          return;
        }

        const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
        if (token) {
          const probe = await telegramGetMeProbe(token);
          if (!probe.ok) {
            const response = jsonResponse({ ok: false, error: probe.error }, 503);
            res.writeHead(response.statusCode, response.headers);
            res.end(response.body);
            return;
          }
        }

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
