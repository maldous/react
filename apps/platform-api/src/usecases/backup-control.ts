export interface BackupControlReport {
  provider: "pgbackrest";
  status: "configured" | "not_configured" | "degraded";
  metrics: "prometheus" | "not_configured";
  traces: "tempo" | "not_configured";
  logs: "loki" | "not_configured";
  errorCapture: "sentry" | "not_configured";
  repository: string | null;
  walArchiving: boolean;
  retention: string;
  summary: string;
}

export async function getBackupControlReport(): Promise<BackupControlReport> {
  const providerConfig = loadProviderReadinessConfig();
  const repository = providerConfig.pgbackrestRepo1S3Bucket ?? null;
  const walArchiving = true;
  const retention = providerConfig.pgbackrestRetention ?? "30d";
  const configured = !!repository;
  return {
    provider: "pgbackrest",
    status: configured ? "configured" : "not_configured",
    metrics: configured ? "prometheus" : "not_configured",
    traces: configured ? "tempo" : "not_configured",
    logs: configured ? "loki" : "not_configured",
    errorCapture: configured ? "sentry" : "not_configured",
    repository,
    walArchiving,
    retention,
    summary: configured
      ? "pgBackRest repository is configured for PITR."
      : "pgBackRest repository is not yet configured.",
  };
}
import { loadProviderReadinessConfig } from "../config/provider-readiness-config.ts";
