import { PostgresStore } from "@mastra/pg";
import { getDatabaseUrl } from "./db";

// Create a single shared PostgreSQL storage instance
export const sharedPostgresStorage = new PostgresStore({
  connectionString: getDatabaseUrl(),
});
