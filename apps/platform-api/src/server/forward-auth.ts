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
import { createLogger } from "@platform/platform-logging";
import type { PipelineHandler } from "./pipeline.ts";
import { extractSlugFromHost as sharedExtractSlugFromHost } from "./tenant-resolver.ts";
import { parseSessionCookies } from "./auth.ts";
import { getSessionStore, getPostgresAppUrl } from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";
import { loadStageConfig } from "../config/stage-config.ts";

// Clickthrough service access classification — the policy lives in
// usecases/service-clickthrough.ts (ADR-ACT-0233, single source of truth).
// This handler only resolves session/slug inputs and delegates the decision.
import {
  decideServiceAccess,
  SYSTEM_ADMIN_RESOURCES,
  TENANT_ADMIN_RESOURCES,
} from "../usecases/service-clickthrough.ts";

function getApexDomain(): string {
  return process.env["APEX_DOMAIN"] ?? "aldous.info";
}

// ---------------------------------------------------------------------------
// Slug ? tenant ID resolution (DB lookup, not trusting the host header alone)
// ---------------------------------------------------------------------------

let _pgPool: pg.Pool | undefined;

function getPool(): pg.Pool {
  _pgPool ??= new pg.Pool({ connectionString: getPostgresAppUrl(), max: 2 });
  return _pgPool;
}

const faLog = createLogger({
  name: "forward-auth",
  service: "platform-api",
  boundedContext: "bff",
});

async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  try {
    const { rows } = await getPool().query<{ slug: string }>(
      "SELECT slug FROM public.organisations WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    return rows[0]?.slug ?? null;
  } catch (err) {
    faLog.warn({ err, tenantId }, "forward-auth: tenant slug lookup failed");
    return null;
  }
}

// Shared with the pipeline resolver (ADR-ACT-0231): port-stripping, slug regex
// validation, and reserved-slug rejection are identical on both paths — the
// previous private copy here had drifted (no port strip, no charset check).
function extractSlugFromHost(host: string, apexDomain = getApexDomain()): string | null {
  return sharedExtractSlugFromHost(host, apexDomain);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Outcome of the Caddy internal-secret validation. */
type SecretCheck = { ok: true } | { ok: false; status: number; body: unknown };

/**
 * Validate the Caddy internal secret — rejects external callers.
 *
 * Fail-closed: if no secret is configured in production, deny all.
 * In development (NODE_ENV !== production) an unset secret is permitted
 * for local iteration, but a warning is emitted once at startup.
 * Constant-time comparison prevents timing side-channel attacks.
 */
function checkInternalSecret(req: Parameters<PipelineHandler>[0]): SecretCheck {
  const internalSecret = process.env["CADDY_INTERNAL_SECRET"] ?? "";
  const isProduction = loadStageConfig().nodeEnv === "production";

  if (!internalSecret && isProduction) {
    // Production with no secret configured ? deny everything. This is a
    // misconfiguration; fail closed rather than exposing the endpoint.
    return {
      ok: false,
      status: 503,
      body: { code: "MISCONFIGURED", message: "Internal secret not configured" },
    };
  }

  if (internalSecret) {
    const provided = req.raw.headers["x-internal-secret"];
    const provided1 = Array.isArray(provided) ? (provided[0] ?? "") : (provided ?? "");
    // Constant-time comparison ? prevents timing oracle on the secret value.
    const a = Buffer.from(provided1);
    const b = Buffer.from(internalSecret);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      return {
        ok: false,
        status: 403,
        body: { code: "FORBIDDEN", message: "Invalid internal secret" },
      };
    }
  }

  return { ok: true };
}

/** Resolved actor identity, or a denial response to send. */
type ActorResolution =
  | { ok: true; roles: string[]; tenantId: string | null }
  | { ok: false; status: number; body: unknown };

/** Resolve the actor from fixture session (dev) or real session cookie. */
async function resolveActorIdentity(req: Parameters<PipelineHandler>[0]): Promise<ActorResolution> {
  const fixtureActor = getFixtureSession();
  if (fixtureActor) {
    return { ok: true, roles: fixtureActor.roles, tenantId: fixtureActor.tenantId };
  }

  // Try EVERY presented platform_session so a stale cookie can't shadow a valid
  // session and wrongly deny a clickthrough service (ADR-ACT-0278).
  const candidateIds = parseSessionCookies(req.raw.headers["cookie"]);
  if (candidateIds.length === 0) {
    return { ok: false, status: 401, body: { code: "UNAUTHENTICATED", message: "No session" } };
  }
  try {
    const store = getSessionStore();
    let record = null;
    for (const id of candidateIds) {
      record = await store.find(id);
      if (record) break;
    }
    if (!record) {
      return {
        ok: false,
        status: 401,
        body: { code: "UNAUTHENTICATED", message: "Session expired" },
      };
    }
    return { ok: true, roles: record.roles, tenantId: record.tenantId };
  } catch (err) {
    faLog.error({ err }, "forward-auth: session store unavailable — denying clickthrough");
    return {
      ok: false,
      status: 401,
      body: { code: "UNAUTHENTICATED", message: "Session store unavailable" },
    };
  }
}

export const handleForwardAuth: PipelineHandler = async (req, res) => {
  // 1. Validate Caddy internal secret ? rejects external callers.
  const secretCheck = checkInternalSecret(req);
  if (!secretCheck.ok) {
    res.json(secretCheck.status, secretCheck.body);
    return;
  }

  // 2. Parse resource + scope from query string
  const url = new URL(req.raw.url ?? "", `http://${req.raw.headers["host"] ?? "localhost"}`);
  const resource = url.searchParams.get("resource") ?? "";
  const scope = url.searchParams.get("scope") ?? "read";

  // 3. Resolve actor from fixture session (dev) or real session cookie
  const identity = await resolveActorIdentity(req);
  if (!identity.ok) {
    res.json(identity.status, identity.body);
    return;
  }
  const { roles, tenantId } = identity;

  // 4 & 5. Access decision ? resolve host slug, look up tenant ownership, delegate to
  // checkResourceAccess() so tests and production use the same logic path.
  const hostHeader = req.raw.headers["x-forwarded-host"] ?? req.raw.headers["host"] ?? "";
  const rawHost = Array.isArray(hostHeader) ? (hostHeader[0] ?? "") : hostHeader;
  const requestedSlug = extractSlugFromHost(rawHost, getApexDomain());

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

export function extractSlugFromHostPure(host: string): string | null {
  return extractSlugFromHost(host, "aldous.info");
}

export {
  extractSlugFromHostPure as extractSlugFromHost,
  SYSTEM_ADMIN_RESOURCES,
  TENANT_ADMIN_RESOURCES,
};

/**
 * Pure access decision: given roles, resource, and resolved slug ownership,
 * return whether access should be granted. No DB or session I/O.
 *
 * Delegates to decideServiceAccess (usecases/service-clickthrough.ts) so the
 * policy module is the single decision path (ADR-ACT-0233).
 */
export function checkResourceAccess(params: {
  roles: string[];
  resource: string;
  requestedSlug: string | null; // null = super-global (aldous.info root)
  ownSlug: string | null; // null = DB lookup failed or no tenantId
}): boolean {
  return decideServiceAccess(params).granted;
}
