// Typed REST client for the Phase-7 monitoring surface — metric signals, alert rules,
// incidents (ADR-0062 / ADR-ACT-0261). REST-over-BFF; operator-only. A fired alert
// opens an incident and dispatches a preference-gated notification (server-side).

import type {
  AlertListResponse,
  CreateAlertRuleRequest,
  EvaluateAlertResponse,
  IncidentListResponse,
  MetricSignalListResponse,
  ObservabilityReadinessResponse,
  UpdateIncidentRequest,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  MetricSignalListResponse,
  AlertListResponse,
  CreateAlertRuleRequest,
  EvaluateAlertResponse,
  IncidentListResponse,
  ObservabilityReadinessResponse,
  UpdateIncidentRequest,
};

const q = (id: string) => `organisationId=${encodeURIComponent(id)}`;

export function getObservabilityReadiness(): Promise<ObservabilityReadinessResponse> {
  return adminGet<ObservabilityReadinessResponse>("/api/admin/observability/readiness");
}
export function listSignals(organisationId: string): Promise<MetricSignalListResponse> {
  return adminGet<MetricSignalListResponse>(
    `/api/admin/observability/signals?${q(organisationId)}`
  );
}
export function listAlerts(organisationId: string): Promise<AlertListResponse> {
  return adminGet<AlertListResponse>(`/api/admin/alerts?${q(organisationId)}`);
}
export function createAlert(input: CreateAlertRuleRequest): Promise<unknown> {
  return adminSend("POST", "/api/admin/alerts", input);
}
export function evaluateAlert(alertId: string): Promise<EvaluateAlertResponse> {
  return adminSend<EvaluateAlertResponse>(
    "POST",
    `/api/admin/alerts/${encodeURIComponent(alertId)}/evaluate`
  );
}
export function listIncidents(organisationId: string): Promise<IncidentListResponse> {
  return adminGet<IncidentListResponse>(`/api/admin/incidents?${q(organisationId)}`);
}
export function updateIncident(incidentId: string, input: UpdateIncidentRequest): Promise<unknown> {
  return adminSend("PATCH", `/api/admin/incidents/${encodeURIComponent(incidentId)}`, input);
}
