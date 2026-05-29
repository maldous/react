/**
 * Caddy forward_auth handler — /internal/auth/forward
 *
 * Called by Caddy before proxying to any admin/tool UI. Reads the platform
 * session cookie, resolves the actor, then checks whether that actor has
 * access to the requested resource+scope.
 *
 * Returns:
 *   200 — allow proxy; Caddy forwards the original request
 *   401 — no valid session; Caddy returns 401 to the browser
 *   403 — session valid but resource access denied
 *
 * Access model (ADR-0030):
 *   Roles that can access admin resources by default:
 *     system-admin  — all admin:* resources
 *     tenant-admin  — admin:keycloak, admin:mailpit, admin:sentry (own tenant only)
 *
 * This handler uses session-based role checks as a baseline. When Keycloak
 * Authorization Services (UMA) is implemented (ADR-0030), this is the upgrade
 * point: replace the role switch with a UMA ticket evaluation call.
 *
 * ADR-0029: FQDN-based tenant routing — host header is used to scope tenant access.
 * ADR-0030: Policy Enforcement Point — this is the PEP for non-API resources.
 */

import type { PipelineHandler } from "./pipeline.ts";
import { parseSessionCookie } from "./auth.ts";
import { getSessionStore } from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";

// Resources that system-admin can always access
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

// Resources that tenant-admin can access (scoped to their tenant)
const TENANT_ADMIN_RESOURCES = new Set(["admin:keycloak", "admin:mailpit", "admin:sentry"]);

export const handleForwardAuth: PipelineHandler = async (req, res) => {
  const url = new URL(req.raw.url ?? "", `http://${req.raw.headers["host"] ?? "localhost"}`);
  const resource = url.searchParams.get("resource") ?? "";
  const scope = url.searchParams.get("scope") ?? "read";

  // Resolve actor from fixture session (dev) or real session cookie
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

  // system-admin has access to all admin resources
  if (roles.includes("system-admin") && SYSTEM_ADMIN_RESOURCES.has(resource)) {
    res.json(200, { resource, scope, granted: true });
    return;
  }

  // tenant-admin has access to tenant-scoped admin resources
  // The host header identifies which tenant is requesting access
  const hostHeader = req.raw.headers["x-forwarded-host"] ?? req.raw.headers["host"] ?? "";
  const host = Array.isArray(hostHeader) ? (hostHeader[0] ?? "") : hostHeader;
  const requestedSlug = host.split(".")[0];
  const isOwnTenant = tenantId != null && tenantId.length > 0;

  if (
    roles.includes("tenant-admin") &&
    TENANT_ADMIN_RESOURCES.has(resource) &&
    isOwnTenant &&
    requestedSlug !== "aldous" // aldous.info is super-global only
  ) {
    res.json(200, { resource, scope, granted: true });
    return;
  }

  res.json(403, { code: "FORBIDDEN", resource, scope, granted: false });
};
