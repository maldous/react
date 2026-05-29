import pg from "pg";

export const packageName = "@platform/adapters-postgres";

export { PostgresIdentityRepository } from "./postgres-identity-repository.ts";
export { PostgresOrganisationRepository } from "./postgres-organisation-repository.ts";
export { PostgresReadinessAdapter } from "./postgres-readiness-adapter.ts";
export type { IdentityRepository, OrganisationRepository } from "./ports.ts";

// ---------------------------------------------------------------------------
// Schema identifier safety (SQL injection prevention)
//
// organisationId is always a UUID v4. After replaceAll("-","_") the raw
// identifier contains only [0-9a-f_] — no SQL-special characters. We
// additionally validate the UUID format before deriving an identifier, and
// use client.escapeIdentifier() to properly double-quote it per SQL standard.
// This provides two independent layers of protection.
// ---------------------------------------------------------------------------

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tenantSchemaIdentifier(client: pg.PoolClient, organisationId: string): string {
  if (!UUID_V4_RE.test(organisationId)) {
    throw new Error(
      `Invalid organisationId: expected UUID v4, got "${organisationId.slice(0, 36)}"`
    );
  }
  return client.escapeIdentifier(`tenant_${organisationId.replaceAll("-", "_")}`);
}

// ---------------------------------------------------------------------------
// withTenant — schema-per-tenant transaction context (ADR-0029 §3b)
//
// Sets search_path to the tenant's schema for the duration of a transaction.
// All table references in fn() resolve to tenant_{organisationId} schema.
// SET LOCAL scopes the setting to the current transaction only — pool-safe.
// ---------------------------------------------------------------------------

export async function withTenant<T>(
  pool: pg.Pool,
  organisationId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// withSystemAdmin — cross-tenant RLS bypass (ADR-0029 §3d, ADR-0031)
//
// Bypasses Row-Level Security for cross-tenant operations (audit, billing,
// support). Every call must be audited before execution. Never use in
// request handlers — only in provisioning and audit use cases.
// ---------------------------------------------------------------------------

export async function withSystemAdmin<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.bypass_rls = true");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// createTenantSchema — provision a new tenant schema (ADR-0029 §8, ADR-0031)
//
// The platform DB user owns the database and can CREATE SCHEMA without
// superuser privileges (ADR-0031 §PostgreSQL privilege analysis).
// This is idempotent — safe to call if the schema already exists.
// ---------------------------------------------------------------------------

export async function createTenantSchema(pool: pg.Pool, organisationId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    client.release();
  }
}

export async function dropTenantSchema(pool: pg.Pool, organisationId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    client.release();
  }
}
