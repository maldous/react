// ---------------------------------------------------------------------------
// ObservabilityProbeConfig — typed projection for the BFF's infra-readiness
// probes surfaced in the ops cockpit (tenant-observability; V1C-CONF-06).
//
// Distinct from observability-config.ts (which configures THIS process's own
// OTEL/Sentry): these are the *endpoints the BFF probes*. All optional; the
// computed `*_URL ?? http://localhost:${*_PORT}` derivation stays in the caller
// (it cannot be a static schema default). Behaviour preserved exactly.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const OBSERVABILITY_PROBE_CONFIG_SCHEMA = {
  grafanaUrl: {
    key: "GRAFANA_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Explicit Grafana base URL (else derived from GRAFANA_PORT).",
  },
  grafanaPort: {
    key: "GRAFANA_PORT",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Local Grafana port for the derived health URL.",
  },
  otelHealthUrl: {
    key: "OTEL_HEALTH_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Explicit OTEL collector health URL (else derived from OTEL_HEALTH_PORT).",
  },
  otelHealthPort: {
    key: "OTEL_HEALTH_PORT",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Local OTEL collector health port for the derived URL.",
  },
  prometheusUrl: {
    key: "PROMETHEUS_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Prometheus base URL (metrics probe; not_applicable when unset).",
  },
  sentryDsn: {
    key: "SENTRY_DSN",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "Sentry DSN probed for error-capture readiness (not_configured when unset).",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type ObservabilityProbeConfig = ResolvedConfig<typeof OBSERVABILITY_PROBE_CONFIG_SCHEMA>;

/** Load the infra-readiness-probe projection. Safe anywhere: no required keys. */
export function loadObservabilityProbeConfig(
  opts?: LoadConfigOptions<typeof OBSERVABILITY_PROBE_CONFIG_SCHEMA>
): ObservabilityProbeConfig {
  return loadConfig(OBSERVABILITY_PROBE_CONFIG_SCHEMA, opts);
}
