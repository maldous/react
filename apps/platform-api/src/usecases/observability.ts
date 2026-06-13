// ---------------------------------------------------------------------------
// Observability usecase (ADR-0062 / ADR-ACT-0261)
//
// Built-in observability foundation: a metric-signal registry + sample store,
// operator-managed threshold alert rules, an incident lifecycle, and an
// alert→notification bridge over the Phase-6 substrate. A fired alert opens an
// incident (audited) and dispatches a notification to the rule's target user —
// which the user's preferences gate (a disabled channel suppresses). Tenant-scoped
// (RLS), server-authoritative, no secret fields. Prometheus/Tempo/Alertmanager
// remain Phase-7.5 providers behind the same ports.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  AlertComparator,
  AlertListResponse,
  AlertSeverity,
  EvaluateAlertResponse,
  IncidentListResponse,
  IncidentStatus,
  MetricSignalListResponse,
  NotificationCategory,
  NotificationDispatchResult,
  ObservabilityReadinessResponse,
} from "@platform/contracts-admin";
import type {
  AlertRepository,
  IncidentRepository,
  MetricRepository,
  RegisterSignalInput,
} from "../ports/observability-repository.ts";
import { dispatchNotification, type NotificationsDeps } from "./notifications.ts";

export interface ObservabilityDeps {
  metrics: MetricRepository;
  alerts: AlertRepository;
  incidents: IncidentRepository;
  audit: AuditEventPort;
  /** Phase-6 notification substrate used by the alert→notification bridge. */
  notifications: NotificationsDeps;
}

export interface ObservabilityActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

function compare(value: number, comparator: AlertComparator, threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
  }
}

// --- signals (server-internal register/record; operator list) --------------

export async function registerSignal(
  input: RegisterSignalInput,
  deps: ObservabilityDeps
): Promise<void> {
  if (input.signalKey.trim().length === 0 || input.displayName.trim().length === 0) {
    throw new ValidationError("api.error.signalKeyRequired", {});
  }
  await deps.metrics.registerSignal(input);
}

export async function recordSample(
  organisationId: string,
  signalKey: string,
  value: number,
  deps: ObservabilityDeps
): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new ValidationError("api.error.invalidMetricSample", { safeDetails: { signalKey } });
  }
  await deps.metrics.recordSample(organisationId, signalKey, value);
}

export async function listSignals(
  organisationId: string,
  deps: ObservabilityDeps,
  opts: { operator?: boolean } = {}
): Promise<MetricSignalListResponse> {
  const signals = opts.operator
    ? await deps.metrics.listSignalsAsOperator(organisationId)
    : await deps.metrics.listSignals(organisationId);
  return { signals };
}

// --- alert rules -----------------------------------------------------------

export async function listAlertRules(
  organisationId: string,
  deps: ObservabilityDeps,
  opts: { operator?: boolean } = {}
): Promise<AlertListResponse> {
  const rules = opts.operator
    ? await deps.alerts.listRulesAsOperator(organisationId)
    : await deps.alerts.listRules(organisationId);
  return { rules };
}

