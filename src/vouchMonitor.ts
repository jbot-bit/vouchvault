// @vouchmonitorbot — long-polling forwarder.
//
// Listens for new text messages in VOUCH_MONITOR_SOURCE_CHAT_ID (a group
// the bot is admin in with privacy-mode-OFF) and calls forwardMessage to
// VOUCH_MONITOR_DEST_CHAT_ID. Runs as a sibling worker inside the same
// Railway service; no separate webhook endpoint, no PC dependency.
//
// Why a separate bot (not VouchVault): isolation. If Telegram ever flags
// the QVF→SC45 forward path as scraping, only this bot eats the strike.
// VouchVault keeps moderating SC45.
//
// Why long-polling (not webhook): a second bot would otherwise need a
// distinct webhook URL + Railway routing. getUpdates with timeout=30 is
// simpler, idle-CPU is negligible, and the offset cursor gives at-most-
// once delivery without any DB state.

import type { Logger } from "pino";

type LoggerLike = Pick<Logger, "info" | "warn" | "error">;

type TelegramMessage = {
  message_id: number;
  text?: string;
  caption?: string;
  via_bot?: { is_bot?: boolean };
  from?: { id?: number; is_bot?: boolean };
  chat?: { id?: number };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type GetUpdatesResponse = {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
  parameters?: { retry_after?: number };
};

const POLL_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 5_000;

type Config = {
  token: string;
  sourceChatId: number;
  destChatId: number;
};

function readConfig(logger: LoggerLike): Config | null {
  const token = process.env.VOUCH_MONITOR_BOT_TOKEN?.trim();
  const sourceRaw = process.env.VOUCH_MONITOR_SOURCE_CHAT_ID?.trim();
  const destRaw = process.env.VOUCH_MONITOR_DEST_CHAT_ID?.trim();

  if (!token || !sourceRaw || !destRaw) {
    return null;
  }

  const sourceChatId = Number(sourceRaw);
  const destChatId = Number(destRaw);
  if (!Number.isFinite(sourceChatId) || !Number.isFinite(destChatId)) {
    logger.warn(
      { sourceRaw, destRaw },
      "vouchMonitor: source or dest chat id is not numeric; skipping startup",
    );
    return null;
  }
  if (sourceChatId === destChatId) {
    logger.warn(
      "vouchMonitor: source and dest chat ids are identical; refusing to forward in-place",
    );
    return null;
  }

  return { token, sourceChatId, destChatId };
}

function shouldForward(message: TelegramMessage, sourceChatId: number): boolean {
  if (message.chat?.id !== sourceChatId) return false;
  // Bot self-skip: don't forward our own posts (defensive — the bot
  // shouldn't be posting in the source group, but if a future change
  // makes it do so, we don't want a feedback loop).
  if (message.from?.is_bot === true) return false;
  if (message.via_bot != null) return false;
  // Forward text + captions only. Media-only messages dropped to keep
  // the backup channel scoped to vouches (text content), and to dodge
  // the file-size + media-handling complexity of forwardMessage on
  // photos/videos. The original message stays visible in the source
  // group — we're a forwarder, not the source of truth.
  const hasText = typeof message.text === "string" && message.text.trim().length > 0;
  const hasCaption =
    typeof message.caption === "string" && message.caption.trim().length > 0;
  if (!hasText && !hasCaption) return false;
  return true;
}

async function callBotApi(
  token: string,
  method: string,
  params: Record<string, unknown> | null,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params == null ? "{}" : JSON.stringify(params),
  };
  if (abortSignal) init.signal = abortSignal;
  const res = await fetch(url, init);
  return res.json();
}

async function forwardOne(
  config: Config,
  message: TelegramMessage,
  logger: LoggerLike,
): Promise<void> {
  try {
    const result = (await callBotApi(config.token, "forwardMessage", {
      chat_id: config.destChatId,
      from_chat_id: config.sourceChatId,
      message_id: message.message_id,
      disable_notification: true,
    })) as { ok: boolean; description?: string; parameters?: { retry_after?: number } };

    if (!result.ok) {
      const retryAfter = result.parameters?.retry_after;
      if (typeof retryAfter === "number" && retryAfter > 0) {
        logger.warn(
          { retryAfter, sourceMessageId: message.message_id },
          "vouchMonitor: forward 429; sleeping",
        );
        await sleep(retryAfter * 1_000 + 250);
        await forwardOne(config, message, logger);
        return;
      }
      logger.warn(
        { description: result.description, sourceMessageId: message.message_id },
        "vouchMonitor: forwardMessage failed",
      );
      return;
    }

    logger.info(
      { sourceMessageId: message.message_id, destChatId: config.destChatId },
      "vouchMonitor: forwarded",
    );
  } catch (err) {
    logger.warn(
      { err, sourceMessageId: message.message_id },
      "vouchMonitor: forward threw",
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn the long-polling worker. Returns immediately; the loop runs forever
 * (until process exit). Self-skips with a single log line if the env vars
 * aren't configured — safe to call unconditionally from server boot.
 */
export function startVouchMonitor(logger: LoggerLike): void {
  const config = readConfig(logger);
  if (config == null) {
    logger.info("vouchMonitor: env not configured; not starting");
    return;
  }

  logger.info(
    { sourceChatId: config.sourceChatId, destChatId: config.destChatId },
    "vouchMonitor: starting long-polling worker",
  );

  void runLoop(config, logger);
}

async function runLoop(config: Config, logger: LoggerLike): Promise<void> {
  let offset = 0;
  // Pin allowed_updates to "message" so this bot doesn't try to handle
  // callback queries / channel posts / chat-member events. Cuts the
  // attack surface and keeps polling efficient.
  const allowedUpdates = JSON.stringify(["message"]);

  for (;;) {
    try {
      const response = (await callBotApi(config.token, "getUpdates", {
        offset,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: JSON.parse(allowedUpdates),
      })) as GetUpdatesResponse;

      if (!response.ok) {
        const retryAfter = response.parameters?.retry_after;
        if (typeof retryAfter === "number" && retryAfter > 0) {
          logger.warn({ retryAfter }, "vouchMonitor: getUpdates 429; sleeping");
          await sleep(retryAfter * 1_000 + 250);
          continue;
        }
        logger.warn(
          { description: response.description },
          "vouchMonitor: getUpdates non-ok",
        );
        await sleep(ERROR_BACKOFF_MS);
        continue;
      }

      for (const update of response.result ?? []) {
        offset = update.update_id + 1;
        const message = update.message;
        if (message == null) continue;
        if (!shouldForward(message, config.sourceChatId)) continue;
        await forwardOne(config, message, logger);
      }
    } catch (err) {
      logger.warn({ err }, "vouchMonitor: poll loop error; backing off");
      await sleep(ERROR_BACKOFF_MS);
    }
  }
}
