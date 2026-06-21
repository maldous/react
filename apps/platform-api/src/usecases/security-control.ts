export interface SecurityControlReport {
  provider: "clamav";
  status: "configured" | "not_configured" | "degraded";
  metrics: "prometheus" | "not_configured";
  traces: "tempo" | "not_configured";
  logs: "loki" | "not_configured";
  errorCapture: "sentry" | "not_configured";
  quarantineMode: boolean;
  failClosed: boolean;
  summary: string;
}

export async function getSecurityControlReport(): Promise<SecurityControlReport> {
  const quarantineMode = true;
  const failClosed = true;
  return {
    provider: "clamav",
    status: "configured",
    metrics: "prometheus",
    traces: "tempo",
    logs: "loki",
    errorCapture: "sentry",
    quarantineMode,
    failClosed,
    summary: "ClamAV scan boundary is modeled as fail-closed quarantine.",
  };
}
