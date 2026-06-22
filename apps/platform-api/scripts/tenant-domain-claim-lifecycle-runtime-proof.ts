/**
 * Tenant domain-claim lifecycle runtime proof (ADR-ACT-0236). LOCAL-ONLY.
 *
 * Proves the cross-tenant claim conflict machinery against the LIVE local
 * Postgres (real tenant_domains + vanity_domain_challenges tables, real
 * partial-unique takeover guard; DNS is an injected fake resolver):
 *
 *   1. tenant A claims a domain (challenge issued, token returned)
 *   2. tenant A verifies via DNS TXT (fake resolver returns A's token)
 *   3. tenant B CANNOT receive a token for the same enabled domain
 *      (409 DOMAIN_ALREADY_CLAIMED semantics; conflict response carries no
 *      token / no DNS material)
 *   4. tenant B CANNOT verify it (refused before any DNS lookup)
 *   5. tenant B CANNOT activate it (registry row invisible cross-tenant)
 *   6. tenant A remains the verified owner throughout
 *   7. DOCUMENTED POLICY: disabling tenant A's claim frees the domain — the
 *      partial unique index only guards ENABLED rows, so tenant B may then
 *      claim it (history for A is retained, disabled)
 *   8. no token/secret leakage in any conflict outcome
 *
 * Usage: npm run proof:tenant-domain-claim-lifecycle   (Postgres up)
 */

import crypto from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import type { AuditEventPort, AuditEvent } from "@platform/audit-events";
import { PostgresTenantDomainRegistry } from "../src/adapters/postgres-tenant-domain-registry.ts";
import {
  createDomainChallenge,
  verifyDomainChallenge,
  type DnsResolverPort,
} from "../src/usecases/vanity-domain-challenge.ts";
import {
  activateDomainAuthClient,
  type AuthClientDomainPort,
} from "../src/usecases/tenant-domain-lifecycle.ts";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

