import type pg from "pg";
import type { TenantDomainReadinessResponse, TenantDomainSummary } from "@platform/contracts-admin";
import type { TenantDomainRecord } from "../ports/tenant-domain-registry.ts";
import { PostgresTenantDomainRegistry } from "../adapters/postgres-tenant-domain-registry.ts";

// ---------------------------------------------------------------------------
// Tenant custom domains — read + readiness aggregation (ADR-0048 / ADR-ACT-0217,
// reworked over the tenant_domains lifecycle registry in ADR-ACT-0232).
//
// The registry (migration 021) is the durable source of truth for ownership /
// auth-client / routing / TLS / canonical state; vanity_domain_challenges
// remains the DNS-ownership-proof mechanism (its active-challenge expiry is
// surfaced per domain).
//
// Honesty rules (ADR-0045):
//   - `verified` ONLY when DNS-TXT ownership was proven (challenge flow).
//   - `authClient: active` ONLY after the Keycloak client mutation succeeded.
//   - routing/TLS statuses come from PERSISTED live-probe outcomes only —
//     `routing_local_active` is written by the local probe (labelled local),
//     `routing_active`/`tls_*` remain reserved for public proofs (deferred).
//   - A read failure surfaces as `degraded`, never a fabricated status.
//
// The record→summary mapping and readiness aggregation are PURE functions;
// only the wrappers touch the database.
// ---------------------------------------------------------------------------

const txtRecordFor = (domain: string): string => `_aldous-verify.${domain}`;

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Pure: registry records (+ per-domain active-challenge expiry) → summaries. */
export function mapRegistryRecords(
  records: readonly TenantDomainRecord[],
  challengeExpiries: ReadonlyMap<string, Date | string | null> = new Map()
): TenantDomainSummary[] {
  return records.map((r) => ({
    domain: r.domain,
    source: r.source,
    status: r.ownershipStatus,
    authClient: r.authClientStatus,
    tls: r.tlsStatus,
    routing: r.routingStatus,
    canonical: r.canonical,
    redirectPolicy: r.redirectPolicy,
    txtRecord: txtRecordFor(r.domain),
    createdAt: iso(r.createdAt),
    verifiedAt: iso(r.verifiedAt),
    expiresAt: iso(challengeExpiries.get(r.domain) ?? null),
    authClientActivatedAt: iso(r.authClientActivatedAt),
    routingLocalProvenAt: iso(r.routingLocalProvenAt),
    routingPublicProvenAt: iso(r.routingPublicProvenAt),
    tlsLocalProvenAt: iso(r.tlsLocalProvenAt),
    tlsPublicProvenAt: iso(r.tlsPublicProvenAt),
    canonicalAt: iso(r.canonicalAt),
  }));
}

/** Pure: aggregate per-domain summaries into the tenant domain readiness. */
export function computeDomainReadiness(
  domains: readonly TenantDomainSummary[]
): TenantDomainReadinessResponse {
  const total = domains.length;
  const verified = domains.filter((d) => d.status === "verified").length;
  const pending = domains.filter((d) => d.status !== "verified").length;
  let status: TenantDomainReadinessResponse["status"];
  if (total === 0) status = "no_domains";
  else if (verified > 0) status = "verified";
  else status = "pending_verification";
  return { status, total, verified, pending };
}

/** A local-routing probe outcome (ADR-ACT-0225): did the tenant FQDN reach the right
 * tenant context through the local reverse proxy? */
export interface LocalRoutingProbe {
  /** The local proxy (Caddy) returned an HTTP response for the tenant FQDN. */
  reachable: boolean;
  /** The response reflected the EXPECTED tenant context (not the apex / another tenant). */
  tenantContextMatched: boolean;
}

/**
 * Pure: classify a local-routing probe. `routing_local_active` ONLY when the proxy is
 * reachable AND the response proved the correct tenant context; otherwise
 * `routing_unknown`. Public `routing_active` is never inferred locally (ADR-ACT-0225).
 */
export function classifyLocalRouting(
  p: LocalRoutingProbe
): import("@platform/contracts-admin").TenantDomainRoutingStatus {
  return p.reachable && p.tenantContextMatched ? "routing_local_active" : "routing_unknown";
}

async function loadChallengeExpiries(
  pool: pg.Pool,
  organisationId: string
): Promise<Map<string, Date | null>> {
  const { rows } = await pool.query<{ domain: string; expires_at: Date | null }>(
    `SELECT DISTINCT ON (domain) domain, expires_at
       FROM public.vanity_domain_challenges
      WHERE organisation_id = $1 AND consumed_at IS NULL
      ORDER BY domain, created_at DESC`,
    [organisationId]
  );
  return new Map(rows.map((r) => [r.domain, r.expires_at]));
}

/** `GET /api/org/domains` — list the tenant's custom domains (registry-backed). */
export async function listTenantDomains(
  organisationId: string,
  pool: pg.Pool
): Promise<TenantDomainSummary[]> {
  const registry = new PostgresTenantDomainRegistry(pool);
  const [records, expiries] = await Promise.all([
    registry.listDomains(organisationId),
    loadChallengeExpiries(pool, organisationId),
  ]);
  return mapRegistryRecords(records, expiries);
}

/** `GET /api/org/domains/readiness` — honest aggregate; `degraded` on read failure. */
export async function getTenantDomainReadiness(
  organisationId: string,
  pool: pg.Pool
): Promise<TenantDomainReadinessResponse> {
  try {
    return computeDomainReadiness(await listTenantDomains(organisationId, pool));
  } catch {
    return { status: "degraded", total: 0, verified: 0, pending: 0 };
  }
}
