export async function ensureDatabaseSchema(): Promise<void> {
  console.warn(
    "[bootstrap] ensureDatabaseSchema() is deprecated; migrations now run via drizzle-orm/node-postgres/migrator.",
  );
}
