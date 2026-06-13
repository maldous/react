// ---------------------------------------------------------------------------
// Rate limits usecase (ADR-0065 / ADR-ACT-0257)
//
// Per-tenant rate limiting that REUSES the entitlement substrate (the bridge to
// the quota model): the decision order is entitlement → limit, deny-by-default,
// exactly like quota. A presented action is denied at the entitlement step if the
// tenant lacks the policy's entitlement, otherwise at the limit step when the
// fixed-window counter reaches the limit. Server-authoritative; React renders BFF
// state only. Policy changes are audited (audit-before-change).
// ---------------------------------------------------------------------------

import { ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  DeveloperPortalResponse,
  RateLimitAction,
  RateLimitListResponse,
  RateLimitState,
} from "@platform/contracts-admin";
import type { RateLimitRepository } from "../ports/rate-limit-repository.ts";
import type { EntitlementRepository } from "../ports/entitlement-repository.ts";
import type { ApiKeyRepository } from "../ports/api-key-repository.ts";

export interface RateLimitDeps {
  rateLimits: RateLimitRepository;
  entitlements: EntitlementRepository;
  audit: AuditEventPort;
}

export interface RateLimitActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

async function isEntitled(
  entitlements: EntitlementRepository,
  organisationId: string,
  entitlementKey: string
): Promise<boolean> {
  return (await entitlements.getGrant(organisationId, entitlementKey))?.state === "granted";
}

export interface EvaluateRateLimitResult {
  allowed: boolean;
  decidedBy: "no_policy" | "entitlement" | "limit";
  state: RateLimitState;
  used: number;
  limit: number | null;
  windowSeconds: number | null;
}

/**
 * Evaluate (and consume one unit of) a tenant's rate-limit policy for the next
 * action. No configured policy ⇒ allowed (opt-in). Not entitled ⇒ denied at the
 * entitlement step (no counter increment). Otherwise increments the fixed-window
 * counter and denies when it exceeds the limit (action `deny`).
 */
export async function evaluateRateLimit(
  organisationId: string,
  policyKey: string,
  deps: RateLimitDeps
): Promise<EvaluateRateLimitResult> {
  const policy = await deps.rateLimits.getByKey(organisationId, policyKey);
  if (!policy) {
    return {
      allowed: true,
      decidedBy: "no_policy",
      state: "no_policy",
      used: 0,
      limit: null,
      windowSeconds: null,
    };
  }
  if (!(await isEntitled(deps.entitlements, organisationId, policy.entitlementKey))) {
    return {
      allowed: false,
      decidedBy: "entitlement",
      state: "no_entitlement",
      used: 0,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    };
  }
  const used = await deps.rateLimits.incrementAndCount(
    organisationId,
    policyKey,
    policy.windowSeconds
  );
  const exceeded = policy.action === "deny" && used > policy.limit;
  return {
    allowed: !exceeded,
    decidedBy: "limit",
    state: exceeded ? "exceeded" : "within",
    used,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  };
}

/** Throw a typed error when the next action is not allowed (entitlement or limit). */
export async function assertRateLimit(
  organisationId: string,
  policyKey: string,
  deps: RateLimitDeps
): Promise<void> {
  const r = await evaluateRateLimit(organisationId, policyKey, deps);
  if (r.allowed) return;
  if (r.decidedBy === "entitlement") {
    throw new ForbiddenError("api.error.notEntitled", { safeDetails: { policy: policyKey } });
  }
  throw new ForbiddenError("api.error.rateLimited", {
    safeDetails: {
      policy: policyKey,
      used: r.used,
      limit: r.limit,
      windowSeconds: r.windowSeconds,
    },
  });
}

/** List a tenant's rate-limit policies with the live window count + derived state. */
export async function listRateLimits(
  organisationId: string,
  deps: RateLimitDeps,
  opts: { operator?: boolean } = {}
): Promise<RateLimitListResponse> {
  const defs = opts.operator
    ? await deps.rateLimits.listForTenantAsOperator(organisationId)
    : await deps.rateLimits.listForTenant(organisationId);
  const policies = await Promise.all(
    defs.map(async (p) => {
      const entitled = await isEntitled(deps.entitlements, organisationId, p.entitlementKey);
      // Peek (no increment) at the current window count for display.
      const used = entitled
        ? await deps.rateLimits.currentCount(organisationId, p.policyKey, p.windowSeconds)
        : 0;
      const exceeded = entitled && p.action === "deny" && used >= p.limit;
      const state: RateLimitState = !entitled ? "no_entitlement" : exceeded ? "exceeded" : "within";
      return {
        policyKey: p.policyKey,
        entitlementKey:
          p.entitlementKey as RateLimitListResponse["policies"][number]["entitlementKey"],
        limit: p.limit,
        windowSeconds: p.windowSeconds,
        action: p.action,
        used,
        state,
        updatedAt: p.updatedAt,
        updatedBy: p.updatedBy,
      };
    })
  );
  return { policies };
}

export type SetRateLimitResult = { kind: "ok"; policyKey: string };

/** Operator-only, audited rate-limit policy set. Audit-before-change. */
export async function setRateLimit(
  input: {
    organisationId: string;
    policyKey: string;
    entitlementKey: string;
    limit: number;
    windowSeconds: number;
    action?: RateLimitAction | undefined;
    actor: RateLimitActor;
  },
  deps: RateLimitDeps
): Promise<SetRateLimitResult> {
  const action: RateLimitAction = input.action ?? "deny";
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.RateLimitSet,
      resource: "rate_limit",
      resourceId: input.policyKey,
      metadata: {
        entitlementKey: input.entitlementKey,
        limit: input.limit,
        windowSeconds: input.windowSeconds,
        action,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.rateLimits.upsert({
    organisationId: input.organisationId,
    policyKey: input.policyKey,
    entitlementKey: input.entitlementKey,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    action,
    updatedBy: input.actor.actorId,
  });
  return { kind: "ok", policyKey: input.policyKey };
}

// ---------------------------------------------------------------------------
// Developer portal foundation (read-only). Non-secret summary of the tenant's
// programmatic-access posture + where to find the API surface (ADR-0013).
// ---------------------------------------------------------------------------

export interface DeveloperPortalDeps {
  apiKeys: ApiKeyRepository;
  rateLimits: RateLimitRepository;
  entitlements: EntitlementRepository;
}

export async function getDeveloperPortal(
  organisationId: string,
  deps: DeveloperPortalDeps,
  nowMs: number = Date.now()
): Promise<DeveloperPortalResponse> {
  const entitled =
    (await deps.entitlements.getGrant(organisationId, "api_access"))?.state === "granted";
  const keys = await deps.apiKeys.listForTenant(organisationId);
  const activeKeyCount = keys.filter(
    (k) => !k.revokedAt && !(k.expiresAt && Date.parse(k.expiresAt) <= nowMs)
  ).length;
  const policies = await deps.rateLimits.listForTenant(organisationId);
  return {
    apiAccessEntitled: entitled,
    activeKeyCount,
    graphqlEndpoint: "/api/graphql",
    restBaselinePath: "/api",
    openapiPath: "/api/openapi.json",
    scopes: ["read", "write", "admin"],
    rateLimitPolicyCount: policies.length,
  };
}
