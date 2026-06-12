/**
 * Caddy forward_auth handler ? GET /internal/auth/forward
 *
 * Called by Caddy before proxying to any admin/tool UI. Validates:
 *   1. X-Internal-Secret header ? proves the caller is Caddy, not an external client.
 *      (The /internal/* path is blocked in the public Caddyfile; this is defence in depth.)
 *   2. Session cookie ? resolves the actor.
 *   3. Resource + scope access ? checks role against resource policy.
 *   4. Cross-tenant ownership ? for tenant-admin, resolves the session tenantId to a slug
 *      via a direct DB lookup and compares to the requested host slug. Never trusts the
 *      host header alone for ownership ? prevents cross-tenant IDOR.
 *
 * Security properties:
 *   - X-Internal-Secret prevents external callers from spoofing forward_auth responses.
 *   - Host header derived slug is verified against DB-resolved slug for the session tenant.
 *   - X-Forwarded-Host is only used AFTER the DB ownership check passes ? not trusted solo.
 *   - /internal/auth/forward is not reachable externally (blocked in Caddyfile public blocks).
 *
 * Returns:
 *   200 ? allow proxy
 *   401 ? no valid session
 *   403 ? session valid but access denied (wrong tenant or insufficient role)
 *
 * ADR-0029: FQDN-based tenant routing ? host used to identify tenant, verified via DB.
 * ADR-0030: Policy Enforcement Point ? upgrade path to Keycloak UMA ticket evaluation.
 * ADR-0031: Infrastructure provisioning privilege model ? forward auth is a trust boundary.
 */

import crypto from "node:crypto";
import pg from "pg";
import type { PipelineHandler } from "./pipeline.ts";
import { extractSlugFromHost as sharedExtractSlugFromHost } from "./tenant-resolver.ts";
import { parseSessionCookie } from "./auth.ts";
import { getSessionStore, getPostgresAppUrl } from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";

/**
 * Clickthrough service access classification (ADR-0029).
 *
 * GLOBAL_ONLY        — system-admin only, from the global host. Never tenant-admin.
 * TENANT_SCOPED_SAFE — tenant-admin allowed on own slug only. Safe because:
 *                      identity is derived from the session (Keycloak realm = tenant realm);
 *                      tenant cannot switch realm by URL; service scopes data to the realm.
 * NOT_EXPOSED        — not routed through Caddy forward-auth at all.
 */

/** GLOBAL_ONLY services — system-admin only; never accessible to tenant-admin. */
const SYSTEM_ADMIN_RESOURCES = new Set([
  "admin:keycloak", // GLOBAL_ONLY — master realm + all tenant realms visible
  "admin:mailpit", // GLOBAL_ONLY — all-tenant mail visible in shared inbox
  "admin:sonarqube", // GLOBAL_ONLY — no per-tenant project isolation
  "admin:minio", // GLOBAL_ONLY — all-bucket access, no per-tenant ACL in console
  "admin:sentry", // GLOBAL_ONLY — all-org access in shared Sentry instance (subdomain)
  // admin:wiremock intentionally absent — WireMock is NOT_EXPOSED as a clickthrough.
  // Access WireMock directly via WIREMOCK_PORT in dev; it must not be linked in UI.
  "admin:clickhouse", // GLOBAL_ONLY — analytics DB, no per-tenant partitioning yet
  "admin:localstack", // GLOBAL_ONLY — cloud mock, no tenant scope
  "admin:tilt", // GLOBAL_ONLY — local dev tooling
  "admin:pgadmin", // GLOBAL_ONLY — raw SQL; tenant scope via user-settable GUC is unsafe
  "admin:grafana", // GLOBAL_ONLY — platform log search; all tenants' logs visible
]);

/**
 * TENANT_SCOPED_SAFE services — tenant-admin allowed on own slug.
 * Safety invariants:
 *   - admin:keycloak: login is realm-scoped via OIDC; tenant cannot switch realm by URL
 *   - admin:mailpit:  tenant subdomain routes to a realm-tagged view (own mail only)
 *   - admin:sentry:   tenant subdomain routes to a per-tenant Sentry organisation
 */
