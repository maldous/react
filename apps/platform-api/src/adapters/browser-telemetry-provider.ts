/**
 * Provider reliability evidence for browser telemetry (Grafana Faro + OTEL).
 *
 * Runtime behavior is represented by browser diagnostics documentation,
 * observability-correlation tools, and e2e trace/correlation proof commands.
 */
export const browserTelemetryProviderReliabilityEvidence = {
  configSource:
    "browser diagnostics config, Faro/OTEL endpoint configuration, e2e scenario metadata, and process.env stage environment configure telemetry correlation",
  secretSource:
    "no browser-exposed secret, credential, token, or apiKey is required; correlation IDs are non-secret bounded identifiers",
  timeout:
    "e2e telemetry correlation and trace proof commands run under Playwright/npm stage timeouts",
  retry:
    "operator retry is explicit after repairing collector, browser instrumentation, or trace correlation inputs",
  degradedMode:
    "missing telemetry, collector, or correlation evidence leaves browser telemetry unassured rather than marked successful",
  failClosed: "trace/correlation verifier failures exit non-zero and block telemetry assurance",
  fallbackRationale:
    "no fallback browser telemetry provider is claimed; Faro/OTEL correlation evidence is the represented runtime substrate",
  healthCheck:
    "tempo-trace, correlation-headers, and observability-correlation tests exercise browser telemetry readiness",
  operatorRecovery:
    "operator recovery: inspect trace/correlation evidence, repair browser instrumentation or collector config, then rerun telemetry proofs",
};
