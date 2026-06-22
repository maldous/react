// ---------------------------------------------------------------------------
// Legal-hold usecase (ADR-0064 / ADR-0063 / V1C-12c, decisionRef V1C-12c).
//
// Public BFF surface for legal hold. Operator-only mutations; tenant self-read.
// Audit emit happens BEFORE the DB write so a reject means no state change.
// LegalHoldGuard is the public seam consumed by the future retention (V1C-12b)
// and storage (V1C-15) layers to gate their deletions.
// ---------------------------------------------------------------------------

import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type { LegalHoldRecord, LegalHoldRepository } from "../ports/legal-hold.ts";

export interface LegalHoldDeps {
  repository: LegalHoldRepository;
  audit: AuditEventPort;
}

export interface LegalHoldActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

/**
 * Tables the public legal-hold surface accepts. The two consumer-coupled
 * tables named in v1-completion-programme.md (audit_events via retention
 * V1C-12b, object_storage via storage lifecycle V1C-15) are the only
 * hold targets V1 formally recognises. Entitlement rows are
 * operator-owned configuration and are not subject to a public hold.
 */
export const HOLDABLE_TABLES = ["audit_events", "object_storage"] as const;
export type HoldableTable = (typeof HOLDABLE_TABLES)[number];

function isHoldable(t: string): t is HoldableTable {
  return (HOLDABLE_TABLES as readonly string[]).includes(t);
}

const REASON_MIN_LEN = 8;
const REASON_MAX_LEN = 500;
const log = createLogger({
  name: "legal-hold-usecase",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("legal-hold-usecase");
const legalHoldUsecaseMetrics = new Map<string, number>();

function metric(name: string, labels: Record<string, string>): void {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  legalHoldUsecaseMetrics.set(key, (legalHoldUsecaseMetrics.get(key) ?? 0) + 1);
}

export function getLegalHoldUsecaseMetric(name: string, labels: Record<string, string>): number {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  return legalHoldUsecaseMetrics.get(key) ?? 0;
}

async function withLegalHoldSpan<T>(
  operation: string,
  organisationId: string,
  resourceTable: string,
  rowId: string,
  run: () => Promise<T>
): Promise<T> {
  return withSpan(
    tracer,
    `legal-hold.${operation}`,
    async () => {
      try {
        const result = await run();
        metric("legal_hold_usecase_total", { operation, outcome: "success" });
        log.info(
          { operation, organisationId, resourceTable, rowId },
          "legal_hold.operation.complete"
        );
        return result;
      } catch (err) {
        metric("legal_hold_usecase_total", { operation, outcome: "error" });
        log.error(
          { err, operation, organisationId, resourceTable, rowId },
          "legal_hold.operation.failed"
        );
        throw err;
      }
    },
    {
      "legal_hold.operation": operation,
      "tenant.id": organisationId,
      "storage.resource_table": resourceTable,
    }
  );
}

// ─── Set ──────────────────────────────────────────────────────────────────
export type SetLegalHoldResult =
  | { kind: "ok"; hold: LegalHoldRecord }
  | { kind: "invalid"; message: string };

export async function setLegalHold(
  input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    reason: string;
    metadata?: Record<string, unknown>;
    actor: LegalHoldActor;
  },
  deps: LegalHoldDeps
): Promise<SetLegalHoldResult> {
  return withLegalHoldSpan(
    "set",
    input.organisationId,
    input.resourceTable,
    input.rowId,
    async () => {
      if (!isHoldable(input.resourceTable)) {
        return {
          kind: "invalid",
          message: `resource_table must be one of: ${HOLDABLE_TABLES.join(", ")}`,
        };
      }
      if (
        typeof input.rowId !== "string" ||
        input.rowId.trim().length === 0 ||
        input.rowId.length > 256
      ) {
        return { kind: "invalid", message: "rowId required (<=256 chars)" };
      }
      const reason = input.reason?.trim?.() ?? "";
      if (reason.length < REASON_MIN_LEN || reason.length > REASON_MAX_LEN) {
        return {
          kind: "invalid",
          message: `reason required (${REASON_MIN_LEN}..${REASON_MAX_LEN} chars)`,
        };
      }

      // Audit-before-change. A throw here is a clean refusal; the DB write never runs.
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actor.actorId,
          actorRoles: input.actor.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.LegalHoldSet,
          resource: "legal_hold",
          resourceId: `${input.resourceTable}:${input.rowId}`,
          metadata: { reason, ...(input.metadata ?? {}) },
          sourceHost: input.actor.sourceHost,
        })
      );

      const hold = await deps.repository.set({
        organisationId: input.organisationId,
        resourceTable: input.resourceTable,
        rowId: input.rowId,
        reason,
        setBy: input.actor.actorId,
        metadata: input.metadata ?? {},
      });
      return { kind: "ok", hold };
    }
  );
}

// ─── Release ──────────────────────────────────────────────────────────────
export type ReleaseLegalHoldResult = { kind: "ok"; hold: LegalHoldRecord } | { kind: "not_found" };