const TENANT_ADMIN_RESOURCES = new Set([
  "admin:keycloak", // TENANT_SCOPED_SAFE — own realm only via OIDC login
  "admin:mailpit", // TENANT_SCOPED_SAFE — tenant Mailpit view, own mail only
  "admin:sentry", // TENANT_SCOPED_SAFE — per-tenant Sentry organisation
  // admin:pgadmin is intentionally absent — GLOBAL_ONLY (see above and ADR-0029)
]);

const APEX_DOMAIN = process.env["APEX_DOMAIN"] ?? "aldous.info";

// ---------------------------------------------------------------------------
// Slug ? tenant ID resolution (DB lookup, not trusting the host header alone)
// ---------------------------------------------------------------------------

let _pgPool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!_pgPool) _pgPool = new pg.Pool({ connectionString: getPostgresAppUrl(), max: 2 });
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

// Shared with the pipeline resolver (ADR-ACT-0231): port-stripping, slug regex
// validation, and reserved-slug rejection are identical on both paths — the
// previous private copy here had drifted (no port strip, no charset check).
function extractSlugFromHost(host: string): string | null {
  return sharedExtractSlugFromHost(host, APEX_DOMAIN);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleForwardAuth: PipelineHandler = async (req, res) => {
  // 1. Validate Caddy internal secret ? rejects external callers.
  //
  //    Fail-closed: if no secret is configured in production, deny all.
  //    In development (NODE_ENV !== production) an unset secret is permitted
  //    for local iteration, but a warning is emitted once at startup.
  //    Constant-time comparison prevents timing side-channel attacks.
  const internalSecret = process.env["CADDY_INTERNAL_SECRET"] ?? "";
  const isProduction = process.env["NODE_ENV"] === "production";

  if (!internalSecret && isProduction) {
    // Production with no secret configured ? deny everything. This is a
    // misconfiguration; fail closed rather than exposing the endpoint.
    res.json(503, { code: "MISCONFIGURED", message: "Internal secret not configured" });
    return;
  }

  if (internalSecret) {
    const provided = req.raw.headers["x-internal-secret"];
    const provided1 = Array.isArray(provided) ? (provided[0] ?? "") : (provided ?? "");
    // Constant-time comparison ? prevents timing oracle on the secret value.
    const a = Buffer.from(provided1);
    const b = Buffer.from(internalSecret);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
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

  // 4 & 5. Access decision ? resolve host slug, look up tenant ownership, delegate to
  // checkResourceAccess() so tests and production use the same logic path.
  const hostHeader = req.raw.headers["x-forwarded-host"] ?? req.raw.headers["host"] ?? "";
  const rawHost = Array.isArray(hostHeader) ? (hostHeader[0] ?? "") : hostHeader;
  const requestedSlug = extractSlugFromHost(rawHost);

  // DB lookup only needed when tenant-admin may be granted access
  const ownSlug =
    tenantId && roles.includes("tenant-admin") && requestedSlug !== null
      ? await resolveSlugForTenant(tenantId)
      : null;

  if (checkResourceAccess({ roles, resource, requestedSlug, ownSlug })) {
    res.json(200, { resource, scope, granted: true });
    return;
  }

  res.json(403, { code: "FORBIDDEN", resource, scope, granted: false });
};

// ---------------------------------------------------------------------------
// Exported pure functions ? used by unit tests without needing live Redis/DB
// ---------------------------------------------------------------------------

export { extractSlugFromHost, SYSTEM_ADMIN_RESOURCES, TENANT_ADMIN_RESOURCES };

/**
 * Pure access decision: given roles, resource, and resolved slug ownership,
 * return whether access should be granted. No DB or session I/O.
 *
 * Extracted to allow deterministic unit testing of the access logic without
 * mocking the full handler pipeline.
 */
export function checkResourceAccess(params: {
  roles: string[];
  resource: string;
  requestedSlug: string | null; // null = super-global (aldous.info root)
  ownSlug: string | null; // null = DB lookup failed or no tenantId
}): boolean {
  const { roles, resource, requestedSlug, ownSlug } = params;

  if (roles.includes("system-admin") && SYSTEM_ADMIN_RESOURCES.has(resource)) {
    return true;
  }

  if (
    roles.includes("tenant-admin") &&
    TENANT_ADMIN_RESOURCES.has(resource) &&
    requestedSlug !== null && // must be a tenant subdomain, not root
    ownSlug !== null &&
    ownSlug === requestedSlug
  ) {
    return true;
  }

  return false;
}
