// ---------------------------------------------------------------------------
// Quota usecase (ADR-0067 / ADR-ACT-0256)
//
// Real quota enforcement (replaces the Phase-1 no-op hook). The decision chain,
// after the pipeline's permission step, is: entitlement → quota. "Is the next
// action allowed under the tenant's entitlement/limit?" Server-authoritative;
// React only renders the state the BFF returns. Quota changes are audited
// (audit-before-change). Quota answers allow/deny — never "what to charge".
// ---------------------------------------------------------------------------

import { ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  QuotaAction,
  QuotaListResponse,
  QuotaState,
  QuotaWindow,
} from "@platform/contracts-admin";
import type { MeteringRepository } from "../ports/metering-repository.ts";
import type { QuotaRecord, QuotaRepository } from "../ports/quota-repository.ts";
import type { EntitlementRepository } from "../ports/entitlement-repository.ts";

/** Aggregate usage for a quota: zero when not entitled, else operator vs tenant aggregate. */
async function resolveUsage(
  deps: QuotaDeps,
  organisationId: string,
  q: QuotaRecord,
  entitled: boolean,
  operator: boolean
): Promise<number> {
  if (!entitled) return 0;
  if (operator) {
    return deps.metering.aggregateAsOperator(organisationId, q.meterKey, q.window);
  }
  return deps.metering.aggregate(organisationId, q.meterKey, q.window);
}

/** Live quota state: no entitlement → exceeded → within. */
function resolveQuotaState(entitled: boolean, exceeded: boolean): QuotaState {
  if (!entitled) return "no_entitlement";
  if (exceeded) return "exceeded";
  return "within";
}

export interface QuotaDeps {
  quota: QuotaRepository;
  metering: MeteringRepository;
  entitlements: EntitlementRepository;
  audit: AuditEventPort;
}

export interface EntitlementActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

export interface EvaluateQuotaResult {
  allowed: boolean;
  decidedBy: "no_quota" | "entitlement" | "quota";
  state: QuotaState;
  usage: number;
  limit: number | null;
  window: QuotaWindow | null;
}

async function isEntitled(
  entitlements: EntitlementRepository,
  organisationId: string,
  entitlementKey: string
): Promise<boolean> {
  return (await entitlements.getGrant(organisationId, entitlementKey))?.state === "granted";
}

/**
 * Evaluate a tenant's quota for the next action. Deny-by-default ordering:
 * entitlement is checked BEFORE quota, so an un-entitled tenant is denied at the
 * entitlement step (never reaching the usage/limit comparison). No configured
 * quota ⇒ allowed (quotas are opt-in per tenant).
 */
export async function evaluateQuota(
  organisationId: string,
  quotaKey: string,
  deps: QuotaDeps,
  opts: { operator?: boolean } = {}
): Promise<EvaluateQuotaResult> {
  const q = await deps.quota.getByKey(organisationId, quotaKey);
  if (!q) {
    return {
      allowed: true,
      decidedBy: "no_quota",
      state: "no_quota",
      usage: 0,
      limit: null,
      window: null,
    };
  }
  if (!(await isEntitled(deps.entitlements, organisationId, q.entitlementKey))) {
    return {
      allowed: false,
      decidedBy: "entitlement",
      state: "no_entitlement",
      usage: 0,
      limit: q.limit,
      window: q.window,
    };
  }
  const usage = opts.operator
    ? await deps.metering.aggregateAsOperator(organisationId, q.meterKey, q.window)
    : await deps.metering.aggregate(organisationId, q.meterKey, q.window);
  const exceeded = q.action === "deny" && usage >= q.limit;
  return {
    allowed: !exceeded,
    decidedBy: "quota",
    state: exceeded ? "exceeded" : "within",
    usage,
    limit: q.limit,
    window: q.window,
  };
}

/** Throw a typed error when the next action is not allowed (entitlement or quota). */
export async function assertQuota(
  organisationId: string,
  quotaKey: string,
  deps: QuotaDeps,
  opts: { operator?: boolean } = {}
): Promise<void> {
  const r = await evaluateQuota(organisationId, quotaKey, deps, opts);
  if (r.allowed) return;
  if (r.decidedBy === "entitlement") {
    throw new ForbiddenError("api.error.notEntitled", { safeDetails: { quota: quotaKey } });
  }
  throw new ForbiddenError("api.error.quotaExceeded", {
    safeDetails: { quota: quotaKey, usage: r.usage, limit: r.limit, window: r.window },
  });
}

/** List a tenant's quotas with current usage + live allow/deny state. */
export async function listQuotas(
  organisationId: string,
  deps: QuotaDeps,
  opts: { operator?: boolean } = {}
): Promise<QuotaListResponse> {
  const defs = opts.operator
    ? await deps.quota.listForTenantAsOperator(organisationId)
    : await deps.quota.listForTenant(organisationId);
  const quotas = await Promise.all(
    defs.map(async (q) => {
      const entitled = await isEntitled(deps.entitlements, organisationId, q.entitlementKey);
      const usage = await resolveUsage(deps, organisationId, q, entitled, opts.operator ?? false);
      const exceeded = entitled && q.action === "deny" && usage >= q.limit;
      const state = resolveQuotaState(entitled, exceeded);
      return {
        quotaKey: q.quotaKey,
        entitlementKey: q.entitlementKey,
        meterKey: q.meterKey as QuotaListResponse["quotas"][number]["meterKey"],
        limit: q.limit,
        window: q.window,
        action: q.action,
        usage,
        allowed: entitled && !exceeded,
        state,
        updatedAt: q.updatedAt,
        updatedBy: q.updatedBy,
      };
    })
  );
  return { quotas };
}

export type SetQuotaResult = { kind: "ok"; quotaKey: string };

/** Operator-only, audited quota set. Audit-before-change: if the audit write fails,
 * the upsert never runs (the exception propagates). Tenants can never set quotas. */
export async function setQuota(
  input: {
    organisationId: string;
    quotaKey: string;
    entitlementKey: string;
    meterKey: string;
    limit: number;
    window: QuotaWindow;
    action?: QuotaAction;
    actor: EntitlementActor;
  },
  deps: QuotaDeps
): Promise<SetQuotaResult> {
  const action: QuotaAction = input.action ?? "deny";
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.QuotaSet,
      resource: "quota",
      resourceId: input.quotaKey,
      metadata: {
        entitlementKey: input.entitlementKey,
        meterKey: input.meterKey,
        limit: input.limit,
        window: input.window,
        action,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.quota.upsert({
    organisationId: input.organisationId,
    quotaKey: input.quotaKey,
    entitlementKey: input.entitlementKey,
    meterKey: input.meterKey,
    limit: input.limit,
    window: input.window,
    action,
    updatedBy: input.actor.actorId,
  });
  return { kind: "ok", quotaKey: input.quotaKey };
}
