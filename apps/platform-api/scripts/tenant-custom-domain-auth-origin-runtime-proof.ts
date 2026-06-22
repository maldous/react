/**
 * Custom-domain auth origin derivation runtime proof (ADR-ACT-0232).
 *
 * Proves — WITHOUT a real IdP login (that remains blocked, ADR-ACT-0220) —
 * that the auth flow derives the correct tenant realm, redirect URI, and
 * Keycloak public origin when the request arrives on an ACTIVE custom domain.
 * Runs the REAL `handleAuthLogin` handler against live local Postgres + Redis:
 *
 *   1. ACTIVE custom domain → 302 Location targets the TENANT realm
 *      (tenant-{orgId}) on the CUSTOM host's /kc origin, with
 *      redirect_uri = https://{custom}/auth/callback
 *   2. the same domain VERIFIED-but-NOT-activated → falls back to the
 *      platform realm + env callback (the custom host is NOT trusted)
 *   3. unknown custom host → platform realm fallback (host not trusted)
 *   4. slug host continues to derive the tenant realm on its own origin
 *
 * LOCAL-ONLY proof: URL/realm/callback derivation only. No browser, no IdP,
 * no token exchange. Cleanup removes all proof rows.
 *
 * Usage: npm run proof:tenant-custom-domain-auth-origin
 *   (requires `make compose-up-default` — Postgres + Redis)
 */

import http from "node:http";
import assert from "node:assert/strict";
import { requireEnv } from "./lib/local-env.ts";
import crypto from "node:crypto";
import pg from "pg";
import { connectRedis, disconnectRedis } from "../src/server/dependencies.ts";
import { handleAuthLogin } from "../src/server/auth.ts";
import type { PipelineRequest, PipelineResponse } from "../src/server/pipeline.ts";

const POSTGRES_URL = requireEnv("POSTGRES_URL");
const APEX = process.env["APEX_DOMAIN"] ?? "aldous.info";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

/** Run the real login handler and capture the redirect Location. */
async function loginLocationFor(host: string): Promise<URL | null> {
  const raw = new http.IncomingMessage(null as never);
  raw.url = "/auth/login";
  Object.assign(raw, { headers: { host } });

  let location: string | null = null;
  const res = {
    raw: {
      writeHead: (_status: number, headers: Record<string, unknown>) => {
        location = String(headers["Location"] ?? "");
      },
      end: () => {},
    } as unknown as http.ServerResponse,
    json: () => {},
  } as unknown as PipelineResponse;

  const req = { raw, body: null } as unknown as PipelineRequest;
  await handleAuthLogin(req, res);
  return location ? new URL(location) : null;
}

async function main(): Promise<void> {
  console.log("# Custom-domain auth origin derivation runtime proof\n");

  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  await connectRedis();
  const run = crypto.randomBytes(4).toString("hex");
  const activeDomain = `active-${run}.auth-origin-proof.test`;
  const verifiedOnly = `verified-${run}.auth-origin-proof.test`;

  try {
    const org = await pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM public.organisations ORDER BY created_at LIMIT 1"
    );
    const seeded = org.rows[0];
    if (!seeded) {
      console.log("SKIP  no organisation seeded (run `make seed-demo`)");
      process.exit(0);
    }
    const tenantRealm = `tenant-${seeded.id}`;

    await pool.query(
      `INSERT INTO public.tenant_domains
         (organisation_id, domain, ownership_status, auth_client_status, verified_at, auth_client_activated_at)
       VALUES
         ($1, $2, 'verified', 'active',   now(), now()),
         ($1, $3, 'verified', 'inactive', now(), NULL)`,
      [seeded.id, activeDomain, verifiedOnly]
    );

    // 1. ACTIVE custom domain → tenant realm on the custom origin.
    const active = await loginLocationFor(activeDomain);
    check(
      "active custom domain derives the TENANT realm",
      active?.pathname.includes(`/realms/${tenantRealm}/`) === true,
      active?.pathname ?? "no redirect"
    );
    check(
      "Keycloak public origin is the custom host (/kc)",
      active?.host === activeDomain && active?.pathname.startsWith("/kc/") === true,
      `${active?.host}${active?.pathname}`
    );
    const redirectUri = active?.searchParams.get("redirect_uri") ?? "";
    check(
      "redirect_uri is https://{custom}/auth/callback",
      redirectUri === `https://${activeDomain}/auth/callback`,
      redirectUri
    );

    // 2. Verified-but-NOT-activated → platform realm fallback, custom host NOT trusted.
    const inactive = await loginLocationFor(verifiedOnly);
    check(
      "verified-but-inactive domain does NOT derive the tenant realm",
      inactive?.pathname.includes(`/realms/${tenantRealm}/`) !== true,
      inactive?.pathname ?? "no redirect"
    );
    const inactiveRedirect = inactive?.searchParams.get("redirect_uri") ?? "";
    check(
      "verified-but-inactive domain is NOT a callback origin",
      !inactiveRedirect.includes(verifiedOnly),
      inactiveRedirect
    );

    // 3. Unknown custom host → platform realm fallback.
    const unknown = await loginLocationFor(`unknown-${run}.auth-origin-proof.test`);
    const unknownRedirect = unknown?.searchParams.get("redirect_uri") ?? "";
    check(
      "unknown custom host cannot initiate tenant login or claim the callback",
      unknown?.pathname.includes(`/realms/${tenantRealm}/`) !== true &&
        !unknownRedirect.includes("auth-origin-proof.test"),
      unknownRedirect
    );

    // 4. Slug host still derives the tenant realm on its own origin.
    const slugHost = `${seeded.slug}.${APEX}`;
    const slug = await loginLocationFor(slugHost);
    check(
      "slug host derives the tenant realm on its own origin",
      slug?.pathname.includes(`/realms/${tenantRealm}/`) === true && slug?.host === slugHost,
      `${slug?.host}${slug?.pathname}`
    );
  } finally {
    await pool.query(
      "DELETE FROM public.tenant_domains WHERE domain LIKE '%.auth-origin-proof.test'"
    );
    await pool.end();
    await disconnectRedis().catch(() => undefined);
  }

  console.log(
    failures === 0
      ? "\n# ALL CHECKS PASSED (local-only derivation proof; real-IdP login remains blocked — ADR-ACT-0220)"
      : `\n# ${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("proof failed:", err);
  process.exit(1);
});
