/**
 * Tenant Domains LOCAL ROUTING runtime proof (ADR-0048 / ADR-ACT-0225).
 *
 * Proves a verified tenant domain (FQDN) routes to the CORRECT tenant context through
 * the LOCAL reverse proxy (Caddy web profile), end to end:
 *   1. seed a temp tenant org + its per-tenant schema + a UNIQUE theme marker
 *   2. create + DNS-TXT-verify a domain challenge for the tenant FQDN (stub resolver)
 *   3. GET the tenant FQDN /api/theme THROUGH Caddy → assert the UNIQUE marker comes back
 *      (and the apex does NOT) → proves Host→tenant resolution + routing
 *   4. classify routing_local_active; TLS stays tls_unknown (local Caddy is HTTP-only —
 *      Cloudflare terminates PUBLIC TLS, so tls_local_ready is NOT claimed)
 *   5. cleanup (drop schema, delete org)
 *
 * Requires the web profile: `make compose-up-web ENV=test`. SKIPs honestly if the local
 * Caddy is not reachable. No secret is printed. Public DNS / public TLS / canonical
 * cutover remain deferred (not provable locally).
 *
 * Usage: npm run proof:tenant-domains-routing
 *   Overrides: CADDY_BASE_URL, ROUTING_PROOF_PG_URL, ROUTING_PROOF_APP_ROLE.
 */

import { request as httpGet, type IncomingMessage } from "node:http";
import pg from "pg";
import type { AuditEventPort } from "@platform/audit-events";
import {
  createDomainChallenge,
  verifyDomainChallenge,
  type DnsResolverPort,
} from "../src/usecases/vanity-domain-challenge.ts";
import { classifyLocalRouting } from "../src/usecases/tenant-domains.ts";
import { loadLocalEnv, requireEnv } from "./lib/local-env.ts";

loadLocalEnv();
const CADDY_BASE = process.env["CADDY_BASE_URL"] ?? "http://test.localhost:8081";
const PG_URL = process.env["ROUTING_PROOF_PG_URL"] ?? requireEnv("POSTGRES_URL");
const APP_ROLE = process.env["ROUTING_PROOF_APP_ROLE"] ?? "platform_app";
const APEX = new URL(CADDY_BASE).hostname; // e.g. test.localhost
const PORT = new URL(CADDY_BASE).port || "80";
const noopAudit: AuditEventPort = { emit: async () => {} };

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}

async function caddyReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${CADDY_BASE}/healthz`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function themeDisplayName(host: string): Promise<string | null> {
  // Real subdomain URL: `.localhost` resolves to loopback and Caddy routes by Host
  // (which includes the :PORT — exercised end-to-end, relies on the port-stripping fix).
  const r = await fetch(`http://${host}:${PORT}/api/theme`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const body = (await r.json()) as { displayName?: string };
  return body.displayName ?? null;
}