async function main(): Promise<void> {
  console.log("# Tenant domain-claim lifecycle runtime proof\n");
  loadLocalEnv();
  const POSTGRES_URL = requireEnv("POSTGRES_URL");
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const registry = new PostgresTenantDomainRegistry(pool);

  const run = crypto.randomBytes(4).toString("hex");
  const domain = `claim-${run}.claim-proof.test`;
  const slugA = `claim-proof-a-${run}`;
  const slugB = `claim-proof-b-${run}`;
  const auditEvents: AuditEvent[] = [];
  const audit: AuditEventPort = {
    emit: async (e) => {
      auditEvents.push(e);
    },
    query: async () => [],
  };
  const noopAuthClient: AuthClientDomainPort = {
    addRedirectOrigin: async () => {},
    removeRedirectOrigin: async () => {},
  };
  const actor = { actorId: "00000000-0000-0000-0000-000000000000", actorRoles: ["tenant-admin"] };

  let orgA: string | null = null;
  let orgB: string | null = null;
  try {
    const a = await pool.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'Claim Proof A') RETURNING id`,
      [slugA]
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'Claim Proof B') RETURNING id`,
      [slugB]
    );
    orgA = a.rows[0]!.id;
    orgB = b.rows[0]!.id;

    // 1. Tenant A claims the domain.
    const aCreate = await createDomainChallenge(
      { domain, organisationId: orgA, ...actor },
      { audit, pool }
    );
    check("tenant A receives a challenge token", aCreate.kind === "ok" && aCreate.token.length > 0);
    const aToken = aCreate.kind === "ok" ? aCreate.token : "";

    // 2. Tenant A verifies (fake DNS returns A's token — DNS-shape only; the
    // registry/challenge tables are the REAL local Postgres).
    const dnsWithA: DnsResolverPort = { resolveTxt: async () => [[aToken]] };
    const aVerify = await verifyDomainChallenge(
      { domain, organisationId: orgA, ...actor },
      { audit, pool, dns: dnsWithA }
    );
    check("tenant A verifies ownership", aVerify.kind === "ok", aVerify.kind);
    const aRecord = await registry.getDomain(orgA, domain);
    check("tenant A registry row is verified", aRecord?.ownershipStatus === "verified");

    // 3. Tenant B cannot receive a token for the same enabled domain.
    const bCreate = await createDomainChallenge(
      { domain, organisationId: orgB, ...actor },
      { audit, pool }
    );
    check(
      "tenant B challenge is REFUSED (domain_already_claimed → 409)",
      bCreate.kind === "domain_already_claimed",
      bCreate.kind
    );
    check("tenant B conflict response carries NO token", !("token" in bCreate));
    const bChallenges = await pool.query(
      `SELECT count(*)::int AS n FROM public.vanity_domain_challenges WHERE organisation_id = $1 AND domain = $2`,
      [orgB, domain]
    );
    check("no challenge row was written for tenant B", bChallenges.rows[0]?.n === 0);

    // 4. Tenant B cannot verify it (even with A's token visible in DNS).
    const bVerify = await verifyDomainChallenge(
      { domain, organisationId: orgB, ...actor },
      { audit, pool, dns: dnsWithA }
    );
    check(
      "tenant B verification is REFUSED (not_found/conflict, never ok)",
      bVerify.kind !== "ok",
      bVerify.kind
    );

    // 5. Tenant B cannot activate it (registry row invisible cross-tenant).
    const bActivate = await activateDomainAuthClient(
      { organisationId: orgB, domain, ...actor },
      { registry, audit, authClient: noopAuthClient }
    );
    check("tenant B activation is refused", bActivate.kind === "not_found", bActivate.kind);

    // 6. Tenant A remains the verified owner.
    const aAfter = await registry.getDomain(orgA, domain);
    check(
      "tenant A remains the verified owner",
      aAfter?.ownershipStatus === "verified" && aAfter.organisationId === orgA
    );

    // 7. Documented policy: disabling A's claim FREES the domain for B (the
    // takeover guard covers ENABLED rows only; A's history is retained).
    await registry.disable(orgA, domain);
    const bRetry = await createDomainChallenge(
      { domain, organisationId: orgB, ...actor },
      { audit, pool }
    );
    check(
      "after A disables its claim, B may claim the domain (documented policy)",
      bRetry.kind === "ok"
    );
    const bRecord = await registry.getDomain(orgB, domain);
    check(
      "B's new claim starts pending_dns (no inherited verification)",
      bRecord?.ownershipStatus === "pending_dns"
    );
    const aDisabled = await pool.query(
      `SELECT count(*)::int AS n FROM public.tenant_domains WHERE organisation_id = $1 AND domain = $2 AND disabled_at IS NOT NULL`,
      [orgA, domain]
    );
    check("A's disabled claim history is retained", aDisabled.rows[0]?.n === 1);

    // 8. No token/secret leakage in conflict outcomes or audit metadata.
    const conflictEvents = auditEvents.filter(
      (e) => e.action === "tenant_domains.challenge.rejected_conflict"
    );
    check("conflict rejections are audited", conflictEvents.length >= 1);
    check(
      "no DNS token leaks into conflict results or audit metadata",
      !JSON.stringify(conflictEvents).includes(aToken) &&
        !JSON.stringify(bCreate).includes(aToken) &&
        !JSON.stringify(bVerify).includes(aToken)
    );
  } catch (err) {
    check("claim lifecycle", false, err instanceof Error ? err.message : String(err));
  } finally {
    await pool
      .query(`DELETE FROM public.tenant_domains WHERE domain = $1`, [domain])
      .catch(() => {});
    await pool
      .query(`DELETE FROM public.vanity_domain_challenges WHERE domain = $1`, [domain])
      .catch(() => {});
    for (const org of [orgA, orgB]) {
      if (org)
        await pool.query(`DELETE FROM public.organisations WHERE id = $1`, [org]).catch(() => {});
    }
    await pool.end();
  }

  console.log(
    failures === 0 ? "\n# ALL CHECKS PASSED (local-only proof)" : `\n# ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
