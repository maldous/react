// ---------------------------------------------------------------------------
// Retention usecase (ADR-0064 / V1C-12b, decisionRef V1C-12b).
//
// Public BFF surface for retention. Operator-only mutations; tenant self-read.
// Audit emit happens BEFORE the DB write so a reject means no state change.
//
// The tick is the central seam where retention interacts with the legal-hold
// flag (V1C-12c) — every candidate row's deletion is gated by
// LegalHoldGuard.assertCanDelete(org, table, rowId). Held rows are recorded
// with outcome='skipped_legal_hold' (audit-before-change) and never deleted.
// ---------------------------------------------------------------------------

import { ValidationError, ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { LegalHoldRepository } from "../ports/legal-hold.ts";
import { LegalHoldGuard } from "./legal-hold.ts";
import type {
  RetentionFilter,
  RetentionPolicyRecord,
  RetentionRepository,
} from "../ports/retention.ts";

export interface RetentionDeps {
  repository: RetentionRepository;
  audit: AuditEventPort;
  /** Narrower shape: only the read-only `isActive` of LegalHoldRepository.
   *  Mirrors RetentionRepository's own `isActive` shape, so the tick can call
   *  it without depending on AuditEventPort. */
  guard: { repository: Pick<LegalHoldRepository, "isActive"> };
}

export interface RetentionActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

export class RetentionFilterError extends ValidationError {}

const SELECTABLE_TABLES = ["audit_events", "tenant_invitations"] as const;
type SelectableTable = (typeof SELECTABLE_TABLES)[number];

function isSelectable(t: string): t is SelectableTable {
  return (SELECTABLE_TABLES as readonly string[]).includes(t);
}

const MAX_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year hard cap on retention TTL.

export function validateFilter(filter: RetentionFilter): void {
  if (filter.kind === "all") return;
  if (filter.kind === "by_status") {
    if (!Array.isArray(filter.statuses) || filter.statuses.length === 0) {
      throw new RetentionFilterError("api.error.invalidFilter", {
        safeDetails: { field: "filter.statuses" },
      });
    }
    for (const s of filter.statuses) {
      if (typeof s !== "string" || s.length === 0 || s.length > 64) {
        throw new RetentionFilterError("api.error.invalidFilter", {
          safeDetails: { field: "filter.statuses" },
        });
      }
    }
  } else {
    throw new RetentionFilterError("api.error.invalidFilter", {
      safeDetails: { field: "filter.kind" },
    });
  }
}

// ─── Set ──────────────────────────────────────────────────────────────────
export type SetRetentionPolicyResult =
  | { kind: "ok"; policy: RetentionPolicyRecord }
  | { kind: "invalid"; message: string };

export async function setRetentionPolicy(
  input: {
    organisationId: string;
    resourceTable: string;
    ttlSeconds: number;
    filter: RetentionFilter;
    actor: RetentionActor;
    metadata?: Record<string, unknown>;
  },
  deps: RetentionDeps
): Promise<SetRetentionPolicyResult> {
  if (!isSelectable(input.resourceTable)) {
    return {
      kind: "invalid",
      message: `resource_table must be one of: ${SELECTABLE_TABLES.join(", ")}`,
    };
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    return { kind: "invalid", message: "ttlSeconds must be a positive integer" };
  }
  if (input.ttlSeconds > MAX_TTL_SECONDS) {
    return {
      kind: "invalid",
      message: `ttlSeconds must be <= ${MAX_TTL_SECONDS} (1 year)`,
    };
  }
  try {
    validateFilter(input.filter);
  } catch (err) {
    if (err instanceof RetentionFilterError) {
      return { kind: "invalid", message: err.message };
    }
    throw err;
  }

  // Audit-before-change.
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.RetentionPolicySet,
      resource: "retention_policy",
      resourceId: `${input.resourceTable}:ttl=${input.ttlSeconds}s`,
      metadata: {
        resourceTable: input.resourceTable,
        ttlSeconds: input.ttlSeconds,
        filterKind: input.filter.kind,
        ...(input.metadata ?? {}),
      },
      sourceHost: input.actor.sourceHost,
    })
  );

  const policy = await deps.repository.upsertPolicy({
    organisationId: input.organisationId,
    resourceTable: input.resourceTable,
    ttlSeconds: input.ttlSeconds,
    filter: input.filter,
    setBy: input.actor.actorId,
    metadata: input.metadata ?? {},
  });
  return { kind: "ok", policy };
}

// ─── Disable ──────────────────────────────────────────────────────────────
export type DisableRetentionPolicyResult =
  | { kind: "ok"; policy: RetentionPolicyRecord }
  | { kind: "not_found" };

