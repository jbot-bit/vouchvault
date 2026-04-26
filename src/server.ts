import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { validateBootEnv } from "./core/bootValidation.ts";
import { logBotAdminStatusForChats } from "./core/chatModeration.ts";
import { installGracefulShutdown } from "./core/gracefulShutdown.ts";
import { createLogger } from "./core/logger.ts";
import { getAllowedTelegramChatIds } from "./core/telegramChatConfig.ts";
import {
  callTelegramAPI,
  getTelegramBotId,
} from "./core/tools/telegramTools.ts";
import { TelegramRateLimitError } from "./core/typedTelegramErrors.ts";
import { processTelegramUpdate } from "./telegramBot.ts";

// Constant-time compare for the webhook secret. Plain `!==` leaks length and
// prefix-match timing to an attacker who can measure response latency. The
// secret is high-entropy (32 hex bytes via setTelegramWebhook) so brute-force
// is impractical, but timingSafeEqual is the documented best practice and
// closes the side-channel cleanly.
function safeStringEquals(a: string | string[] | undefined, b: string): boolean {
  if (typeof a !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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

// Per takedown-resilience spec §3.2. Calls `getMe` via the canonical
// `callTelegramAPI` helper with an explicit 3-second timeout. A 429
// response (TelegramRateLimitError) is treated as healthy — the bot
// account is fine, just throttled. Any other Telegram error or socket
// timeout flips /readyz to 503, catching bot-account-level problems
// (token revoked, account ban) that the DB probe alone cannot see.
async function telegramGetMeProbe(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await callTelegramAPI("getMe", {}, undefined, undefined, controller.signal);
    return { ok: true };
  } catch (err) {
    if (err instanceof TelegramRateLimitError) {
      return { ok: true };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "getMe timed out" };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// Telegram webhook payloads are typically <8 KiB. The 256 KiB cap is well
// over any legitimate update (long captions, large reply contexts) while
// keeping JSON.parse latency bounded against pathologically nested payloads.
const MAX_BODY_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {}
class RequestBodyParseError extends Error {}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<any> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError("Request body too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (err) {
    throw new RequestBodyParseError(
      err instanceof Error ? `JSON parse failed: ${err.message}` : "JSON parse failed",
    );
  }
}

async function main() {
  validateBootEnv();

  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pgModule = (await import("pg")).default;

  // Run migrations on a SEPARATE pool that is NOT capped by statement_timeout.
  // The runtime pool sets statement_timeout=20s to bound webhook latency, but
  // future migrations (CREATE INDEX on a large table, data backfills) may
  // exceed that. Migrations run once at boot, so a dedicated pool with one
  // connection and no timeout is the right shape.
  const migrationPool = new pgModule.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: "./migrations" });
  } finally {
    await migrationPool.end();
  }

  const { pool } = await import("./core/storage/db.ts");

  const port = Number(process.env.PORT || "5000");
  const host = "0.0.0.0";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() || null;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        // v6 §10.4: surface stale relay rows so a broken channel-discussion
        // link is visible to ops. A stale row = channel post written
        // (channel_message_id IS NOT NULL) but auto-forward not yet observed
        // (channel publish but supergroup_message_id IS NULL i.e. status
        // still 'channel_published') and >5 min old. Best-effort: if the
        // probe fails, /healthz still returns ok:true for liveness.
        const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim();
        const relayEnabled = process.env.VV_RELAY_ENABLED === "true";
        let staleRelayRows: number | null = null;
        if (relayEnabled && channelId) {
          try {
            const { pool } = await import("./core/storage/db.ts");
            const r = await pool.query(
              "SELECT count(*)::int AS n FROM vouch_entries " +
                "WHERE channel_message_id IS NOT NULL " +
                "AND status = 'channel_published' " +
                "AND created_at < now() - interval '5 minutes'",
            );
            staleRelayRows = r.rows[0]?.n ?? 0;
          } catch (error) {
            logger.warn({ err: error }, "[/healthz] stale relay probe failed");
          }
        }
        const body: Record<string, unknown> = { ok: true };
        if (relayEnabled) {
          body.channel = {
            configured: Boolean(channelId),
            stale_relay_rows: staleRelayRows ?? 0,
          };
        }
        const response = jsonResponse(body);
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
        return;
      }

      if (req.method === "GET" && req.url === "/readyz") {
        // /readyz is unauthenticated (Railway / load-balancer health checks
        // need to hit it). Return a generic ok:false on failure and log the
        // detail server-side — pg's error.message can include connection
        // string fragments and getMe error descriptions can include
        // bot/account context, both of which are reconnaissance for an
        // anonymous attacker.
        try {
          const { pool } = await import("./core/storage/db.ts");
          await pool.query("SELECT 1");
        } catch (error) {
          logger.error({ err: error }, "[/readyz] DB probe failed");
          const response = jsonResponse({ ok: false }, 503);
          res.writeHead(response.statusCode, response.headers);
          res.end(response.body);
          return;
        }

        if (process.env.TELEGRAM_BOT_TOKEN?.trim()) {
          const probe = await telegramGetMeProbe();
          if (!probe.ok) {
            logger.error({ probeError: probe.error }, "[/readyz] Telegram getMe probe failed");
            const response = jsonResponse({ ok: false }, 503);
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
          if (!safeStringEquals(providedSecret, webhookSecret)) {
            const response = textResponse("Forbidden", 403);
            res.writeHead(response.statusCode, response.headers);
            res.end(response.body);
            return;
          }
        }

        let payload: any;
        try {
          payload = await readJsonBody(req);
        } catch (err) {
          if (err instanceof RequestBodyTooLargeError) {
            const response = textResponse("Payload Too Large", 413);
            res.writeHead(response.statusCode, response.headers);
            res.end(response.body);
            return;
          }
          if (err instanceof RequestBodyParseError) {
            logger.warn({ err }, "Webhook body parse failed; returning 400");
            const response = textResponse("Bad Request", 400);
            res.writeHead(response.statusCode, response.headers);
            res.end(response.body);
            return;
          }
          throw err;
        }

        // After authentication + parse, ALWAYS return 200 to Telegram so a
        // doomed update (one that consistently throws) doesn't trigger an
        // infinite retry loop. Idempotency is enforced by
        // processed_telegram_updates inside processTelegramUpdate.
        const TIMEOUT_MS = 25_000;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
          timeoutId = setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS);
          timeoutId.unref?.();
        });
        const work = processTelegramUpdate(payload, logger)
          .then(() => ({ timeout: false as const }))
          // Catch synchronous + late-throwing failures so they don't
          // surface as unhandled promise rejections after the race
          // returns 200. The error is logged and the response stays 200.
          .catch((err) => {
            logger.error(
              { err, update_id: payload?.update_id },
              "processTelegramUpdate failed; webhook returned 200 to avoid retry loop",
            );
            return { timeout: false as const, errored: true };
          });
        const outcome = await Promise.race([work, timeoutPromise]);
        if (timeoutId !== null) clearTimeout(timeoutId);
        if ("timeout" in outcome && outcome.timeout) {
          logger.error(
            { update_id: payload?.update_id },
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

  // Fire-and-forget: log the bot's admin status in every allowed chat at
  // boot. Operators see at-a-glance if the bot lacks admin rights anywhere
  // (silent-failure mode for moderation otherwise). Errors per chat log
  // warn; the whole call is non-blocking — Telegram unreachable at boot
  // doesn't prevent the bot from serving webhooks.
  void (async () => {
    try {
      const botId = await getTelegramBotId(logger);
      if (typeof botId !== "number") {
        logger.warn(
          "chatModeration: could not determine bot id at boot; admin-rights check skipped",
        );
        return;
      }
      await logBotAdminStatusForChats(getAllowedTelegramChatIds(), botId, logger);
    } catch (error) {
      logger.warn({ err: error }, "chatModeration: boot admin-rights check failed");
    }
  })();

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
