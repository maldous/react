import crypto from "node:crypto";
import pg from "pg";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { PostgresTenantDomainRegistry } from "../adapters/postgres-tenant-domain-registry.ts";
import type { TenantDomainRegistryPort } from "../ports/tenant-domain-registry.ts";

// ---------------------------------------------------------------------------
// Vanity domain ownership challenge (ADR-ACT-0188)
//
// Proves domain ownership before adding a custom domain to the tenant's
// Keycloak BFF client redirect_uris/web_origins.
//
// Lifecycle:
//   1. POST /api/auth/settings/domains/challenges  — creates a challenge
//   2. Tenant configures DNS TXT record:
//        _aldous-verify.<domain>  =  <token>
//   3. POST /api/auth/settings/domains/verify  — DNS lookup, marks verified
//   4. POST /api/auth/settings/domains  — requires verified challenge
//
// DNS resolver is injected as a port so tests can use a fake resolver.
// ---------------------------------------------------------------------------

export interface DnsResolverPort {
  resolveTxt(hostname: string): Promise<string[][]>;
}

export const defaultDnsResolver: DnsResolverPort = {
  async resolveTxt(hostname: string): Promise<string[][]> {
    const dns = await import("node:dns/promises");
    return new dns.Resolver().resolveTxt(hostname);
  },
};

export interface ChallengeDeps {
  audit: AuditEventPort;
  pool: pg.Pool;
  dns?: DnsResolverPort;
  /** Lifecycle registry override (tests/proofs); defaults to the Postgres adapter. */
  registry?: TenantDomainRegistryPort;
}

// Inline domain validation (same rules as vanity-domain.ts:validateDomain)
function validateDomain(domain: string): { ok: true } | { ok: false; message: string } {
  const lower = domain.toLowerCase();
  if (lower.length > 253 || !lower.includes(".")) {
    return { ok: false, message: "invalid domain format" };
  }
  const labelRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of lower.split(".")) {
    if (!label || !labelRe.test(label)) {
      return { ok: false, message: "invalid domain format" };
    }
  }
  if (lower.split(".").every((l) => /^\d+$/.test(l))) {
    return { ok: false, message: "IP literals are not allowed" };
  }
  return { ok: true };
}

export type CreateChallengeResult =
  | { kind: "ok"; token: string; txtRecord: string }
  | { kind: "invalid_domain"; message: string }
  /** The domain is enabled for ANOTHER tenant (ADR-ACT-0236). No token is
   * issued — the conflict is explicit, mapped to 409 DOMAIN_ALREADY_CLAIMED. */
  | { kind: "domain_already_claimed" };

export type VerifyChallengeResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_verified" }
  | { kind: "dns_not_found" }
  | { kind: "dns_mismatch" }
  /** Another tenant holds the enabled registry row for this domain — never
   * verifiable here, regardless of DNS state (ADR-ACT-0236). */
  | { kind: "domain_already_claimed" };

export async function createDomainChallenge(
  input: {
    domain: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: ChallengeDeps
): Promise<CreateChallengeResult> {
  const validation = validateDomain(input.domain);
  if (!validation.ok) return { kind: "invalid_domain", message: validation.message };

  const domain = input.domain.toLowerCase();
  const registry = deps.registry ?? new PostgresTenantDomainRegistry(deps.pool);

  // Lifecycle registry sync FIRST (ADR-ACT-0232/0236): a domain enabled for
  // another tenant is rejected BEFORE a token exists — the caller never
  // receives a DNS challenge it could not possibly verify, and the conflict
  // is explicit (409), not a misleading pending_dns.
  const ensured = await registry.ensurePending(input.organisationId, domain);
  if (ensured.kind === "conflict_other_tenant") {
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actorId,
        actorRoles: input.actorRoles,
        tenantId: input.organisationId,
        action: "tenant_domains.challenge.rejected_conflict",
        resource: "auth_settings",
        resourceId: domain,
        // Safe metadata only: the domain (a public DNS name) and the reason.
        // Never the owning tenant's identity, and there is no token to leak.
        metadata: { domain, reason: "domain_already_claimed" },
      })
    );
    return { kind: "domain_already_claimed" };
  }

  const token = crypto.randomBytes(24).toString("hex");

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.VanityDomainChallengeCreated,
      resource: "auth_settings",
      resourceId: domain,
      metadata: { domain, txtRecord: `_aldous-verify.${domain}` },
    })
  );

  // Invalidate any existing active challenge for this domain+org
  await deps.pool.query(
    `UPDATE public.vanity_domain_challenges
     SET consumed_at = now()
     WHERE organisation_id = $1 AND domain = $2 AND consumed_at IS NULL`,
    [input.organisationId, domain]
  );

  await deps.pool.query(
    `INSERT INTO public.vanity_domain_challenges (organisation_id, domain, token)
     VALUES ($1, $2, $3)`,
    [input.organisationId, domain, token]
  );

  return { kind: "ok", token, txtRecord: `_aldous-verify.${domain}` };
}

