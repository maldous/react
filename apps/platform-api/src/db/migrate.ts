import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTGRES_URL = process.env["POSTGRES_URL"] ?? "";
const MIGRATIONS_DIR = join(__dirname, "migrations");

function checksumSql(sql: string): string {
  return crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

// The platform_app role password is NEVER hardcoded in a managed-secret migration
// (Sonar secrets:S6698). Migration 034 carries a ${PLATFORM_APP_PASSWORD}
// placeholder; the value is sourced at apply-time from POSTGRES_APP_URL — the
// dedicated managed application-role credential (ADR-0072 generated env /
// OpenBao-backed secret material per ADR-0069). It is sourced ONLY from
// POSTGRES_APP_URL: the superuser credential in POSTGRES_URL must never become
// the platform_app password, so there is deliberately no fallback to it. The
// checksum is computed on the FILE content (with the placeholder), so it stays
// stable across environments regardless of the actual secret.
export function platformAppRolePassword(env: NodeJS.ProcessEnv = process.env): string {
  const url = env["POSTGRES_APP_URL"];
  if (!url) {
    throw new Error(
      "Cannot resolve platform_app role password — set POSTGRES_APP_URL (managed env, ADR-0072). " +
        "POSTGRES_URL (superuser) is intentionally NOT used as a fallback."
    );
  }
  let pw: string;
  try {
    pw = new URL(url).password;
  } catch {
    throw new Error("POSTGRES_APP_URL is not a valid connection URL");
  }
  if (!pw) {
    throw new Error("POSTGRES_APP_URL carries no password component");
  }
  return decodeURIComponent(pw);
}

// Reject any password that cannot be safely single-quoted into the ALTER ROLE
// statement: a single quote or backslash would let the value break out of the
// string literal, and a control character (newline/CR/etc.) would split the
// statement. The placeholder is the ONLY interpolation point, so this is the
// single trust boundary for migration SQL.
export function assertSafeRolePassword(pw: string): void {
  // A control character (newline/CR/null/etc.) could split the statement; a
  // single quote or backslash could break out of the string literal. Detect
  // control chars by code point (no control-char regex literal — Sonar S6324).
  const hasControlChar = [...pw].some((ch) => ch.charCodeAt(0) < 0x20);
  if (pw.includes("'") || pw.includes("\\") || hasControlChar) {
    throw new Error(
      "platform_app password must not contain a quote, backslash, or control character (SQL safety)"
    );
  }
}

export function materializeSql(sql: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!sql.includes("${PLATFORM_APP_PASSWORD}")) return sql;
  const pw = platformAppRolePassword(env);
  assertSafeRolePassword(pw);
  return sql.split("${PLATFORM_APP_PASSWORD}").join(pw);
}

// Deterministic, locale-independent ordering for migration filenames. Default
// String#localeCompare can reorder names under some locale collations (e.g.
// punctuation/digit handling), which would change apply order; migration order
// must be byte/code-point stable everywhere. Filenames are zero-padded and
// ASCII, so a plain code-point comparison is the correct total order.
export function compareMigrationNames(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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
      .sort(compareMigrationNames);

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
        const storedChecksum = existing.rows[0].checksum;
        if (storedChecksum === checksum) {
          skipped.push(name);
          continue;
        } else {
          throw new Error(
            `Migration checksum mismatch for ${name}: ` +
              `stored=${storedChecksum}, computed=${checksum}. ` +
              `Do not modify committed migration files.`
          );
        }
      }

      // Apply in a transaction
      await client.query("BEGIN");
      try {
        await client.query(materializeSql(sql));
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
      process.stdout.write(`Migrations applied: ${applied.length}, skipped: ${skipped.length}\n`);
      if (applied.length) {
        process.stdout.write(`Applied: ${applied.join(", ")}\n`);
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`\nFatal error: ${msg}\n`);
      process.exitCode = 1;
    });
}
