// ---------------------------------------------------------------------------
// Entitlements usecase (ADR-0057 / ADR-0058 / ADR-ACT-0254)
//
// Entitlements answer "what is this tenant allowed to use?". They are NOT feature
// flags and NOT permissions. The runtime rule is deny-by-default: absence of a
// `granted` row means the capability is unavailable. Operator mutations are
// audited BEFORE the write (audit-before-change); a tenant can never self-grant
// (the grant/revoke usecases are only ever called from operator-scoped routes).
//
// The policy chain (ADR-0058) is: session → tenant → route-scope → permission →
// ENTITLEMENT → policy → quota. `evaluateEntitlement` models the entitlement →
// policy → quota tail; `permission` is already enforced upstream by the pipeline.
// Quota is a Phase-1 HOOK only: it always returns "not_enforced" / "not_applicable".
// ---------------------------------------------------------------------------

import { ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  ENTITLEMENT_KEYS,
  type EntitlementKey,
  type EntitlementListResponse,
  type EntitlementSummary,
} from "@platform/contracts-admin";
import type {
  EntitlementGrantRecord,
  EntitlementGrantState,
  EntitlementRepository,
} from "../ports/entitlement-repository.ts";

export interface EntitlementDeps {
  repository: EntitlementRepository;
  audit: AuditEventPort;
}

export interface EntitlementActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

// ---------------------------------------------------------------------------
// Entitlement catalog — the known entitlement keys and their static metadata.
// (What CAN be granted. The per-tenant grant STATE lives in the repository.)
// ---------------------------------------------------------------------------

export interface EntitlementDefinition {
  key: EntitlementKey;
  displayName: string;
  description: string;
  category: string;
  /** A tenant has the capability only when explicitly granted (deny-by-default). */
  defaultState: "revoked";
  requiresProvider: boolean;
  providerKey: string | null;
  /** Phase-1 quota is a hook only — "not_enforced" everywhere; Phase 2 (ADR-0057). */
  quotaStatus: "not_enforced" | "not_applicable";
}

export const ENTITLEMENT_CATALOG: readonly EntitlementDefinition[] = [
  {
    key: "webhooks",
    displayName: "Outbound webhooks",
    description: "Tenant may register and receive signed outbound webhooks.",
    category: "developer-platform",
    defaultState: "revoked",
    requiresProvider: false,
    providerKey: null,
    quotaStatus: "not_enforced",
  },
  {
    key: "custom_domains",
    displayName: "Custom domains",
    description: "Tenant may claim and verify vanity domains.",
    category: "configuration",
    defaultState: "revoked",
    requiresProvider: true,
    providerKey: "caddy-on-demand-tls",
    quotaStatus: "not_enforced",
  },
  {
    key: "advanced_observability",
    displayName: "Advanced observability",
    description: "Tenant-scoped log search and observability signals beyond the baseline.",
    category: "observability-ops",
    defaultState: "revoked",
    requiresProvider: true,
    providerKey: "loki",
    quotaStatus: "not_enforced",
  },
  {
    key: "storage",
    displayName: "Object storage",
    description: "Tenant-isolated object storage with signed access.",
    category: "storage",
    defaultState: "revoked",
    requiresProvider: true,
    providerKey: "minio",
    quotaStatus: "not_enforced",
  },
] as const;

const CATALOG_BY_KEY = new Map<string, EntitlementDefinition>(
  ENTITLEMENT_CATALOG.map((d) => [d.key, d])
);

function toSummary(
  def: EntitlementDefinition,
  record: EntitlementGrantRecord | null
): EntitlementSummary {
  // Deny-by-default: no row OR a revoked row both mean the capability is unavailable.
  const state: EntitlementSummary["state"] =
    record == null ? "not_granted" : record.state === "granted" ? "granted" : "revoked";
  const note =
    record && typeof record.metadata?.["note"] === "string"
      ? (record.metadata["note"] as string)
      : null;
  return {
    key: def.key,
    displayName: def.displayName,
    description: def.description,
    category: def.category,
    state,
    source: record?.source ?? null,
    requiresProvider: def.requiresProvider,
    providerKey: def.providerKey,
    quota: { status: def.quotaStatus },
    note,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? null,
  };
}

/** Merge the static catalog with the tenant's grant rows into a full summary list. */
function buildSummaries(records: EntitlementGrantRecord[]): EntitlementSummary[] {
  const byKey = new Map(records.map((r) => [r.entitlementKey, r]));
  return ENTITLEMENT_CATALOG.map((def) => toSummary(def, byKey.get(def.key) ?? null));
}

/** Tenant self-read (RLS-scoped) — used by GET /api/org/entitlements. */
export async function listTenantEntitlements(
  organisationId: string,
  deps: EntitlementDeps
): Promise<EntitlementListResponse> {
  const records = await deps.repository.listForTenant(organisationId);
  return { entitlements: buildSummaries(records) };
}

