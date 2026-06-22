/**
 * Tenant custom-domain resolution runtime proof (ADR-ACT-0231).
 *
 * Proves, against the LIVE local Postgres, that the tenant_domains registry
 * drives custom-domain host resolution honestly:
 *
 *   1. an ACTIVE custom domain (ownership verified + auth client active)
 *      resolves to the CORRECT tenant context (hostSource=custom_domain)
 *   2. a VERIFIED-but-NOT-activated domain does NOT resolve
 *   3. a pending (unverified) domain does NOT resolve
 *   4. a DISABLED domain does NOT resolve
 *   5. tenant A's custom domain never yields tenant B
 *   6. the registry's partial unique index rejects a second enabled row for
 *      the same domain (cross-tenant takeover guard)
 *
 * LOCAL-ONLY proof: registry rows are inserted directly (the lifecycle routes
 * are proven separately); no public DNS, routing, or TLS claim is made.
 * Cleanup removes every proof row.
 *
 * Usage: npm run proof:tenant-custom-domain-resolution
 */

import http from "node:http";
import assert from "node:assert/strict";
import { requireEnv } from "./lib/local-env.ts";
import crypto from "node:crypto";
import pg from "pg";
import { resolveTenantFromRequest } from "../src/server/tenant-resolver.ts";

const POSTGRES_URL = requireEnv("POSTGRES_URL");

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

function req(host: string): http.IncomingMessage {
  const r = new http.IncomingMessage(null as never);
  Object.assign(r, { headers: { host } });
  return r;
}

async function main(): Promise<void> {
  console.log("# Tenant custom-domain resolution runtime proof\n");

  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const run = crypto.randomBytes(4).toString("hex");
  const domains = {
    active: `active-${run}.resolution-proof.test`,
    verifiedOnly: `verified-${run}.resolution-proof.test`,
    pending: `pending-${run}.resolution-proof.test`,
    disabled: `disabled-${run}.resolution-proof.test`,
  };

  try {
    const orgs = await pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const orgA = orgs.rows[0];
    if (!orgA) {
      console.log("SKIP  no organisation seeded (run `make seed-demo`)");
      process.exit(0);
    }
    // A temporary second organisation makes the cross-tenant checks
    // deterministic regardless of how many orgs are seeded; dropped in cleanup.
    const orgBRes = await pool.query<{ id: string; slug: string }>(
      `INSERT INTO public.organisations (slug, display_name)
       VALUES ($1, 'Resolution Proof Org B') RETURNING id, slug`,
      [`resolution-proof-b-${run}`]
    );
    const orgB = orgBRes.rows[0]!;

    // Seed registry permutations directly (lifecycle routes proven separately).
    await pool.query(
      `INSERT INTO public.tenant_domains
         (organisation_id, domain, ownership_status, auth_client_status, verified_at, auth_client_activated_at, disabled_at)
       VALUES
         ($1, $2, 'verified', 'active',   now(), now(), NULL),
         ($1, $3, 'verified', 'inactive', now(), NULL,  NULL),
         ($1, $4, 'pending_dns', 'inactive', NULL, NULL, NULL),
         ($1, $5, 'verified', 'active',   now(), now(), now())`,
      [orgA.id, domains.active, domains.verifiedOnly, domains.pending, domains.disabled]
    );

    const active = await resolveTenantFromRequest(req(domains.active), pool);
    check(
      "active custom domain resolves to the correct tenant",
      active?.organisationId === orgA.id &&
        active?.hostSource === "custom_domain" &&
        active?.realmName === `tenant-${orgA.id}`
    );

    check(
      "verified-but-not-activated domain does NOT resolve",
      (await resolveTenantFromRequest(req(domains.verifiedOnly), pool)) === null
    );
    check(
      "pending (unverified) domain does NOT resolve",
      (await resolveTenantFromRequest(req(domains.pending), pool)) === null
    );
    check(
      "disabled domain does NOT resolve",
      (await resolveTenantFromRequest(req(domains.disabled), pool)) === null
    );

    check("tenant A's custom domain never yields tenant B", active?.organisationId !== orgB.id);
    // 6. cross-tenant takeover guard: same domain, second enabled row → rejected
    let rejected = false;
    try {
      await pool.query(
        `INSERT INTO public.tenant_domains (organisation_id, domain, ownership_status, auth_client_status)
         VALUES ($1, $2, 'pending_dns', 'inactive')`,
        [orgB.id, domains.active]
      );
    } catch {
      rejected = true;
    }
    check("unique-enabled-domain index rejects cross-tenant claim", rejected);
  } finally {
    await pool.query(
      "DELETE FROM public.tenant_domains WHERE domain LIKE '%.resolution-proof.test'"
    );
    await pool.query("DELETE FROM public.organisations WHERE slug LIKE 'resolution-proof-b-%'");
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
