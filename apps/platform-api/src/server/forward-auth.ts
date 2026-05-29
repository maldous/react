/**
 * Caddy forward_auth handler — GET /internal/auth/forward
 *
 * Called by Caddy before proxying to any admin/tool UI. Validates:
 *   1. X-Internal-Secret header — proves the caller is Caddy, not an external client.
 *      (The /internal/* path is blocked in the public Caddyfile; this is defence in depth.)
 *   2. Session cookie — resolves the actor.
 *   3. Resource + scope access — checks role against resource policy.
 *   4. Cross-tenant ownership — for tenant-admin, resolves the session tenantId to a slug
 *      via a direct DB lookup and compares to the requested host slug. Never trusts the
 *      host header alone for ownership — prevents cross-tenant IDOR.
 *
 * Security properties:
 *   - X-Internal-Secret prevents external callers from spoofing forward_auth responses.
 *   - Host header derived slug is verified against DB-resolved slug for the session tenant.
 *   - X-Forwarded-Host is only used AFTER the DB ownership check passes — not trusted solo.
 *   - /internal/auth/forward is not reachable externally (blocked in Caddyfile public blocks).
 *
 * Returns:
 *   200 — allow proxy
 *   401 — no valid session
 *   403 — session valid but access denied (wrong tenant or insufficient role)
 *
 * ADR-0029: FQDN-based tenant routing — host used to identify tenant, verified via DB.
 * ADR-0030: Policy Enforcement Point — upgrade path to Keycloak UMA ticket evaluation.
 * ADR-0031: Infrastructure provisioning privilege model — forward auth is a trust boundary.
 */

import pg from "pg";
import type { PipelineHandler } from "./pipeline.ts";
import { parseSessionCookie } from "./auth.ts";
import { getSessionStore, getPostgresUrl } from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";

const SYSTEM_ADMIN_RESOURCES = new Set([
  "admin:keycloak",
  "admin:mailpit",
  "admin:sonarqube",
  "admin:minio",
  "admin:sentry",
  "admin:wiremock",
  "admin:clickhouse",
  "admin:localstack",
  "admin:tilt",
]);

const TENANT_ADMIN_RESOURCES = new Set(["admin:keycloak", "admin:mailpit", "admin:sentry"]);

const APEX_DOMAIN = process.env["APEX_DOMAIN"] ?? "aldous.info";

// ---------------------------------------------------------------------------
// Slug → tenant ID resolution (DB lookup, not trusting the host header alone)
// ---------------------------------------------------------------------------

let _pgPool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!_pgPool) _pgPool = new pg.Pool({ connectionString: getPostgresUrl(), max: 2 });
  return _pgPool;
}

async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  try {
    const { rows } = await getPool().query<{ slug: string }>(
      "SELECT slug FROM public.organisations WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    return rows[0]?.slug ?? null;
  } catch {
    return null;
  }
}

function extractSlugFromHost(host: string): string | null {
  // host must end with .<APEX_DOMAIN> or be APEX_DOMAIN exactly
  if (!host.endsWith(`.${APEX_DOMAIN}`) && host !== APEX_DOMAIN) return null;
  if (host === APEX_DOMAIN) return null; // super-global root, no tenant slug
  const slug = host.slice(0, host.length - APEX_DOMAIN.length - 1);
  return slug.length > 0 ? slug : null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleForwardAuth: PipelineHandler = async (req, res) => {
  // 1. Validate Caddy internal secret — rejects external callers
  const internalSecret = process.env["CADDY_INTERNAL_SECRET"];
  if (internalSecret) {
    const provided = req.raw.headers["x-internal-secret"];
    const provided1 = Array.isArray(provided) ? provided[0] : provided;
    if (provided1 !== internalSecret) {
      res.json(403, { code: "FORBIDDEN", message: "Invalid internal secret" });
      return;
    }
  }

  // 2. Parse resource + scope from query string
  const url = new URL(req.raw.url ?? "", `http://${req.raw.headers["host"] ?? "localhost"}`);
  const resource = url.searchParams.get("resource") ?? "";
  const scope = url.searchParams.get("scope") ?? "read";

  // 3. Resolve actor from fixture session (dev) or real session cookie
  let roles: string[] = [];
  let tenantId: string | null = null;

  const fixtureActor = getFixtureSession();
  if (fixtureActor) {
    roles = fixtureActor.roles;
    tenantId = fixtureActor.tenantId;
  } else {
    const sessionId = parseSessionCookie(req.raw.headers["cookie"]);
    if (!sessionId) {
      res.json(401, { code: "UNAUTHENTICATED", message: "No session" });
      return;
    }
    try {
      const record = await getSessionStore().find(sessionId);
      if (!record) {
        res.json(401, { code: "UNAUTHENTICATED", message: "Session expired" });
        return;
      }
      roles = record.roles;
      tenantId = record.tenantId;
    } catch {
      res.json(401, { code: "UNAUTHENTICATED", message: "Session store unavailable" });
      return;
    }
  }

  // 4. system-admin: has access to all admin resources from any host
  if (roles.includes("system-admin") && SYSTEM_ADMIN_RESOURCES.has(resource)) {
    res.json(200, { resource, scope, granted: true });
    return;
  }

  // 5. tenant-admin: verify ownership before granting access
  //    Resolve the request host → slug, then resolve session tenantId → slug from DB.
  //    Only grant if both slugs match. Never trust host header alone.
  if (roles.includes("tenant-admin") && TENANT_ADMIN_RESOURCES.has(resource) && tenantId) {
    const hostHeader = req.raw.headers["x-forwarded-host"] ?? req.raw.headers["host"] ?? "";
    const rawHost = Array.isArray(hostHeader) ? (hostHeader[0] ?? "") : hostHeader;
    const requestedSlug = extractSlugFromHost(rawHost);

    if (requestedSlug) {
      // DB lookup: what slug does the session's tenantId actually belong to?
      const ownSlug = await resolveSlugForTenant(tenantId);

      if (ownSlug !== null && ownSlug === requestedSlug) {
        res.json(200, { resource, scope, granted: true });
        return;
      }
      // Slug mismatch — cross-tenant attempt or slug not found
    }
    // requestedSlug null means super-global host — tenant-admin denied on global domain
  }

  res.json(403, { code: "FORBIDDEN", resource, scope, granted: false });
};
