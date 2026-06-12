import type pg from "pg";
import type { TenantDomainReadinessResponse, TenantDomainSummary } from "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Tenant custom domains — read + readiness aggregation (ADR-0048 / ADR-ACT-0217)
//
// A thin read/readiness layer over the existing vanity-domain ownership-challenge
// store (`public.vanity_domain_challenges`, migration 014). The mutation plumbing
// already exists: ADR-ACT-0188 (createDomainChallenge / verifyDomainChallenge /
// consumeChallenge) and ADR-ACT-0162 (addVanityDomain / removeVanityDomain).
//
// Honesty rules (ADR-0045):
//   - A domain is `verified` ONLY when DNS-TXT ownership was proven (verified_at).
//   - `routing_active` ONLY when the verified challenge was consumed — i.e. the
//     domain was recorded as added to the tenant auth client. This is a real,
//     persisted fact, NOT a claim that end-to-end traffic flows.
//   - TLS issuance is NOT checked in this pass → always `tls_unknown`.
//   - A read failure surfaces as `degraded`, never a fabricated status.
//
// The row→summary mapping and readiness aggregation are PURE functions so they
// are deterministic and unit-tested; only the two wrappers touch the database.
// ---------------------------------------------------------------------------

export interface DomainChallengeRow {
  domain: string;
  created_at: Date | string | null;
  expires_at: Date | string | null;
  verified_at: Date | string | null;
  consumed_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const txtRecordFor = (domain: string): string => `_aldous-verify.${domain}`;

/**
 * Pure: collapse the (possibly many) challenge rows per domain into one honest
 * summary per domain. A verified+consumed row wins (live), then verified, then
 * the most recent pending row.
 */
export function mapDomainRows(rows: readonly DomainChallengeRow[]): TenantDomainSummary[] {
  const byDomain = new Map<string, DomainChallengeRow[]>();
  for (const row of rows) {
    const key = row.domain.toLowerCase();
    const list = byDomain.get(key) ?? [];
    list.push(row);
    byDomain.set(key, list);
  }

  const summaries: TenantDomainSummary[] = [];
  for (const [domain, domainRows] of byDomain) {
    const verifiedConsumed = domainRows.find((r) => r.verified_at && r.consumed_at);
    const verified = domainRows.find((r) => r.verified_at);
    const representative = verifiedConsumed ?? verified ?? domainRows[0]!;

    const isVerified = !!representative.verified_at;

    summaries.push({
      domain,
      status: isVerified ? "verified" : "pending_dns",
      // TLS is not checked here; the local web Caddy is HTTP-only (Cloudflare terminates
      // public TLS), so neither tls_local_ready nor tls_ready is claimed from DB state.
      tls: "tls_unknown",
      // Routing is NOT inferred from DB state: being added to the auth client
      // (consumed) is not proof that traffic routes. routing_local_active is proven only
      // by proof:tenant-domains-routing; routing_active (public) stays deferred (ADR-ACT-0225).
      routing: "routing_unknown",
      txtRecord: txtRecordFor(domain),
      createdAt: iso(representative.created_at),
      verifiedAt: iso(representative.verified_at),
      expiresAt: iso(representative.expires_at),
    });
  }

  // Stable, deterministic ordering for the admin surface + tests.
  summaries.sort((a, b) => a.domain.localeCompare(b.domain));
  return summaries;
}

/** Pure: aggregate per-domain summaries into the tenant domain readiness. */
export function computeDomainReadiness(
  domains: readonly TenantDomainSummary[]
): TenantDomainReadinessResponse {
  const total = domains.length;
  const verified = domains.filter((d) => d.status === "verified").length;
  const pending = domains.filter((d) => d.status === "pending_dns").length;
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

async function loadDomainRows(
  pool: pg.Pool,
  organisationId: string
): Promise<DomainChallengeRow[]> {
  const { rows } = await pool.query<DomainChallengeRow>(
    `SELECT domain, created_at, expires_at, verified_at, consumed_at
       FROM public.vanity_domain_challenges
      WHERE organisation_id = $1
      ORDER BY created_at DESC`,
    [organisationId]
  );
  return rows;
}

/** `GET /api/org/domains` — list the tenant's custom domains. */
export async function listTenantDomains(
  organisationId: string,
  pool: pg.Pool
): Promise<TenantDomainSummary[]> {
  return mapDomainRows(await loadDomainRows(pool, organisationId));
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
