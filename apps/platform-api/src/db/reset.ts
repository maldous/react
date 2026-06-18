import pg from "pg";

const POSTGRES_URL = process.env["POSTGRES_URL"] ?? "";

export async function resetDatabase(): Promise<void> {
  // SAFETY: only run in local/test environments
  const env = process.env["NODE_ENV"] ?? "development";
  if (!["development", "test", "local"].includes(env)) {
    throw new Error(`resetDatabase is not allowed in environment: ${env}`);
  }
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    await client.query(
      "DROP TABLE IF EXISTS memberships, external_identities, users, organisations, schema_migrations CASCADE"
    );
  } finally {
    await client.end();
  }
}
