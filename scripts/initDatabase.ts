import { ensureDatabaseSchema } from "../src/mastra/storage/bootstrap.ts";

async function main() {
  await ensureDatabaseSchema();
  console.info("Database schema is ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
