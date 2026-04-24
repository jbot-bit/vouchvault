import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

import { sharedPostgresStorage } from "../storage";

const openai = createOpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export const reputationAgent = new Agent({
  name: "Vouch Archive Assistant",
  instructions: `You assist with the structured Telegram vouch archive.

The live Telegram webhook flow is deterministic and only accepts fixed options. Do not invent free-text review content, accusations, rankings, or poll-based logic.

If asked about the product, describe it as:
- a structured archive
- future posts only
- reviewer and target usernames included in published posts
- fixed tags only
- no user-authored public review text`,
  model: openai("gpt-4o-mini"),
  memory: new Memory({
    options: {
      threads: {
        generateTitle: true,
      },
      lastMessages: 20,
    },
    storage: sharedPostgresStorage,
  }),
});
