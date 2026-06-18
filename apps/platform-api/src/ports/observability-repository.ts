// ---------------------------------------------------------------------------
// Observability ports (ADR-0062 / ADR-ACT-0261).
//
// Three bounded ports — MetricRepository (signals + samples), AlertRepository (rules),
// IncidentRepository (lifecycle) — satisfied today by the built-in Postgres adapter.
// Tenant-scoped (RLS). Prometheus/Tempo/Alertmanager remain Phase-7.5 providers behind
// MetricRepository/AlertRepository. No secret fields.
// ---------------------------------------------------------------------------

import type {
  AlertComparator,
  AlertSeverity,
  IncidentStatus,
  MetricKind,
  NotificationCategory,
} from "@platform/contracts-admin";

export interface MetricSignalRecord {
  signalKey: string;
  displayName: string;
  unit: string;
  kind: MetricKind;
  description: string;
  latestValue: number | null;
}

export interface RegisterSignalInput {
  organisationId: string;
  signalKey: string;
  displayName: string;
  unit?: string;
  kind?: MetricKind;
  description?: string;
}

export interface MetricRepository {
  registerSignal(input: RegisterSignalInput): Promise<void>;
  listSignals(organisationId: string): Promise<MetricSignalRecord[]>;
  listSignalsAsOperator(organisationId: string): Promise<MetricSignalRecord[]>;
  recordSample(organisationId: string, signalKey: string, value: number): Promise<void>;
  /** Latest observed value for a signal (operator/rls_bypass), or null if none. */
  latestValue(organisationId: string, signalKey: string): Promise<number | null>;
  countSignals(): Promise<number>;
}

export interface AlertRuleRecord {
  id: string;
  ruleKey: string;
  signalKey: string;
  comparator: AlertComparator;
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
  notifyUserId: string | null;
  notifyCategory: NotificationCategory;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertAlertRuleInput {
  organisationId: string;
  ruleKey: string;
  signalKey: string;
  comparator: AlertComparator;
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
  notifyUserId?: string;
  notifyCategory: NotificationCategory;
  updatedBy: string;
}

export interface AlertRepository {
  upsertRule(input: UpsertAlertRuleInput): Promise<void>;
  listRules(organisationId: string): Promise<AlertRuleRecord[]>;
  listRulesAsOperator(organisationId: string): Promise<AlertRuleRecord[]>;
  /** Operator lookup by id across tenants (returns the owning org too). */
  findRuleById(ruleId: string): Promise<(AlertRuleRecord & { organisationId: string }) | null>;
}

export interface IncidentRecord {
  id: string;
  ruleKey: string;
  title: string;
  severity: AlertSeverity;
  status: IncidentStatus;
  observedValue: number | null;
  threshold: number | null;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface OpenIncidentInput {
  organisationId: string;
  alertRuleId: string;
  ruleKey: string;
  title: string;
  severity: AlertSeverity;
  observedValue: number;
  threshold: number;
}

export interface IncidentRepository {
  open(input: OpenIncidentInput): Promise<IncidentRecord>;
  listForTenant(organisationId: string): Promise<IncidentRecord[]>;
  listForTenantAsOperator(organisationId: string): Promise<IncidentRecord[]>;
  findById(incidentId: string): Promise<(IncidentRecord & { organisationId: string }) | null>;
  updateStatus(
    incidentId: string,
    status: IncidentStatus,
    updatedBy: string
  ): Promise<IncidentRecord | null>;
  countOpen(): Promise<number>;
}
