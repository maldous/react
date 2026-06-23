/**
 * PostgresTenantDomainRegistry — Postgres-backed TenantDomainRegistryPort
 * over public.tenant_domains (migration 021, ADR-ACT-0232).
 *
 * All mutations are scoped to (organisation_id, domain, disabled_at IS NULL) —
 * a tenant can never mutate another tenant's domain row, and the partial
 * unique index on (domain) WHERE disabled_at IS NULL prevents cross-tenant
 * domain claims at the database level.
 */

import type pg from "pg";
import type {
  DomainOwnershipStatus,
  EnsurePendingResult,
  TenantDomainRecord,
  TenantDomainRegistryPort,
} from "../ports/tenant-domain-registry.ts";
import { loadOperationalTimeoutsConfig } from "../config/operational-timeouts-config.ts";

type PgClient = Pick<pg.PoolClient, "query"> | Pick<pg.Pool, "query">;
type TenantDomainPool = pg.Pool & { connect?: pg.Pool["connect"] };

interface Row {
  organisation_id: string;
  domain: string;
  source: TenantDomainRecord["source"];
  ownership_status: TenantDomainRecord["ownershipStatus"];
  auth_client_status: TenantDomainRecord["authClientStatus"];
  routing_status: TenantDomainRecord["routingStatus"];
  tls_status: TenantDomainRecord["tlsStatus"];
  canonical: boolean;
  redirect_policy: TenantDomainRecord["redirectPolicy"];
  created_at: Date | null;
  verified_at: Date | null;
  auth_client_activated_at: Date | null;
  routing_local_proven_at: Date | null;
  routing_public_proven_at: Date | null;
  tls_local_proven_at: Date | null;
  tls_public_proven_at: Date | null;
  canonical_at: Date | null;
  disabled_at: Date | null;
}

const COLUMNS = `organisation_id, domain, source, ownership_status, auth_client_status,
  routing_status, tls_status, canonical, redirect_policy, created_at, verified_at,
  auth_client_activated_at, routing_local_proven_at, routing_public_proven_at,
  tls_local_proven_at, tls_public_proven_at, canonical_at, disabled_at`;

function configuredStatementTimeoutMs(): number {
  return loadOperationalTimeoutsConfig().tenantDomainPostgresStatementTimeoutMs;
}

async function applyStatementTimeout(client: PgClient, timeoutMs: number): Promise<void> {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
}

