import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateAlertRuleRequest, UpdateIncidentRequest } from "@platform/contracts-admin";
import {
  createAlert,
  evaluateAlert,
  getObservabilityReadiness,
  listAlerts,
  listIncidents,
  listSignals,
  updateIncident,
} from "./admin-monitoring-client";

export const readinessKey = ["admin", "monitoring", "readiness"] as const;
export const signalsKey = (id: string) => ["admin", "monitoring", "signals", id] as const;
export const alertsKey = (id: string) => ["admin", "monitoring", "alerts", id] as const;
export const incidentsKey = (id: string) => ["admin", "monitoring", "incidents", id] as const;

export function useObservabilityReadiness(enabled: boolean) {
  return useQuery({
    queryKey: readinessKey,
    queryFn: getObservabilityReadiness,
    enabled,
    retry: false,
  });
}
export function useSignals(organisationId: string) {
  return useQuery({
    queryKey: signalsKey(organisationId),
    queryFn: () => listSignals(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}
export function useAlerts(organisationId: string) {
  return useQuery({
    queryKey: alertsKey(organisationId),
    queryFn: () => listAlerts(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}
export function useIncidents(organisationId: string) {
  return useQuery({
    queryKey: incidentsKey(organisationId),
    queryFn: () => listIncidents(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}

export function useCreateAlert(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlertRuleRequest) => createAlert(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
export function useEvaluateAlert(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => evaluateAlert(alertId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: readinessKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
export function useUpdateIncident(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { incidentId: string; status: UpdateIncidentRequest["status"] }) =>
      updateIncident(args.incidentId, { status: args.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
