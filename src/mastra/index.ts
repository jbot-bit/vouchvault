import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import { sharedPostgresStorage } from "./storage";
import { ensureDatabaseSchema } from "./storage/bootstrap";
import { inngest, inngestServe } from "./inngest";
import { reputationWorkflow } from "./workflows/reputationWorkflow";
import { reputationAgent } from "./agents/reputationAgent";
import { getAllowedTelegramChatIdSet } from "./telegramChatConfig";
import { registerTelegramTrigger, type TriggerInfoTelegramOnNewMessage } from "../triggers/telegramTriggers";

// Import all tools for MCP registration
import { createOrUpdateUserTool, getUserByTelegramIdTool, updateUserVotesTool } from "./tools/userTools";
import {
  sendTelegramMessageTool,
  editTelegramMessageTool,
} from "./tools/telegramTools";

function requireRuntimeEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

requireRuntimeEnv("DATABASE_URL");
requireRuntimeEnv("TELEGRAM_BOT_TOKEN");
if (getAllowedTelegramChatIdSet().size === 0) {
  throw new Error("TELEGRAM_ALLOWED_CHAT_IDS is required.");
}

await ensureDatabaseSchema();

const allowedTelegramChatIds = getAllowedTelegramChatIdSet();

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register your workflows here
  workflows: { reputationWorkflow },
  // Register your agents here
  agents: { reputationAgent },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {
        createOrUpdateUserTool,
        getUserByTelegramIdTool,
        updateUserVotesTool,
        sendTelegramMessageTool,
        editTelegramMessageTool,
      },
    }),
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      // This API route is used to register the Mastra workflow (inngest function) on the inngest server
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
        // The inngestServe function integrates Mastra workflows with Inngest by:
        // 1. Creating Inngest functions for each workflow with unique IDs (workflow.${workflowId})
        // 2. Setting up event handlers that:
        //    - Generate unique run IDs for each workflow execution
        //    - Create an InngestExecutionEngine to manage step execution
        //    - Handle workflow state persistence and real-time updates
        // 3. Establishing a publish-subscribe system for real-time monitoring
        //    through the workflow:${workflowId}:${runId} channel
      },
      // Telegram webhook trigger
      ...registerTelegramTrigger({
        triggerType: "telegram/message",
        handler: async (mastra: Mastra, triggerInfo: TriggerInfoTelegramOnNewMessage) => {
          const logger = mastra.getLogger();
          const sourceChat = triggerInfo.payload.message?.chat ?? triggerInfo.payload.callback_query?.message?.chat;
          const sourceChatId = sourceChat?.id;
          const sourceChatType = sourceChat?.type;

          if (
            sourceChatType !== "private" &&
            sourceChatId != null &&
            !allowedTelegramChatIds.has(sourceChatId)
          ) {
            logger?.info("🛑 [Telegram Trigger] Ignoring chat outside allowlist", {
              sourceChatId,
              allowedChatIds: [...allowedTelegramChatIds],
            });
            return;
          }

          logger?.info("📝 [Telegram Trigger] Received update", { triggerInfo });

          const run = await mastra.getWorkflow("reputationWorkflow").createRunAsync();
          await run.start({
            inputData: {
              telegramPayload: triggerInfo.payload,
              threadId: `telegram/${sourceChatId || triggerInfo.payload.callback_query?.from?.id || triggerInfo.payload.poll_answer?.user?.id}`,
            },
          });
        },
      }),
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}