async function main(): Promise<void> {
  console.log("# Tenant domains local routing runtime proof\n");

  if (!(await caddyReachable())) {
    console.log(
      `SKIP  local Caddy not reachable @ ${CADDY_BASE} — start it: make compose-up-web ENV=test`
    );
    console.log("\n# SKIPPED (web profile not running) — no fake readiness");
    process.exit(0);
  }
  check(`local Caddy reachable @ ${CADDY_BASE}`, true);

  const pool = new pg.Pool({ connectionString: PG_URL });
  const slug = `routing-proof-${Date.now()}`;
  const fqdn = `${slug}.${APEX}`;
  const marker = `ROUTING-PROOF-${Date.now()}`;
  let schema: string | null = null;
  let orgId: string | null = null;
  try {
    // 1. Seed temp tenant org + per-tenant schema + unique theme marker.
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.organisations (slug, display_name) VALUES ($1, 'Routing Proof') RETURNING id`,
      [slug]
    );
    orgId = ins.rows[0]!.id;
    schema = `tenant_${orgId.replaceAll("-", "_")}`;
    const q = (sql: string): Promise<unknown> => pool.query(sql);
    await q(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await q(
      `CREATE TABLE IF NOT EXISTS "${schema}".tenant_settings (key text primary key, value jsonb, updated_at timestamptz default now())`
    );
    await pool.query(
      `INSERT INTO "${schema}".tenant_settings (key, value) VALUES ('theme.displayName', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(marker)]
    );
    // Real provisioning grants the app role read access to the tenant schema.
    await q(`GRANT USAGE ON SCHEMA "${schema}" TO ${APP_ROLE}`);
    await q(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${APP_ROLE}`);
    check("seeded temp tenant + schema + unique theme marker", true, fqdn);

    // 2. Create + DNS-TXT-verify a domain challenge for the tenant FQDN (stub resolver).
    const created = await createDomainChallenge(
      { domain: fqdn, organisationId: orgId, actorId: orgId, actorRoles: ["tenant-admin"] },
      { audit: noopAudit, pool }
    );
    const token = created.kind === "ok" ? created.token : "";
    const stubDns: DnsResolverPort = {
      resolveTxt: async (h) => (h === `_aldous-verify.${fqdn}` ? [[token]] : []),
    };
    const verified = await verifyDomainChallenge(
      { domain: fqdn, organisationId: orgId, actorId: orgId, actorRoles: ["tenant-admin"] },
      { audit: noopAudit, pool, dns: stubDns }
    );
    check("domain ownership verified via DNS-TXT (existing proof path)", verified.kind === "ok");

    // 3. Route through Caddy: the tenant FQDN must resolve to the seeded tenant context.
    const tenantName = await themeDisplayName(fqdn);
    const apexName = await themeDisplayName(APEX);
    const matched = tenantName === marker && apexName !== marker;
    check(
      "tenant FQDN routed to the CORRECT tenant context through local Caddy",
      matched,
      `tenant=${tenantName} apex=${apexName}`
    );

    // 4. Honest classification.
    const routing = classifyLocalRouting({ reachable: true, tenantContextMatched: matched });
    check(
      "classified routing_local_active (local routing proven)",
      routing === "routing_local_active"
    );

    // 4b. CUSTOM domain leg (ADR-ACT-0232): an ACTIVE custom domain (outside the
    // apex zone) must route through the Caddy catch-all vhost to the SAME
    // tenant context, and an unregistered custom host must resolve NO tenant.
    const customDomain = `custom-${Date.now()}.routing-proof.example`;
    await pool.query(
      `INSERT INTO public.tenant_domains
         (organisation_id, domain, ownership_status, auth_client_status, verified_at, auth_client_activated_at)
       VALUES ($1, $2, 'verified', 'active', now(), now())`,
      [orgId, customDomain]
    );
    // .example does not resolve in DNS — connect to the proxy directly and set
    // Host explicitly via node:http (undici fetch silently DROPS a host override).
    type HostIdentity = { kind?: string; tenant?: { slug?: string; hostSource?: string } | null };
    const collectResponse = (
      res: IncomingMessage,
      resolve: (value: HostIdentity) => void,
      reject: (reason: Error) => void
    ): void => {
      let data = "";
      res.on("data", (c: Buffer) => {
        data += c.toString();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as never);
        } catch (e) {
          reject(e as Error);
        }
      });
    };
    const hostIdentity = (host: string): Promise<HostIdentity> =>
      new Promise((resolve, reject) => {
        const base = new URL(CADDY_BASE);
        const req = httpGet(
          {
            host: base.hostname,
            port: base.port || 80,
            path: "/api/host-identity",
            method: "GET",
            headers: { Host: host, Accept: "application/json" },
            setHost: false,
            timeout: 4000,
          },
          (res) => collectResponse(res, resolve, reject)
        );
        req.on("error", reject);
        req.end();
      });
    const customId = await hostIdentity(customDomain);
    check(
      "ACTIVE custom domain routes to the CORRECT tenant via the Caddy catch-all",
      customId.kind === "custom_domain_candidate" &&
        customId.tenant?.slug === slug &&
        customId.tenant?.hostSource === "custom_domain",
      JSON.stringify(customId)
    );
    const unknownId = await hostIdentity(`unregistered-${Date.now()}.routing-proof.example`);
    check(
      "unregistered custom host resolves NO tenant through the proxy",
      unknownId.tenant === null,
      JSON.stringify(unknownId)
    );

    // TLS: local Caddy is HTTP-only — Cloudflare terminates PUBLIC TLS. Do NOT claim TLS.
    let tlsLocal = false;
    try {
      await fetch(`https://${fqdn}:${PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
      tlsLocal = true;
    } catch {
      tlsLocal = false;
    }
    check("tls stays tls_unknown locally (no local Caddy TLS to claim tls_local_ready)", !tlsLocal);
    console.log(
      "INFO  public routing_active + public tls_ready remain DEFERRED — not provable locally" +
        " (public DNS, Cloudflare TLS, canonical cutover)."
    );
  } catch (err) {
    check("local routing lifecycle", false, err instanceof Error ? err.message : String(err));
  } finally {
    // 5. Cleanup.
    if (schema) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    if (orgId)
      await pool
        .query(`DELETE FROM public.tenant_domains WHERE organisation_id = $1`, [orgId])
        .catch(() => {});
    if (orgId)
      await pool.query(`DELETE FROM public.organisations WHERE id = $1`, [orgId]).catch(() => {});
    await pool.end();
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