export async function verifyDomainChallenge(
  input: {
    domain: string;
    organisationId: string;
    actorId: string;
    actorRoles: string[];
  },
  deps: ChallengeDeps
): Promise<VerifyChallengeResult> {
  const domain = input.domain.toLowerCase();
  const resolver = deps.dns ?? defaultDnsResolver;

  const { rows } = await deps.pool.query<{
    id: string;
    token: string;
    expires_at: Date;
    verified_at: Date | null;
  }>(
    `SELECT id, token, expires_at, verified_at
     FROM public.vanity_domain_challenges
     WHERE organisation_id = $1 AND domain = $2
       AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [input.organisationId, domain]
  );

  if (rows.length === 0) return { kind: "not_found" };
  const challenge = rows[0]!;

  if (new Date(challenge.expires_at) < new Date()) return { kind: "expired" };
  if (challenge.verified_at) return { kind: "already_verified" };

  const registry = deps.registry ?? new PostgresTenantDomainRegistry(deps.pool);

  // Lifecycle row gate (ADR-ACT-0236): verification can only succeed when THIS
  // tenant holds the enabled tenant_domains row. A domain enabled for another
  // tenant is an explicit conflict — refused BEFORE any DNS lookup, so a stale
  // challenge can never "verify" a domain this tenant does not own in the
  // registry. ensurePending is idempotent and never downgrades a verified row.
  const ensured = await registry.ensurePending(input.organisationId, domain);
  if (ensured.kind === "conflict_other_tenant") {
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actorId,
        actorRoles: input.actorRoles,
        tenantId: input.organisationId,
        action: "tenant_domains.challenge.rejected_conflict",
        resource: "auth_settings",
        resourceId: domain,
        metadata: { domain, reason: "domain_already_claimed", phase: "verify" },
      })
    );
    return { kind: "domain_already_claimed" };
  }

  const txtRecords = await resolver.resolveTxt(`_aldous-verify.${domain}`).catch(() => []);
  const flatRecords = txtRecords.flat();
  if (flatRecords.length === 0) return { kind: "dns_not_found" };
  if (!flatRecords.some((r) => r.includes(challenge.token))) {
    // Persist the transient mismatch so the admin surface can show it
    // honestly (ADR-ACT-0232). Never downgrades a verified row.
    await registry
      .getDomain(input.organisationId, domain)
      .then(async (rec) => {
        if (rec && rec.ownershipStatus !== "verified") {
          await registry.markOwnership(input.organisationId, domain, "dns_mismatch");
        }
      })
      .catch(() => undefined);
    return { kind: "dns_mismatch" };
  }

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.VanityDomainVerified,
      resource: "auth_settings",
      resourceId: domain,
      metadata: { domain },
    })
  );

  await deps.pool.query(
    "UPDATE public.vanity_domain_challenges SET verified_at = now() WHERE id = $1",
    [challenge.id]
  );

  // Lifecycle registry sync (ADR-ACT-0232): DNS ownership proven. The row is
  // guaranteed to exist for THIS tenant (ensurePending gate above).
  await registry.markOwnership(input.organisationId, domain, "verified");

  return { kind: "ok" };
}

/** Returns true if an active, verified, unconsumed challenge exists for this domain+org. */
export async function checkDomainOwnership(
  domain: string,
  organisationId: string,
  pool: pg.Pool
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id FROM public.vanity_domain_challenges
     WHERE organisation_id = $1 AND domain = $2
       AND verified_at IS NOT NULL
       AND consumed_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [organisationId, domain]
  );
  return rows.length > 0;
}

/** Mark challenge as consumed after domain is successfully added to Keycloak. */
export async function consumeChallenge(
  domain: string,
  organisationId: string,
  pool: pg.Pool
): Promise<void> {
  await pool.query(
    `UPDATE public.vanity_domain_challenges
     SET consumed_at = now()
     WHERE organisation_id = $1 AND domain = $2
       AND verified_at IS NOT NULL AND consumed_at IS NULL`,
    [organisationId, domain]
  );
}
