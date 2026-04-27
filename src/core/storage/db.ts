import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

const { Pool } = pg;

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return databaseUrl;
}

export const pool = new Pool({
  connectionString: getDatabaseUrl(),
  // v6: 3 bots × max-connections of 10 each via setWebhook = need
  // headroom. Bumped 5 → 10. Migrator pool is separate.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Cap individual statements at 20s so a wedged query (e.g. a stuck
  // pg_advisory_lock or a slow scan) cannot hold its connection slot
  // longer than the 25s webhook race window in server.ts. statement_timeout
  // is enforced server-side; query_timeout is the client-side belt that
  // fires even if the server ignores statement_timeout.
  statement_timeout: 20_000,
  query_timeout: 20_000,
});

export const db = drizzle(pool, { schema });