/** Operator-only, audited alert-rule upsert. */
export async function setAlertRule(
  input: {
    organisationId: string;
    ruleKey: string;
    signalKey: string;
    comparator: AlertComparator;
    threshold: number;
    severity?: AlertSeverity | undefined;
    enabled?: boolean | undefined;
    notifyUserId?: string | undefined;
    notifyCategory?: NotificationCategory | undefined;
    actor: ObservabilityActor;
  },
  deps: ObservabilityDeps
): Promise<{ ruleKey: string }> {
  const severity: AlertSeverity = input.severity ?? "warning";
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.AlertRuleSet,
      resource: "alert_rule",
      resourceId: input.ruleKey,
      metadata: {
        signalKey: input.signalKey,
        comparator: input.comparator,
        threshold: input.threshold,
        severity,
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.alerts.upsertRule({
    organisationId: input.organisationId,
    ruleKey: input.ruleKey,
    signalKey: input.signalKey,
    comparator: input.comparator,
    threshold: input.threshold,
    severity,
    enabled: input.enabled ?? true,
    notifyUserId: input.notifyUserId,
    notifyCategory: input.notifyCategory ?? "system",
    updatedBy: input.actor.actorId,
  });
  return { ruleKey: input.ruleKey };
}

export type EvaluateAlertResult =
  | { kind: "ok"; response: EvaluateAlertResponse }
  | { kind: "not_found" };

/**
 * Evaluate an alert rule by id against the signal's latest sample. If it fires:
 * open an incident (audited) and dispatch a notification to the rule's target user
 * via the Phase-6 substrate (preferences gate it — a disabled channel suppresses).
 */
export async function evaluateAlert(
  alertId: string,
  deps: ObservabilityDeps,
  actor: ObservabilityActor
): Promise<EvaluateAlertResult> {
  const rule = await deps.alerts.findRuleById(alertId);
  if (!rule) return { kind: "not_found" };

  const base = { ruleKey: rule.ruleKey, threshold: rule.threshold };
  if (!rule.enabled) {
    return {
      kind: "ok",
      response: { ...base, state: "disabled", value: null, incidentId: null, notified: [] },
    };
  }
  const value = await deps.metrics.latestValue(rule.organisationId, rule.signalKey);
  if (value == null) {
    return {
      kind: "ok",
      response: { ...base, state: "no_data", value: null, incidentId: null, notified: [] },
    };
  }
  if (!compare(value, rule.comparator, rule.threshold)) {
    return {
      kind: "ok",
      response: { ...base, state: "within", value, incidentId: null, notified: [] },
    };
  }

  // Fired → open an incident (audit-before-change), then notify.
  await deps.audit.emit(
    createAuditEvent({
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      tenantId: rule.organisationId,
      action: AuditAction.IncidentOpened,
      resource: "incident",
      resourceId: rule.ruleKey,
      metadata: {
        signalKey: rule.signalKey,
        value,
        threshold: rule.threshold,
        severity: rule.severity,
      },
      sourceHost: actor.sourceHost,
    })
  );
  const incident = await deps.incidents.open({
    organisationId: rule.organisationId,
    alertRuleId: rule.id,
    ruleKey: rule.ruleKey,
    title: `${rule.severity.toUpperCase()}: ${rule.ruleKey} (${rule.signalKey} ${rule.comparator} ${rule.threshold})`,
    severity: rule.severity,
    observedValue: value,
    threshold: rule.threshold,
  });

  let notified: NotificationDispatchResult[] = [];
  if (rule.notifyUserId) {
    notified = await dispatchNotification(
      {
        organisationId: rule.organisationId,
        userId: rule.notifyUserId,
        category: rule.notifyCategory,
        // Non-secret subject only; no metric payload fields that could carry secrets.
        subject: `Alert ${rule.ruleKey} fired (incident ${incident.id})`,
      },
      deps.notifications,
      { operator: true }
    );
  }
  return {
    kind: "ok",
    response: { ...base, state: "fired", value, incidentId: incident.id, notified },
  };
}

// --- incidents -------------------------------------------------------------

export async function listIncidents(
  organisationId: string,
  deps: ObservabilityDeps,
  opts: { operator?: boolean } = {}
): Promise<IncidentListResponse> {
  const incidents = opts.operator
    ? await deps.incidents.listForTenantAsOperator(organisationId)
    : await deps.incidents.listForTenant(organisationId);
  return { incidents };
}

export type UpdateIncidentResult =
  | { kind: "ok"; incident: IncidentListResponse["incidents"][number] }
  | { kind: "not_found" };

/** Operator-only, audited incident lifecycle transition. */
export async function updateIncident(
  input: { incidentId: string; status: IncidentStatus; actor: ObservabilityActor },
  deps: ObservabilityDeps
): Promise<UpdateIncidentResult> {
  const existing = await deps.incidents.findById(input.incidentId);
  if (!existing) return { kind: "not_found" };
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: existing.organisationId,
      action: AuditAction.IncidentUpdated,
      resource: "incident",
      resourceId: input.incidentId,
      metadata: { status: input.status },
      sourceHost: input.actor.sourceHost,
    })
  );
  const incident = await deps.incidents.updateStatus(
    input.incidentId,
    input.status,
    input.actor.actorId
  );
  return incident ? { kind: "ok", incident } : { kind: "not_found" };
}

// --- readiness (never faked) ----------------------------------------------

export async function getObservabilityReadiness(
  deps: ObservabilityDeps
): Promise<ObservabilityReadinessResponse> {
  try {
    const signalCount = await deps.metrics.countSignals();
    const openIncidentCount = await deps.incidents.countOpen();
    return {
      backend: "postgres-builtin",
      status: signalCount > 0 ? "ready" : "degraded",
      signalCount,
      openIncidentCount,
      detail:
        signalCount > 0
          ? "Built-in observability store reachable with registered signals."
          : "Built-in observability store reachable but no signals registered yet.",
    };
  } catch (err) {
    return {
      backend: "postgres-builtin",
      status: "blocked",
      signalCount: 0,
      openIncidentCount: 0,
      detail: `Observability store unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
