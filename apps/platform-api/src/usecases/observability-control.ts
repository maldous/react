import { getObservabilityReadiness } from "./observability.ts";
import { PostgresObservabilityRepository } from "../adapters/postgres-observability-repository.ts";
import { PostgresNotificationRepository } from "../adapters/postgres-notification-repository.ts";
import { createPostgresAuditEventPort } from "@platform/audit-events";
import { getApplicationPool } from "../server/dependencies.ts";

export interface ObservabilityControlReport {
  metrics: "prometheus";
  traces: "tempo";
  alerts: "alertmanager";
  logs: "loki";
  errorCapture: "sentry";
  readiness: Awaited<ReturnType<typeof getObservabilityReadiness>>;
  ready: boolean;
  summary: string;
}

export async function getObservabilityControlReport(): Promise<ObservabilityControlReport> {
  const pool = getApplicationPool();
  const repo = new PostgresObservabilityRepository(pool);
  const readiness = await getObservabilityReadiness({
    metrics: repo,
    alerts: repo,
    incidents: repo,
    audit: createPostgresAuditEventPort(pool),
    notifications: {
      notifications: new PostgresNotificationRepository(pool),
      audit: createPostgresAuditEventPort(pool),
    },
  });
  return {
    metrics: "prometheus",
    traces: "tempo",
    alerts: "alertmanager",
    logs: "loki",
    errorCapture: "sentry",
    readiness,
    ready: readiness.status === "ready",
    summary:
      readiness.status === "ready"
        ? "Observability backends are available and platform incidents can be driven from alerts."
        : "One or more observability backends are not fully ready.",
  };
}
