import { type SessionActor } from "@platform/contracts-auth";
import { evaluateResourcePolicies, type ResourcePolicy } from "@platform/authorisation-runtime";
import { getAuthorisationPort, resolveAccessToken, getSessionStore } from "./dependencies.ts";
import type { TenantContext } from "./tenant-resolver.ts";

/**
 * Per-operation UMA authorisation, shared by callers that cannot use the
 * per-route gate in the pipeline (notably the /api/graphql endpoint, where one
 * HTTP path serves multiple operations each with their own resource+scope).
 *
 * This mirrors the enforcement order of the route gate in
 * `pipeline.ts` exactly (UMA-first → static fallback → fail-closed):
 *   1. If the actor has a stored access token, call the UMA ticket endpoint.
 *      - granted                 → allow
 *      - keycloak_unavailable     → degrade to the static permission check
 *      - resource_not_registered  → degrade to the static permission check
 *                                   (provisioning gap, not a policy decision)
 *      - insufficient_auth        → 401 step-up required
 *      - any other denial         → 403
 *   2. Static fallback: allow only if the actor's resolved permission set
 *      contains `requiredPermission`; otherwise 403.
 *
 * Under ENFORCING mode (ADR-ACT-0200) a resource with no granting policy denies
 * at the UMA layer, so the static `requiredPermission` is the effective gate for
 * sessions without runtime policies — identical to the REST routes.
 */

export interface ResourceGuard {
  resource: string;
  umaScope: string;
  requiredPermission: string;
}

export type AuthzOutcome =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 403;
      code: "authenticationRequired" | "stepUpRequired" | "permissionRequired";
      permission: string;
    };

export interface AuthzDeps {
  authorisationPort?: typeof getAuthorisationPort;
  resolveToken?: typeof resolveAccessToken;
  sessionStore?: ReturnType<typeof getSessionStore>;
  resourcePolicies?: ResourcePolicy[];
}

export async function authorizeResourceAccess(params: {
  actor: SessionActor;
  sessionId: string | null;
  fqdnTenant: TenantContext | null;
  guard: ResourceGuard;
  deps?: AuthzDeps;
}): Promise<AuthzOutcome> {
  const { actor, sessionId, fqdnTenant, guard, deps } = params;
  const resolveToken = deps?.resolveToken ?? resolveAccessToken;
  const authorisationPort = deps?.authorisationPort ?? getAuthorisationPort;
  const sessionStore = deps?.sessionStore ?? getSessionStore();
  const resourcePolicies = deps?.resourcePolicies ?? [];
  const permission = `${guard.resource}#${guard.umaScope}`;

  let umaGranted = false;

  // UMA dynamic authorisation — only when the actor has a stored token.
  if (actor.accessTokenEnc) {
    const rawToken = sessionId ? await resolveToken(sessionId, sessionStore) : null;
    if (!rawToken) {
      return { ok: false, status: 401, code: "authenticationRequired", permission };
    }
    const decision = await authorisationPort(fqdnTenant).checkAccess(
      { name: guard.resource, scope: guard.umaScope },
      rawToken
    );
    if (decision.granted) {
      umaGranted = true;
    } else if (
      decision.reason === "keycloak_unavailable" ||
      decision.reason === "resource_not_registered"
    ) {
      // Degrade gracefully — fall through to the static permission check.
      // "keycloak_unavailable" is a transient outage; "resource_not_registered" is a
      // provisioning gap (resource not yet registered on the BFF client). The static
      // requiredPermission is the effective gate in both cases (ADR-ACT-0145).
    } else if (decision.reason === "insufficient_auth_level") {
      return { ok: false, status: 401, code: "stepUpRequired", permission };
    } else {
      return { ok: false, status: 403, code: "permissionRequired", permission };
    }
  }

  const policyDecision = evaluateResourcePolicies(resourcePolicies, {
    actorId: actor.userId,
    actorRoles: actor.roles,
  });
  if (policyDecision.granted) {
    return { ok: true };
  }

  // Static permission check — backward compat and UMA degraded fallback.
  if (!umaGranted && !actor.permissions.includes(guard.requiredPermission)) {
    return { ok: false, status: 403, code: "permissionRequired", permission };
  }

  return { ok: true };
}
