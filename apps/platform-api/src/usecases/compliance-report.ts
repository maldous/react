// ---------------------------------------------------------------------------
// Compliance report usecase (ADR-0063 / V1C-19).
//
// Composes already-delivered foundation data into a tenant-scoped compliance
// report: retention, legal holds, observability signal count, open incident
// count, and storage readiness. This is a reporting seam only; it does not
// invent new policy or persistence. The goal is a deterministic report payload
// that can back an operator screen / evidence pack later.
// ---------------------------------------------------------------------------

import type { TenantStorageReadinessResponse } from "@platform/contracts-admin";
import type { IncidentRepository, MetricRepository } from "../ports/observability-repository.ts";
import type { LegalHoldRepository } from "../ports/legal-hold.ts";
import type { RetentionRepository } from "../ports/retention.ts";

export interface ComplianceReportDeps {
  metrics: Pick<MetricRepository, "countSignals">;
  incidents: Pick<IncidentRepository, "countOpen">;
  legalHolds: Pick<LegalHoldRepository, "listForTenant">;
  retention: Pick<RetentionRepository, "listPoliciesForTenant">;
  storage: TenantStorageReadinessResponse;
}

export interface ComplianceReport {
  organisationId: string;
  generatedAt: string;
  storage: TenantStorageReadinessResponse;
  metricsSignals: number;
  openIncidents: number;
  legalHoldCount: number;
  retentionPolicyCount: number;
  ready: boolean;
  summary: string;
}

export async function generateComplianceReport(
  organisationId: string,
  deps: ComplianceReportDeps
): Promise<ComplianceReport> {
  const [signals, incidents, legalHolds, retentionPolicies] = await Promise.all([
    deps.metrics.countSignals(),
    deps.incidents.countOpen(),
    deps.legalHolds.listForTenant(organisationId),
    deps.retention.listPoliciesForTenant(organisationId),
  ]);
  const ready =
    deps.storage.status === "configured" &&
    signals > 0 &&
    retentionPolicies.length > 0 &&
    legalHolds.length >= 0 &&
    incidents >= 0;
  return {
    organisationId,
    generatedAt: new Date().toISOString(),
    storage: deps.storage,
    metricsSignals: signals,
    openIncidents: incidents,
    legalHoldCount: legalHolds.length,
    retentionPolicyCount: retentionPolicies.length,
    ready,
    summary: ready
      ? "Compliance foundations are present and cross-linked."
      : "Compliance foundations are present but one or more inputs are still missing.",
  };
}