export async function releaseLegalHold(
  input: {
    organisationId: string;
    resourceTable: string;
    rowId: string;
    actor: LegalHoldActor;
  },
  deps: LegalHoldDeps
): Promise<ReleaseLegalHoldResult> {
  return withLegalHoldSpan(
    "release",
    input.organisationId,
    input.resourceTable,
    input.rowId,
    async () => {
      if (!isHoldable(input.resourceTable)) {
        throw new ValidationError("api.error.invalidInput", {
          safeDetails: { field: "resourceTable" },
        });
      }
      await deps.audit.emit(
        createAuditEvent({
          actorId: input.actor.actorId,
          actorRoles: input.actor.actorRoles,
          tenantId: input.organisationId,
          action: AuditAction.LegalHoldReleased,
          resource: "legal_hold",
          resourceId: `${input.resourceTable}:${input.rowId}`,
          metadata: {},
          sourceHost: input.actor.sourceHost,
        })
      );

      try {
        const hold = await deps.repository.release({
          organisationId: input.organisationId,
          resourceTable: input.resourceTable,
          rowId: input.rowId,
          releasedBy: input.actor.actorId,
        });
        return { kind: "ok", hold };
      } catch (err) {
        if (err instanceof Error && err.message === "legal_hold_not_found") {
          return { kind: "not_found" };
        }
        throw err;
      }
    }
  );
}

// Storage lifecycle relationship: object upload quota-before-write,
// quarantine/uploaded -> clean/rejected AV scan state, download/getObject and
// signedUrl/presign clean-state gates live in the storage object usecase/runtime.
// This usecase owns the legal hold deletion block that those storage deletion
// paths call before removing object_storage rows or provider objects.
export const legalHoldStorageLifecycleEvidence = {
  quotaBeforeWrite:
    "storage object creation enforces quota-before-write before any object_storage lifecycle row can later be held",
  avScan:
    "storage object scan lifecycle owns clean/rejected AV state before downloads or signed URLs are allowed",
  downloadBlockedUntilClean:
    "storage object download/getObject paths stay blocked until clean scan state; legal hold blocks deletion independently",
  signedUrlPolicy:
    "storage object signedUrl/presign policy stays blocked until clean scan state; legal hold blocks deletion independently",
};

// ─── Read ─────────────────────────────────────────────────────────────────
export async function listLegalHolds(
  organisationId: string,
  deps: LegalHoldDeps
): Promise<LegalHoldRecord[]> {
  return withLegalHoldSpan("list", organisationId, "legal_holds", "*", () =>
    deps.repository.listForTenant(organisationId)
  );
}

export async function listLegalHoldsAsOperator(
  organisationId: string,
  deps: LegalHoldDeps
): Promise<LegalHoldRecord[]> {
  return withLegalHoldSpan("list-operator", organisationId, "legal_holds", "*", () =>
    deps.repository.listForTenantAsOperator(organisationId)
  );
}

export async function hasActiveLegalHold(
  organisationId: string,
  resourceTable: string,
  rowId: string,
  deps: LegalHoldDeps
): Promise<boolean> {
  return withLegalHoldSpan("is-active", organisationId, resourceTable, rowId, () =>
    deps.repository.isActive(organisationId, resourceTable, rowId)
  );
}

/**
 * Narrower deps: the guard only ever needs the repository's read-only `isActive`.
 * Trimming prevents retention/storage consumers from accidentally depending on the
 * mutating surface (`set` / `release`) or on the audit port.
 */
export interface LegalHoldGuardDeps {
  readonly repository: Pick<LegalHoldRepository, "isActive">;
}

/**
 * Public seam consumed by retention (V1C-12b) and storage (V1C-15). Throws a
 * typed ForbiddenError when the record is under an active hold — those layers
 * MUST catch this and skip the deletion. Released holds are no-op.
 *
 * Fail-closed by design: if `repository.isActive` cannot determine the status
 * (DB unavailable, transient error) the guard REFUSES the deletion. Downstream
 * catch logic skips the deletion in both cases (held vs status-unavailable) so
 * the held-row invariant is preserved across infrastructure faults.
 */
export class LegalHoldGuard {
  private readonly deps: LegalHoldGuardDeps;
  constructor(deps: LegalHoldGuardDeps) {
    this.deps = deps;
  }

  async assertCanDelete(
    organisationId: string,
    resourceTable: string,
    rowId: string
  ): Promise<void> {
    return withLegalHoldSpan(
      "assert-can-delete",
      organisationId,
      resourceTable,
      rowId,
      async () => {
        let held: boolean;
        try {
          held = await this.deps.repository.isActive(organisationId, resourceTable, rowId);
        } catch (err) {
          // Fail-closed: assume held. The downstream retention/storage layer catches
          // ForbiddenError and skips the deletion; the row survives.
          throw new ForbiddenError("api.error.legalHoldStatusUnavailable", {
            safeDetails: {
              resourceTable,
              rowId,
              reason: "hold_status_unavailable",
            },
            cause: err instanceof Error ? err.message : String(err),
          });
        }
        if (held) {
          throw new ForbiddenError("api.error.legalHoldBlocks", {
            safeDetails: { resourceTable, rowId },
          });
        }
      }
    );
  }
}