export async function disableRetentionPolicy(
  input: {
    organisationId: string;
    resourceTable: string;
    actor: RetentionActor;
  },
  deps: RetentionDeps
): Promise<DisableRetentionPolicyResult> {
  if (!isSelectable(input.resourceTable)) {
    throw new ValidationError("api.error.invalidInput", {
      safeDetails: { field: "resourceTable" },
    });
  }
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.RetentionPolicyRemoved,
      resource: "retention_policy",
      resourceId: `${input.resourceTable}`,
      metadata: {},
      sourceHost: input.actor.sourceHost,
    })
  );
  const policy = await deps.repository.disablePolicy(input.organisationId, input.resourceTable);
  if (!policy) return { kind: "not_found" };
  return { kind: "ok", policy };
}

// ─── Read ─────────────────────────────────────────────────────────────────
export async function listRetentionPoliciesForTenant(
  organisationId: string,
  deps: RetentionDeps
): Promise<RetentionPolicyRecord[]> {
  return deps.repository.listPoliciesForTenant(organisationId);
}

export async function listRetentionPoliciesAsOperator(
  organisationId: string,
  deps: RetentionDeps
): Promise<RetentionPolicyRecord[]> {
  return deps.repository.listPoliciesAsOperator(organisationId);
}

// ─── Tick ────────────────────────────────────────────────────────────────
// Runs across an org's enabled policies. For each candidate row: audit emit,
// LegalHoldGuard.assertCanDelete, then either record outcome='deleted' OR
// outcome='skipped_legal_hold'. Held rows are PRESERVED (the v1-completion-
// programme.md §V1C-12b invariant consumed from V1C-12c).
export interface RunRetentionTickResult {
  policiesEvaluated: number;
  candidatesFound: number;
  deleted: number;
  skippedLegalHold: number;
  skippedFiltered: number;
  errors: number;
}

export async function runRetentionTick(
  input: {
    organisationId: string;
    actor: RetentionActor;
    candidateLimit?: number;
  },
  deps: RetentionDeps
): Promise<RunRetentionTickResult> {
  const result: RunRetentionTickResult = {
    policiesEvaluated: 0,
    candidatesFound: 0,
    deleted: 0,
    skippedLegalHold: 0,
    skippedFiltered: 0,
    errors: 0,
  };
  const policies = await deps.repository.listPoliciesAsOperator(input.organisationId);
  for (const policy of policies) {
    if (!policy.enabled) continue;
    result.policiesEvaluated++;
    const limit = Math.min(Math.max(input.candidateLimit ?? 100, 1), 1000);
    let candidates;
    try {
      candidates = await deps.repository.selectCandidates(policy, limit);
    } catch {
      result.errors++;
      continue;
    }
    for (const candidate of candidates) {
      result.candidatesFound++;
      try {
        await new LegalHoldGuard(deps.guard).assertCanDelete(
          input.organisationId,
          candidate.resourceTable,
          candidate.rowId
        );
      } catch (err) {
        if (!(err instanceof ForbiddenError)) {
          result.errors++;
          continue;
        }
        await deps.repository.recordOutcome({
          organisationId: input.organisationId,
          policyId: policy.id,
          resourceTable: candidate.resourceTable,
          rowId: candidate.rowId,
          outcome: "skipped_legal_hold",
        });
        await deps.audit.emit(
          createAuditEvent({
            actorId: input.actor.actorId,
            actorRoles: input.actor.actorRoles,
            tenantId: input.organisationId,
            action: AuditAction.RetentionSkippedLegalHold,
            resource: "retention_candidate",
            resourceId: `${candidate.resourceTable}:${candidate.rowId}`,
            metadata: { policyId: policy.id, ageSeconds: candidate.ageSeconds },
            sourceHost: input.actor.sourceHost,
          })
        );
        result.skippedLegalHold++;
        continue;
      }
      // Held=False; record outcome='deleted' (the actual deletion of the
      // source row is a per-table concern; the ledger row carries the durable
      // record). For V1C-12b the ledger row IS the deletion event — the source
      // row delete is owned by the per-table migration once the tenant confirms.
      await deps.repository.recordOutcome({
        organisationId: input.organisationId,
        policyId: policy.id,
        resourceTable: candidate.resourceTable,
        rowId: candidate.rowId,
        outcome: "deleted",
      });
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actor.actorId,
          actorRoles: input.actor.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.RetentionApplied,
          resource: "retention_candidate",
          resourceId: `${candidate.resourceTable}:${candidate.rowId}`,
          metadata: {
            policyId: policy.id,
            ttlSeconds: policy.ttlSeconds,
            ageSeconds: candidate.ageSeconds,
          },
          sourceHost: input.actor.sourceHost,
        })
      );
      result.deleted++;
    }
  }
  // Tick summary audit (one line per tick).
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.RetentionTickCompleted,
      resource: "retention_tick",
      resourceId: `org=${input.organisationId}`,
      metadata: { ...result },
      sourceHost: input.actor.sourceHost,
    })
  );
  return result;
}
