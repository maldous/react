import pg from "pg";

export const packageName = "@platform/adapters-postgres";

export { PostgresIdentityRepository } from "./postgres-identity-repository.ts";
export { PostgresOrganisationRepository } from "./postgres-organisation-repository.ts";
export { PostgresReadinessAdapter } from "./postgres-readiness-adapter.ts";
export type { IdentityRepository, OrganisationRepository } from "./ports.ts";

// ---------------------------------------------------------------------------
// Schema identifier safety (SQL injection prevention)
//
// organisationId is always a UUID v4. We validate the format first, then use
// client.escapeIdentifier() to properly double-quote the derived name.
// Two independent layers of protection against injection.
//
// Exported so that callers constructing tenant-schema SQL outside this module
// use the same validated path (e.g. /api/theme, provisioning service).
// ---------------------------------------------------------------------------

export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function tenantSchemaIdentifier(client: pg.ClientBase, organisationId: string): string {
  if (!UUID_V4_RE.test(organisationId)) {
    throw new Error(
      `Invalid organisationId: expected UUID v4, got "${organisationId.slice(0, 36)}"`
    );
  }
  return client.escapeIdentifier(`tenant_${organisationId.replaceAll("-", "_")}`);
}

/**
 * Run a query inside a tenant schema.
 * Useful for callers that need a one-off tenant read without a full
 * withTenant() transaction (e.g. GET /api/theme, which is read-only and
 * does not need session isolation beyond schema scoping).
 */
export async function queryTenantSchema<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  organisationId: string,
  sql: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// withTenant — schema-per-tenant transaction context (ADR-0029 §3b)
//
// Sets:
//   SET LOCAL search_path = "tenant_{id}", public
//   SET LOCAL app.current_tenant_id = <organisationId>
//
// Both are required: search_path routes unqualified table names to the tenant
// schema; app.current_tenant_id satisfies the RLS policies on public-schema
// tables (memberships, users, external_identities) when the app DB user is
// a non-superuser (production requirement per ADR-0031).
//
// SET LOCAL scopes both settings to the current transaction — pool-safe.
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
    await client.query("SET LOCAL app.current_tenant_id = $1", [organisationId]);
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

/**
 * withTenantActor — tenant + user context (ADR-0029 §3d)
 *
 * Extends withTenant by also setting app.current_user_id so that RLS policies
 * allowing own-record access (users, external_identities) function correctly
 * for per-user data operations.
 */
export async function withTenantActor<T>(
  pool: pg.Pool,
  organisationId: string,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    await client.query("SET LOCAL app.current_tenant_id = $1", [organisationId]);
    await client.query("SET LOCAL app.current_user_id = $1", [userId]);
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
// Sets: SET LOCAL app.bypass_rls = true
//
// Bypasses Row-Level Security for cross-tenant operations (provisioning,
// auth callback identity resolution, billing, support). Every withSystemAdmin
// call must be audited before or adjacent to execution. Never use in
// request handlers — only in provisioning and auth system paths.
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
// Uses the platform DB user (database owner) — no superuser privilege needed.
// Idempotent: safe to call if schema already exists.
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
