/**
 * Tenant Custom Domains runtime proof (ADR-0048 / ADR-ACT-0217).
 *
 * Exercises the full custom-domain lifecycle against the LIVE local Postgres
 * (`make compose-up-default`): create an ownership challenge → verify it →
 * list domains → aggregate readiness, all through the real use cases and SQL.
 *
 * Honest scope: the DNS *resolver* is a port and is stubbed here with the
 * expected token — this proves the challenge/verify/list/readiness SQL +
 * classification against a real database. Resolving a real public DNS TXT
 * record is NOT part of the local proof (no controllable public domain in the
 * local stack); that remains covered by the bounded resolver in production and
 * is documented as deferred. TLS issuance + live routing are not claimed.
 *
 *   1. pure readiness classifier — representative honest verdicts
 *   2. live DB: create challenge → verify (stub resolver) → listed as verified
 *   3. live DB: readiness aggregates to `verified`
 *   4. cleanup the proof challenge rows
 *
 * Usage: npm run proof:tenant-domains
 */

import pg from "pg";
import { requireEnv } from "./lib/local-env.ts";
import {
  computeDomainReadiness,
  getTenantDomainReadiness,
  listTenantDomains,
  mapRegistryRecords,
} from "../src/usecases/tenant-domains.ts";
import {
  createDomainChallenge,
  verifyDomainChallenge,
  type DnsResolverPort,
} from "../src/usecases/vanity-domain-challenge.ts";
import type { AuditEventPort } from "@platform/audit-events";

const POSTGRES_URL = requireEnv("POSTGRES_URL");

const noopAudit: AuditEventPort = { emit: async () => {} };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Tenant custom domains runtime proof\n");

  // 1. Pure classifier — honest verdicts (no DB).
  check(
    "pending registry row → pending_dns / inactive / routing_unknown / tls_unknown",
    (() => {
      const [d] = mapRegistryRecords([
        {
          organisationId: "org",
          domain: "x.proof.test",
          source: "custom",
          ownershipStatus: "pending_dns",
          authClientStatus: "inactive",
          routingStatus: "routing_unknown",
          tlsStatus: "tls_unknown",
          canonical: false,
          redirectPolicy: "no_redirect",
          createdAt: new Date(),
          verifiedAt: null,
          authClientActivatedAt: null,
          routingLocalProvenAt: null,
          routingPublicProvenAt: null,
          tlsLocalProvenAt: null,
          tlsPublicProvenAt: null,
          canonicalAt: null,
          disabledAt: null,
        },
      ]);
      return (
        d?.status === "pending_dns" &&
        d?.authClient === "inactive" &&
        d?.routing === "routing_unknown" &&
        d?.tls === "tls_unknown"
      );
    })()
  );
  check("no domains → no_domains readiness", computeDomainReadiness([]).status === "no_domains");

  // 2/3. Live DB lifecycle (requires a seeded organisation).
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const proofDomain = `proof-${Date.now()}.aldous-domains-proof.test`;
  try {
    const org = await pool.query<{ id: string }>(
      "SELECT id FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const organisationId = org.rows[0]?.id;
    if (!organisationId) {
      console.log("SKIP  live DB lifecycle — no organisation seeded (run `make seed-demo`)");
    } else {
      const created = await createDomainChallenge(
        {
          domain: proofDomain,
          organisationId,
          actorId: "00000000-0000-0000-0000-000000000000",
          actorRoles: ["tenant-admin"],
        },
        { audit: noopAudit, pool }
      );
      check(
        "challenge created with a public TXT token",
        created.kind === "ok" && !!("token" in created && created.token)
      );

      const token = created.kind === "ok" ? created.token : "";
      const stubResolver: DnsResolverPort = {
        resolveTxt: async (hostname: string) =>
          hostname === `_aldous-verify.${proofDomain}` ? [[token]] : [],
      };
      const verified = await verifyDomainChallenge(
        {
          domain: proofDomain,
          organisationId,
          actorId: "00000000-0000-0000-0000-000000000000",
          actorRoles: ["tenant-admin"],
        },
        { audit: noopAudit, pool, dns: stubResolver }
      );
      check("DNS-TXT verification succeeds (stub resolver)", verified.kind === "ok");

      const domains = await listTenantDomains(organisationId, pool);
      const entry = domains.find((d) => d.domain === proofDomain);
      check("listed as verified after ownership proof", entry?.status === "verified");
      check(
        "auth client stays inactive until explicit activation (ADR-ACT-0232)",
        entry?.authClient === "inactive" && entry?.routing === "routing_unknown"
      );

      const readiness = await getTenantDomainReadiness(organisationId, pool);
      check("readiness aggregates to verified", readiness.status === "verified", readiness.status);

      // 4. cleanup
      await pool.query("DELETE FROM public.vanity_domain_challenges WHERE domain = $1", [
        proofDomain,
      ]);
      await pool.query("DELETE FROM public.tenant_domains WHERE domain = $1", [proofDomain]);
      const left = await pool.query(
        "SELECT 1 FROM public.vanity_domain_challenges WHERE domain = $1",
        [proofDomain]
      );
      check("proof challenge rows cleaned up", left.rowCount === 0);
    }
  } catch (err) {
    check("live DB lifecycle", false, err instanceof Error ? err.message : String(err));
    await pool
      .query("DELETE FROM public.vanity_domain_challenges WHERE domain = $1", [proofDomain])
      .catch(() => {});
    await pool
      .query("DELETE FROM public.tenant_domains WHERE domain = $1", [proofDomain])
      .catch(() => {});
  } finally {
    await pool.end();
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
