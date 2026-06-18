/**
 * Domain identity matrix runtime proof (ADR-ACT-0231).
 *
 * Proves host identity classification for every host-identity permutation, and
 * that the LIVE tenant resolver maps each identity to the correct tenant
 * outcome against the local Postgres (`make compose-up-default`):
 *
 *   1. pure classification: apex, slug, local slug, reserved, unknown,
 *      malformed, host-with-port, custom-domain candidate
 *   2. live resolver: apex/reserved/unknown/malformed hosts resolve NO tenant
 *   3. live resolver: a seeded slug organisation resolves (hostSource=slug)
 *   4. live resolver: X-Forwarded-Host is preferred over Host
 *
 * LOCAL-ONLY proof: exercises the local database and the request-derivation
 * path; it makes no claim about public DNS or public routing.
 *
 * Usage: npm run proof:domain-identity-matrix
 */

import http from "node:http";
import { requireEnv } from "./lib/local-env.ts";
import pg from "pg";
import { classifyHostIdentity } from "@platform/domain-identity";
import {
  resolveTenantFromRequest,
  isGlobalHost,
  isApexSubdomain,
} from "../src/server/tenant-resolver.ts";

const POSTGRES_URL = requireEnv("POSTGRES_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

function req(headers: Record<string, string>): http.IncomingMessage {
  const r = new http.IncomingMessage(null as never);
  Object.assign(r, { headers });
  return r;
}

async function main(): Promise<void> {
  console.log(`# Domain identity matrix runtime proof (apex=${APEX})\n`);

  // 1. Pure classification matrix — the real module, every permutation.
  const cases: Array<[string, string]> = [
    [APEX, "apex"],
    [`${APEX}:8081`, "apex"],
    [`acme.${APEX}`, "tenant_slug"],
    [`acme.${APEX}:8081`, "tenant_slug"],
    ["acme.test.localhost", APEX === "test.localhost" ? "tenant_slug" : "custom_domain_candidate"],
    [`kc.${APEX}`, "reserved_subdomain"],
    [`admin.${APEX}`, "reserved_subdomain"],
    [`a.b.${APEX}`, "invalid_subdomain"],
    ["app.mycorp.example", "custom_domain_candidate"],
    ["", "malformed"],
    ["bad host", "malformed"],
    [`acme.${APEX}:notaport`, "malformed"],
  ];
  for (const [host, expected] of cases) {
    const got = classifyHostIdentity(host, APEX).kind;
    check(`classify "${host || "(empty)"}" → ${expected}`, got === expected, `got ${got}`);
  }

  check(`isGlobalHost("${APEX}:9999") with port`, isGlobalHost(`${APEX}:9999`, APEX));
  check(`isApexSubdomain("unknown.${APEX}")`, isApexSubdomain(`unknown.${APEX}`, APEX));
  check(`!isApexSubdomain("${APEX}")`, !isApexSubdomain(APEX, APEX));

  // 2-4. Live resolver against local Postgres.
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  try {
    for (const host of [APEX, `kc.${APEX}`, `no-such-tenant-xyz.${APEX}`, "unknown.example", ""]) {
      const ctx = await resolveTenantFromRequest(req({ host }), pool);
      check(`live: "${host || "(empty)"}" resolves no tenant`, ctx === null);
    }

    const org = await pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const seeded = org.rows[0];
    if (!seeded) {
      console.log("SKIP  live slug resolution — no organisation seeded (run `make seed-demo`)");
    } else {
      const ctx = await resolveTenantFromRequest(req({ host: `${seeded.slug}.${APEX}` }), pool);
      check(
        `live: seeded slug host ${seeded.slug}.${APEX} resolves`,
        ctx?.organisationId === seeded.id && ctx?.hostSource === "slug"
      );
      const fwd = await resolveTenantFromRequest(
        req({ host: "platform-api:3001", "x-forwarded-host": `${seeded.slug}.${APEX}` }),
        pool
      );
      check("live: X-Forwarded-Host preferred over Host", fwd?.organisationId === seeded.id);
    }
  } finally {
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
