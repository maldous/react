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
  TenantDomainRecord,
  TenantDomainRegistryPort,
} from "../ports/tenant-domain-registry.ts";

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
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async listDomains(organisationId: string): Promise<TenantDomainRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM public.tenant_domains
        WHERE organisation_id = $1 AND disabled_at IS NULL
        ORDER BY domain`,
      [organisationId]
    );
    return rows.map(toRecord);
  }

  async getDomain(organisationId: string, domain: string): Promise<TenantDomainRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM public.tenant_domains
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL
        LIMIT 1`,
      [organisationId, domain.toLowerCase()]
    );
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async ensurePending(organisationId: string, domain: string): Promise<void> {
    // ON CONFLICT against the partial unique enabled-domain index: if the
    // domain is already enabled (for this OR another tenant) the insert
    // no-ops — an existing verified row is never downgraded, and another
    // tenant's claim is never overwritten (activation guards catch the
    // cross-tenant case because getDomain() returns null for this org).
    await this.pool.query(
      `INSERT INTO public.tenant_domains (organisation_id, domain, source)
       VALUES ($1, $2, 'custom')
       ON CONFLICT (domain) WHERE disabled_at IS NULL DO NOTHING`,
      [organisationId, domain.toLowerCase()]
    );
  }

  async markOwnership(
    organisationId: string,
    domain: string,
    status: DomainOwnershipStatus
  ): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_domains
          SET ownership_status = $3,
              verified_at = CASE WHEN $3 = 'verified' THEN COALESCE(verified_at, now()) ELSE verified_at END
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
      [organisationId, domain.toLowerCase(), status]
    );
  }

  async markAuthClientActive(organisationId: string, domain: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_domains
          SET auth_client_status = 'active',
              auth_client_activated_at = COALESCE(auth_client_activated_at, now())
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
      [organisationId, domain.toLowerCase()]
    );
  }

  async markAuthClientInactive(organisationId: string, domain: string): Promise<void> {
    await this.pool.query(
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
  }

  async markRoutingLocalActive(organisationId: string, domain: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_domains
          SET routing_status = 'routing_local_active',
              routing_local_proven_at = now()
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
      [organisationId, domain.toLowerCase()]
    );
  }

  async setCanonical(organisationId: string, domain: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE public.tenant_domains
            SET canonical = false, canonical_at = NULL
          WHERE organisation_id = $1 AND canonical AND disabled_at IS NULL`,
        [organisationId]
      );
      await client.query(
        `UPDATE public.tenant_domains
            SET canonical = true, canonical_at = now()
          WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
        [organisationId, domain.toLowerCase()]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async unsetCanonical(organisationId: string, domain: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_domains
          SET canonical = false, canonical_at = NULL
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
      [organisationId, domain.toLowerCase()]
    );
  }

  async disable(organisationId: string, domain: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.tenant_domains
          SET disabled_at = now(),
              canonical = false, canonical_at = NULL
        WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NULL`,
      [organisationId, domain.toLowerCase()]
    );
  }
}
