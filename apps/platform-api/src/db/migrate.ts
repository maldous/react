import pg from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

export async function runMigrations(): Promise<void> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    const sql = readFileSync(join(__dirname, "migrations/001-identity-schema.sql"), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => console.log("Migrations complete"))
    .catch(console.error);
}
