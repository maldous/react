// ---------------------------------------------------------------------------
// PlatformApiConfig — the platform-api application-specific typed configuration
// (V1C-CONF-01/02/03/05). Assembled from the environment via the canonical
// @platform/config-runtime kernel: validated (fail-closed on missing/invalid
// required values), deeply immutable, and emitting machine-readable metadata
// with no secret values. Consumers receive typed projections, not raw env.
//
// This slice migrates the representative composition-root consumers (database,
// authentication, observability). Remaining direct `process.env` reads are the
// V1C-CONF-06 slice; secret resolution behind SecretStorePort is V1C-CONF-04.
// ---------------------------------------------------------------------------
import {
  loadConfig,
  configMetadata,
  type ResolvedConfig,
  type LoadConfigOptions,
  type ConfigPropertyMetadata,
} from "@platform/config-runtime";

export const PLATFORM_API_CONFIG_SCHEMA = {
  // database / runtime
  postgresUrl: {
    key: "POSTGRES_URL",
    type: "string",
    secret: true,
    restartOrReload: "restart-required",
    description: "Superuser Postgres URL — migrations/seed/reset only.",
  },
  postgresAppUrl: {
    key: "POSTGRES_APP_URL",
    type: "string",
    secret: true,
    restartOrReload: "restart-required",
    description: "Application-role Postgres URL — the runtime pool.",
  },
  redisUrl: {
    key: "REDIS_URL",
    type: "string",
    default: "redis://localhost:6379",
    secret: true,
    restartOrReload: "restart-required",
    description: "Redis URL — server-side sessions + auth state (ADR-0022).",
  },
  // authentication (Keycloak BFF client)
  keycloakUrl: {
    key: "KEYCLOAK_URL",
    type: "string",
    default: "http://localhost:8090/kc",
    restartOrReload: "restart-required",
    description: "Keycloak base URL.",
  },
  keycloakRealm: {
    key: "KEYCLOAK_REALM",
    type: "string",
    default: "platform",
    restartOrReload: "restart-required",
    description: "Keycloak realm for the BFF client.",
  },
  keycloakClientId: {
    key: "KEYCLOAK_CLIENT_ID",
    type: "string",
    default: "platform-api",
    restartOrReload: "restart-required",
    description: "Keycloak confidential client id.",
  },
  keycloakClientSecret: {
    key: "KEYCLOAK_CLIENT_SECRET",
    type: "string",
    default: "",
    secret: true,
    restartOrReload: "restart-required",
    description: "Keycloak confidential client secret.",
  },
  // observability
  lokiPort: {
    key: "LOKI_PORT",
    type: "string",
    default: "3100",
    restartOrReload: "restart-required",
    description: "Loki port used when LOKI_URL is not set.",
  },
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
    default: "0.0.0",
    restartOrReload: "restart-required",
    description: "Reported application version.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type PlatformApiConfig = ResolvedConfig<typeof PLATFORM_API_CONFIG_SCHEMA>;

/**
 * Load + validate the platform-api configuration. Call once at the server
 * composition root to fail fast on missing/invalid required values; the
 * composition-root getters also use it. Tests pass a typed `overrides` seam.
 */
export function loadPlatformApiConfig(
  opts?: LoadConfigOptions<typeof PLATFORM_API_CONFIG_SCHEMA>
): PlatformApiConfig {
  return loadConfig(PLATFORM_API_CONFIG_SCHEMA, opts);
}

/** Machine-readable metadata for the config catalogue — never includes secret values. */
export function platformApiConfigMetadata(): ConfigPropertyMetadata[] {
  return configMetadata(PLATFORM_API_CONFIG_SCHEMA);
}
