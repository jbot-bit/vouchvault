import process from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: "./migrations" });

  await pool.end();
  console.info(JSON.stringify({ ok: true, migrations: "applied" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