async function withDomainStatementTimeout<T>(
  pool: TenantDomainPool,
  timeoutMs: number,
  operation: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (typeof pool.connect !== "function") {
    return operation(pool as unknown as pg.PoolClient);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyStatementTimeout(client, timeoutMs);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const postgresTenantDomainRegistryReliabilityEvidence = {
  configSource:
    "statement timeout is loaded from typed OperationalTimeoutsConfig with a 5000ms default",
  secretSource:
    "tenant domain registry stores domains and lifecycle state only; DNS challenge token creation is owned by vanity-domain-challenge and conflict paths return no token",
  timeout:
    "every registry read/write transaction sets PostgreSQL statement_timeout with set_config(..., true) before domain SQL",
  retry:
    "ensurePending performs one bounded retry only for the documented insert/read race where a conflicting enabled row is disabled between statements",
  degradedMode:
    "Postgres errors propagate as unavailable provider state; cross-tenant ownership uncertainty fails closed as conflict_other_tenant",
  failClosed:
    "ambiguous domain ownership never creates or verifies a claim; ensurePending returns conflict_other_tenant when ownership cannot be established",
  fallbackRationale:
    "no fallback registry exists because tenant-domain ownership must come from the authoritative Postgres tenant_domains partial-unique index",
  healthCheck:
    "healthCheck runs SELECT 1 under the same statement timeout used by tenant-domain registry operations",
  operatorRecovery:
    "operators recover by restoring Postgres connectivity, validating migration 021 tenant_domains indexes, and rerunning tenant-domain claim/canonical proofs",
};

function toRecord(r: Row): TenantDomainRecord {
  return {
    organisationId: r.organisation_id,
    domain: r.domain,
    source: r.source,
    ownershipStatus: r.ownership_status,
    authClientStatus: r.auth_client_status,
    routingStatus: r.routing_status,
    tlsStatus: r.tls_status,
    canonical: r.canonical,
    redirectPolicy: r.redirect_policy,
    createdAt: r.created_at,
    verifiedAt: r.verified_at,
    authClientActivatedAt: r.auth_client_activated_at,
    routingLocalProvenAt: r.routing_local_proven_at,
    routingPublicProvenAt: r.routing_public_proven_at,
    tlsLocalProvenAt: r.tls_local_proven_at,
    tlsPublicProvenAt: r.tls_public_proven_at,
    canonicalAt: r.canonical_at,
    disabledAt: r.disabled_at,
  };
}

export class PostgresTenantDomainRegistry implements TenantDomainRegistryPort {
  private readonly pool: TenantDomainPool;
  private readonly statementTimeoutMs: number;

  constructor(pool: TenantDomainPool, statementTimeoutMs = configuredStatementTimeoutMs()) {
    this.pool = pool;
    this.statementTimeoutMs = statementTimeoutMs;
  }

  async listDomains(organisationId: string): Promise<TenantDomainRecord[]> {
    const rows = await withDomainStatementTimeout(
      this.pool,
      this.statementTimeoutMs,
      async (client) => {
        const result = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.tenant_domains
        WHERE organisation_id = $1 AND disabled_at IS NULL
        ORDER BY domain`,
          [organisationId]
        );
        return result.rows;
      }
    );
    return rows.map(toRecord);
  }

  async getDomain(organisationId: string, domain: string): Promise<TenantDomainRecord | null> {
    const rows = await withDomainStatementTimeout(
      this.pool,
      this.statementTimeoutMs,
      async (client) => {
        const result = await client.query<Row>(
          `SELECT ${COLUMNS} FROM public.tenant_domains
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL
        LIMIT 1`,
          [organisationId, domain.toLowerCase()]
        );
        return result.rows;
      }
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async ensurePending(organisationId: string, domain: string): Promise<EnsurePendingResult> {
    const lower = domain.toLowerCase();
    // ON CONFLICT against the partial unique enabled-domain index keeps the
    // takeover guard at the database level: an existing verified row is never
    // downgraded and another tenant's claim is never overwritten. The result
    // is classified EXPLICITLY (ADR-ACT-0236): a conflicting insert is
    // followed by an ownership read so a cross-tenant claim surfaces as
    // conflict_other_tenant instead of a silent no-op. Two attempts cover the
    // (rare) race where the conflicting row is disabled between the insert
    // and the read; if ownership stays unknowable we fail CLOSED as a
    // conflict — never as an implicit claim.
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await withDomainStatementTimeout(
        this.pool,
        this.statementTimeoutMs,
        async (client) => {
          const inserted = await client.query(
            `INSERT INTO public.tenant_domains (organisation_id, domain, source)
         VALUES ($1, $2, 'custom')
         ON CONFLICT (domain) WHERE disabled_at IS NULL DO NOTHING
         RETURNING organisation_id`,
            [organisationId, lower]
          );
          if ((inserted.rowCount ?? 0) > 0) return { kind: "created" } as EnsurePendingResult;

          const owner = await client.query<{ organisation_id: string }>(
            `SELECT organisation_id FROM public.tenant_domains
          WHERE domain = $1 AND disabled_at IS NULL LIMIT 1`,
            [lower]
          );
          const ownerOrg = owner.rows[0]?.organisation_id;
          if (ownerOrg === organisationId) {
            return { kind: "existing_same_tenant" } as EnsurePendingResult;
          }
          if (ownerOrg !== undefined) {
            return { kind: "conflict_other_tenant" } as EnsurePendingResult;
          }
          return null;
        }
      );
      if (outcome) return outcome;
      // Conflicting row vanished (disabled concurrently) — retry the insert.
    }
    return { kind: "conflict_other_tenant" };
  }

  async markOwnership(
    organisationId: string,
    domain: string,
    status: DomainOwnershipStatus
  ): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET ownership_status = $3,
              verified_at = CASE WHEN $3 = 'verified' THEN COALESCE(verified_at, now()) ELSE verified_at END
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase(), status]
      );
    });
  }

  async markAuthClientActive(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET auth_client_status = 'active',
              auth_client_activated_at = COALESCE(auth_client_activated_at, now())
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async markAuthClientInactive(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET auth_client_status = 'inactive',
              auth_client_activated_at = NULL,
              canonical = false,
              canonical_at = NULL,
              routing_status = 'routing_unknown',
              routing_local_proven_at = NULL,
              routing_public_proven_at = NULL
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async markRoutingLocalActive(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET routing_status = 'routing_local_active',
              routing_local_proven_at = now()
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async setCanonical(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
            SET canonical = false,
                canonical_at = NULL,
                redirect_policy = 'no_redirect'
          WHERE organisation_id = $1 AND canonical AND disabled_at IS NULL`,
        [organisationId]
      );
      await client.query(
        `UPDATE public.tenant_domains
            SET canonical = true,
                canonical_at = now(),
                redirect_policy = 'redirect_slug_to_canonical'
          WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async unsetCanonical(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET canonical = false,
              canonical_at = NULL,
              redirect_policy = 'no_redirect'
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async disable(organisationId: string, domain: string): Promise<void> {
    await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
      await client.query(
        `UPDATE public.tenant_domains
          SET disabled_at = now(),
              canonical = false, canonical_at = NULL
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
    });
  }

  async healthCheck(): Promise<"ready" | "unavailable"> {
    try {
      await withDomainStatementTimeout(this.pool, this.statementTimeoutMs, async (client) => {
        await client.query("SELECT 1");
      });
      return "ready";
    } catch {
      return "unavailable";
    }
  }
}
