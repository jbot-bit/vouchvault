import { registerApiRoute } from "../mastra/inngest";
import { Mastra } from "@mastra/core";

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn(
    "Trying to initialize Telegram triggers without TELEGRAM_BOT_TOKEN. Can you confirm that the Telegram integration is configured correctly?",
  );
}

export type TriggerInfoTelegramOnNewMessage = {
  type: "telegram/message";
  params: {
    userName: string | null;
    message: string | null;
    chatId: number | null;
    updateType: "message" | "poll_answer" | "callback_query" | "unknown";
  };
  payload: any;
};

export function registerTelegramTrigger({
  triggerType,
  handler,
}: {
  triggerType: string;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoTelegramOnNewMessage,
  ) => Promise<void>;
}) {
  return [
    registerApiRoute("/webhooks/telegram/action", {
      method: "POST",
      handler: async (c) => {
        const mastra = c.get("mastra");
        const logger = mastra.getLogger();
        try {
          const expectedSecretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
          if (expectedSecretToken) {
            const providedSecretToken = c.req.header("X-Telegram-Bot-Api-Secret-Token");
            if (providedSecretToken !== expectedSecretToken) {
              logger?.warn("🛑 [Telegram] Invalid webhook secret token");
              return c.text("Forbidden", 403);
            }
          }

          const payload = await c.req.json();
          const updateType = payload.poll_answer
            ? "poll_answer"
            : payload.callback_query
              ? "callback_query"
            : payload.message
              ? "message"
              : "unknown";

          logger?.info("📝 [Telegram] payload", payload);

          await handler(mastra, {
            type: triggerType,
            params: {
              userName:
                payload.message?.from?.username ??
                payload.callback_query?.from?.username ??
                payload.poll_answer?.user?.username ??
                null,
              message: payload.message?.text ?? payload.callback_query?.data ?? null,
              chatId:
                payload.message?.chat?.id ??
                payload.callback_query?.message?.chat?.id ??
                null,
              updateType,
            },
            payload,
          } as TriggerInfoTelegramOnNewMessage);

          return c.text("OK", 200);
        } catch (error) {
          logger?.error("Error handling Telegram webhook:", error);
          return c.text("Internal Server Error", 500);
        }
      },
    }),
  ];
}
