/**
 * Tenant domain canonical lifecycle runtime proof (ADR-ACT-0232).
 *
 * Proves the canonical state machine against the LIVE local Postgres:
 *   1. canonical is REFUSED until ownership is verified, the auth client is
 *      active, and routing is proven (guards, in order)
 *   2. canonical succeeds for a fully proven domain; redirect policy stays
 *      no_redirect (no redirect behaviour exists — none is claimed)
 *   3. setting canonical on a second domain atomically replaces the first
 *      (≤1 canonical per tenant, enforced by the partial unique index too)
 *   4. unset clears the flag
 *   5. deactivation clears canonical + routing claims
 *
 * The Keycloak mutation is a no-op port here — this proof targets the
 * registry/guard machinery, not Keycloak (covered by proof:auth-settings).
 * LOCAL-ONLY proof; routing states are seeded as locally proven and labelled so.
 *
 * Usage: npm run proof:tenant-domain-canonical
 */

import crypto from "node:crypto";
import pg from "pg";
import type { AuditEventPort } from "@platform/audit-events";
import { PostgresTenantDomainRegistry } from "../src/adapters/postgres-tenant-domain-registry.ts";
import {
  activateDomainAuthClient,
  deactivateDomainAuthClient,
  setCanonicalDomain,
  unsetCanonicalDomain,
  type AuthClientDomainPort,
} from "../src/usecases/tenant-domain-lifecycle.ts";

const POSTGRES_URL =
  process.env["POSTGRES_URL"] ?? "postgresql://platform:platformpassword@localhost:5433/platform";

const noopAudit: AuditEventPort = { emit: async () => {} };
const noopAuthClient: AuthClientDomainPort = {
  addRedirectOrigin: async () => {},
  removeRedirectOrigin: async () => {},
};

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Tenant domain canonical lifecycle runtime proof\n");

  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const registry = new PostgresTenantDomainRegistry(pool);
  const run = crypto.randomBytes(4).toString("hex");
  const d1 = `one-${run}.canonical-proof.test`;
  const d2 = `two-${run}.canonical-proof.test`;

  try {
    const org = await pool.query<{ id: string }>(
      "SELECT id FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const orgId = org.rows[0]?.id;
    if (!orgId) {
      console.log("SKIP  no organisation seeded (run `make seed-demo`)");
      process.exit(0);
    }
    const actor = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };
    const deps = { registry, audit: noopAudit };

    // Seed two pending registry rows.
    await registry.ensurePending(orgId, d1);
    await registry.ensurePending(orgId, d2);

    // 1. Guards, in order.
    let r = await setCanonicalDomain({ organisationId: orgId, domain: d1, ...actor }, deps);
    check("canonical refused while ownership pending", r.kind === "not_verified", r.kind);

    await registry.markOwnership(orgId, d1, "verified");
    r = await setCanonicalDomain({ organisationId: orgId, domain: d1, ...actor }, deps);
    check(
      "canonical refused while auth client inactive",
      r.kind === "auth_client_inactive",
      r.kind
    );

    const act = await activateDomainAuthClient(
      { organisationId: orgId, domain: d1, ...actor },
      { ...deps, authClient: noopAuthClient }
    );
    check("activation succeeds for a verified domain", act.kind === "ok", act.kind);

    r = await setCanonicalDomain({ organisationId: orgId, domain: d1, ...actor }, deps);
    check("canonical refused while routing unproven", r.kind === "routing_not_proven", r.kind);

    // 2. Fully proven (LOCAL routing) → canonical ok; policy stays no_redirect.
    await registry.markRoutingLocalActive(orgId, d1);
    r = await setCanonicalDomain({ organisationId: orgId, domain: d1, ...actor }, deps);
    check(
      "canonical set for verified+active+locally-routed domain (local-only label)",
      r.kind === "ok" && r.record.canonical === true
    );
    check(
      "redirect policy stays no_redirect (no redirect behaviour claimed)",
      r.kind === "ok" && r.record.redirectPolicy === "no_redirect"
    );
    // ADR-ACT-0236: canonical is a MARKER — it never upgrades routing/TLS
    // readiness (no public cutover is implied by setting it).
    check(
      "canonical does NOT upgrade routing/TLS readiness (marker only)",
      r.kind === "ok" &&
        r.record.routingStatus === "routing_local_active" &&
        r.record.tlsStatus === "tls_unknown" &&
        r.record.routingPublicProvenAt === null &&
        r.record.tlsPublicProvenAt === null
    );

    // 3. Second canonical replaces the first atomically.
    await registry.markOwnership(orgId, d2, "verified");
    await activateDomainAuthClient(
      { organisationId: orgId, domain: d2, ...actor },
      { ...deps, authClient: noopAuthClient }
    );
    await registry.markRoutingLocalActive(orgId, d2);
    const r2 = await setCanonicalDomain({ organisationId: orgId, domain: d2, ...actor }, deps);
    const after1 = await registry.getDomain(orgId, d1);
    check(
      "second canonical replaces the first (≤1 canonical per tenant)",
      r2.kind === "ok" && r2.record.canonical === true && after1?.canonical === false
    );
    const canonCount = await pool.query(
      "SELECT count(*)::int AS n FROM public.tenant_domains WHERE organisation_id = $1 AND canonical AND disabled_at IS NULL",
      [orgId]
    );
    check("exactly one canonical row in the registry", canonCount.rows[0]?.n === 1);

    // 4. Unset clears the flag.
    const un = await unsetCanonicalDomain({ organisationId: orgId, domain: d2, ...actor }, deps);
    check("unset canonical clears the flag", un.kind === "ok" && un.record.canonical === false);

    // 5. Deactivation clears canonical + routing claims.
    await setCanonicalDomain({ organisationId: orgId, domain: d1, ...actor }, deps);
    const de = await deactivateDomainAuthClient(
      { organisationId: orgId, domain: d1, ...actor },
      { ...deps, authClient: noopAuthClient }
    );
    const after = await registry.getDomain(orgId, d1);
    check(
      "deactivation clears canonical and resets routing to unknown",
      de.kind === "ok" &&
        after?.authClientStatus === "inactive" &&
        after?.canonical === false &&
        after?.routingStatus === "routing_unknown"
    );
  } finally {
    await pool.query(
      "DELETE FROM public.tenant_domains WHERE domain LIKE '%.canonical-proof.test'"
    );
    await pool.end();
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