/** Operator read of a tenant's entitlements — used by GET /api/admin/tenants/:id/entitlements. */
export async function listEntitlementsForTenant(
  organisationId: string,
  deps: EntitlementDeps
): Promise<EntitlementListResponse> {
  const records = await deps.repository.listForTenantAsOperator(organisationId);
  return { entitlements: buildSummaries(records) };
}

export type SetEntitlementResult =
  | { kind: "ok"; entitlement: EntitlementSummary }
  | { kind: "unknown_key" };

/**
 * Operator-only grant/revoke. Audited BEFORE the write: deps.audit.emit is awaited
 * first, so if the audit write rejects the mutation never runs. Never call from a
 * tenant-scoped route — tenants cannot self-grant (deny-by-default, ADR-0058).
 */
export async function setEntitlement(
  input: {
    organisationId: string;
    key: string;
    state: EntitlementGrantState;
    note?: string | undefined;
    actor: EntitlementActor;
  },
  deps: EntitlementDeps
): Promise<SetEntitlementResult> {
  const def = CATALOG_BY_KEY.get(input.key);
  if (!def) return { kind: "unknown_key" };

  const metadata = input.note ? { note: input.note } : {};

  // Audit-before-change. If this rejects, the upsert below never executes.
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action:
        input.state === "granted" ? AuditAction.EntitlementGranted : AuditAction.EntitlementRevoked,
      resource: "entitlement",
      resourceId: def.key,
      metadata: {
        state: input.state,
        source: "system",
        ...(input.note ? { note: input.note } : {}),
      },
      sourceHost: input.actor.sourceHost,
    })
  );

  const record = await deps.repository.upsert({
    organisationId: input.organisationId,
    entitlementKey: def.key,
    state: input.state,
    source: "system",
    metadata,
    updatedBy: input.actor.actorId,
  });

  return { kind: "ok", entitlement: toSummary(def, record) };
}

// ---------------------------------------------------------------------------
// Policy-chain tail: entitlement → policy → quota (ADR-0058).
// ---------------------------------------------------------------------------

export interface QuotaHookResult {
  /** Phase-1: never "enforced". Quota enforcement is Phase 2 (ADR-0057). */
  status: "not_enforced" | "not_applicable";
}

/** Honest no-op quota hook. Returns the catalog quota status; never enforces. */
export function quotaHook(key: string): QuotaHookResult {
  const def = CATALOG_BY_KEY.get(key);
  return { status: def?.quotaStatus ?? "not_applicable" };
}

/** True iff the tenant has an explicit `granted` row for the key (deny-by-default). */
export async function isEntitled(
  organisationId: string,
  key: string,
  deps: EntitlementDeps
): Promise<boolean> {
  const grant = await deps.repository.getGrant(organisationId, key);
  return grant?.state === "granted";
}

export interface EvaluateEntitlementResult {
  allowed: boolean;
  /** Which step decided: the chain stops at the first failure. */
  decidedBy: "permission" | "entitlement" | "policy" | "quota";
  reason: string;
  quota: QuotaHookResult;
}

/**
 * Evaluate the entitlement → policy → quota tail of the ADR-0058 chain.
 * `hasPermission` represents the upstream permission step (already enforced by the
 * pipeline); it is passed in so the proof can exercise the full ordering. Deny-by-default.
 */
export async function evaluateEntitlement(
  input: { organisationId: string; key: string; hasPermission: boolean },
  deps: EntitlementDeps
): Promise<EvaluateEntitlementResult> {
  const quota = quotaHook(input.key);
  if (!input.hasPermission) {
    return { allowed: false, decidedBy: "permission", reason: "missing permission", quota };
  }
  const entitled = await isEntitled(input.organisationId, input.key, deps);
  if (!entitled) {
    return { allowed: false, decidedBy: "entitlement", reason: "not entitled", quota };
  }
  // Policy step: Phase-1 passthrough (Keycloak UMA already ran upstream as the PDP).
  // Quota step: hook only — never denies in Phase 1.
  return { allowed: true, decidedBy: "quota", reason: "allowed", quota };
}

/** Throw a typed 403 when the tenant is not entitled. For handler-level guards. */
export async function assertEntitlement(
  organisationId: string,
  key: string,
  deps: EntitlementDeps
): Promise<void> {
  if (!(await isEntitled(organisationId, key, deps))) {
    throw new ForbiddenError("api.error.notEntitled", {
      safeDetails: { entitlement: key },
    });
  }
}

export const KNOWN_ENTITLEMENT_KEYS: readonly string[] = ENTITLEMENT_KEYS;
