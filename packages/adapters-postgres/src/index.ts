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
 * Run a single query inside a tenant schema.
 *
 * Wraps the query in BEGIN/COMMIT so SET LOCAL search_path is
 * transaction-scoped and takes effect. Without an explicit transaction,
 * SET LOCAL is silently a no-op in PostgreSQL (SET LOCAL outside a
 * transaction block is equivalent to SET for the session, which is not
 * pool-safe). The transaction is kept as short as possible ? connect,
 * set path, query, commit ? so it does not hold locks beyond the read.
 *
 * Use this for one-off tenant reads where a full withTenant() block is
 * heavier than needed (e.g. GET /api/theme).
 */
export async function queryTenantSchema<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  organisationId: string,
  sql: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  // Validate UUID before connecting ? fail fast without a DB round-trip.
  // tenantSchemaIdentifier re-validates, but doing it here avoids an
  // unnecessary connect+rollback for clearly invalid input.
  if (!UUID_V4_RE.test(organisationId)) {
    throw new Error(
      `Invalid organisationId: expected UUID v4, got "${organisationId.slice(0, 36)}"`
    );
  }
  const client = await pool.connect();
  try {
    const schema = tenantSchemaIdentifier(client, organisationId);
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${schema}, public`);
    const result = await client.query<T>(sql, params);
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
// withTenant ? schema-per-tenant transaction context (ADR-0029 ?3b)
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
// SET LOCAL scopes both settings to the current transaction ? pool-safe.
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
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [organisationId]);
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
 * withTenantActor ? tenant + user context (ADR-0029 ?3d)
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
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [organisationId]);
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
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
// withSystemAdmin — cross-tenant RLS bypass (ADR-0029 §3d, ADR-0031, ADR-ACT-0184, ADR-ACT-0189)
//
// RLS bypass uses SET LOCAL ROLE rls_bypass inside the transaction. This changes
// current_user to 'rls_bypass' for the transaction lifetime only, so
// pg_has_role(current_user, 'rls_bypass', 'USAGE') evaluates to true and the
// USAGE-based RLS policies allow cross-tenant access.
//
// Why SET LOCAL ROLE instead of a GUC (ADR-ACT-0184 context, updated ADR-ACT-0189):
//   - The runtime connection (platform_app) is NOINHERIT: it is a MEMBER of rls_bypass
//     but does not automatically inherit its privileges (USAGE = false outside SET ROLE).
//   - SET LOCAL ROLE is transaction-scoped: it reverts on COMMIT or ROLLBACK — pool-safe.
//   - The rls_bypass NOLOGIN role cannot be used as an initial login credential.
//   - Unlike a session GUC, SET LOCAL ROLE cannot be forged by unprivileged SQL
//     unless the connection user is already a member of the target role.
//
// Audit rules:
//   MUTATIONS (INSERT, UPDATE, DELETE): every call that mutates data must be
//   adjacent to an AuditEvent emission. This includes provisioning, membership
//   changes, and config writes.
//
//   READ-ONLY lookups (SELECT only): calls that only read data must emit a
//   structured log entry at info level (caller is responsible). A full audit
//   event is not required for reads, but must not be silently absent.
//
// Never use in request handlers. Only in provisioning, auth system, and
// explicitly-audited administrative read paths.
// ---------------------------------------------------------------------------

export async function withSystemAdmin<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE rls_bypass");
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
// createTenantSchema ? provision a new tenant schema (ADR-0029 ?8, ADR-0031)
//
// Uses the platform DB user (database owner) ? no superuser privilege needed.
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
