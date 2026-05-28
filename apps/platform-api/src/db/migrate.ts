import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";
const MIGRATIONS_DIR = join(__dirname, "migrations");

function checksumSql(sql: string): string {
  return crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Read migration files in deterministic order
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const checksum = checksumSql(sql);
      const name = basename(file);

      // Check if already applied
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [name]
      );

      if (existing.rows.length > 0) {
        skipped.push(name);
        continue;
      }

      // Apply in a transaction
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          name,
          checksum,
        ]);
        await client.query("COMMIT");
        applied.push(name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
    }

    return { applied, skipped };
  } finally {
    await client.end();
  }
}

export async function isMigrated(): Promise<boolean> {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    const result = await client.query("SELECT COUNT(*) as count FROM schema_migrations");
    return Number(result.rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(`Migrations applied: ${applied.length}, skipped: ${skipped.length}`);
      if (applied.length) console.log("Applied:", applied.join(", "));
    })
    .catch(console.error);
}
