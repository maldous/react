// ---------------------------------------------------------------------------
// ObservabilityConfig — a MINIMAL typed projection for the early-start
// observability path (V1C-CONF-06; ADR-0076). otel-init must run as the very
// first import (before pg/redis/http are patched), so it cannot depend on the
// full PlatformApiConfig (which requires POSTGRES_*). This projection therefore
// carries ONLY observability keys, all optional/defaulted — it never fails the
// process at instrumentation time. No secret values.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const OBSERVABILITY_CONFIG_SCHEMA = {
  otelServiceName: {
    key: "OTEL_SERVICE_NAME",
    type: "string",
    default: "platform-api",
    restartOrReload: "restart-required",
    description: "OpenTelemetry service.name.",
  },
  appVersion: {
    key: "APP_VERSION",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Reported version (Sentry release; OTEL serviceVersion defaults to 0.0.0).",
  },
  platformEnv: {
    key: "PLATFORM_ENV",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Deployment stage (OTEL/Sentry environment).",
  },
  nodeEnv: {
    key: "NODE_ENV",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Node environment (fallback for the stage).",
  },
  otelExporterEndpoint: {
    key: "OTEL_EXPORTER_OTLP_ENDPOINT",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "OTLP exporter endpoint (optional).",
  },
  sentryEnabled: {
    key: "SENTRY_ENABLED",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Sentry enabled when exactly "true".',
  },
  sentryDsn: {
    key: "SENTRY_DSN",
    type: "string",
    default: "",
    secret: true,
    restartOrReload: "restart-required",
    description: "Sentry DSN (error capture).",
  },
  logLevel: {
    key: "LOG_LEVEL",
    type: "string",
    default: "info",
    restartOrReload: "restart-required",
    description: "Process log level.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type ObservabilityConfig = ResolvedConfig<typeof OBSERVABILITY_CONFIG_SCHEMA>;

/** Load the early-start observability config. Safe at instrumentation time: no required keys. */
export function loadObservabilityConfig(
  opts?: LoadConfigOptions<typeof OBSERVABILITY_CONFIG_SCHEMA>
): ObservabilityConfig {
  return loadConfig(OBSERVABILITY_CONFIG_SCHEMA, opts);
}

/** The resolved stage: PLATFORM_ENV → NODE_ENV → "development" (preserves the prior derivation). */
export function observabilityEnvironment(cfg: ObservabilityConfig): string {
  return cfg.platformEnv ?? cfg.nodeEnv ?? "development";
}
