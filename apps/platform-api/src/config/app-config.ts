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
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description:
      "Redis URL — server-side sessions + auth state (ADR-0022). Optional so an explicit-presence " +
      "readiness probe can distinguish 'set' from 'defaulted'; getRedisUrl() applies the dev default.",
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
  // provisioning (V1C-CONF-06 — platform API runtime). Nullable fallbacks stay as `??` in the
  // consumer; the typed config exposes each underlying optional key.
  kcHostname: {
    key: "KC_HOSTNAME",
    type: "string",
    default: "http://localhost/kc",
    restartOrReload: "restart-required",
    description: "Keycloak public hostname; drives the tenant URI scheme (ADR-0033).",
  },
  keycloakProvisionerClientId: {
    key: "KEYCLOAK_PROVISIONER_CLIENT_ID",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description:
      "Keycloak provisioner client id. Optional so the health mapper-readiness gate can detect " +
      "explicit KC-admin configuration; getProvisioningConfig() applies the 'platform-provisioner' default.",
  },
  keycloakProvisionerClientSecret: {
    key: "KEYCLOAK_PROVISIONER_CLIENT_SECRET",
    type: "string",
    default: "",
    secret: true,
    restartOrReload: "restart-required",
    description: "Keycloak provisioner client secret.",
  },
  redisAdminUrl: {
    key: "REDIS_ADMIN_URL",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "Redis admin URL (optional).",
  },
  s3AdminAccessKeyId: {
    key: "S3_ADMIN_ACCESS_KEY_ID",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "S3 admin access key id (optional; MinIO root fallback in dev).",
  },
  minioRootUser: {
    key: "MINIO_ROOT_USER",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "MinIO root user — local dev S3 admin fallback.",
  },
  s3AdminSecretAccessKey: {
    key: "S3_ADMIN_SECRET_ACCESS_KEY",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "S3 admin secret (optional; MinIO root fallback in dev).",
  },
  minioRootPassword: {
    key: "MINIO_ROOT_PASSWORD",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "MinIO root password — local dev S3 admin fallback.",
  },
  s3DefaultBucket: {
    key: "S3_DEFAULT_BUCKET",
    type: "string",
    default: "platform-data",
    restartOrReload: "restart-required",
    description: "Default object-storage bucket.",
  },
  s3DefaultRegion: {
    key: "S3_DEFAULT_REGION",
    type: "string",
    default: "us-east-1",
    restartOrReload: "restart-required",
    description: "Default object-storage region.",
  },
  s3DefaultEndpoint: {
    key: "S3_DEFAULT_ENDPOINT",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "S3 endpoint (optional; MinIO endpoint fallback in dev).",
  },
  minioEndpoint: {
    key: "MINIO_ENDPOINT",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "MinIO endpoint — local dev S3 endpoint fallback.",
  },
  apexDomain: {
    key: "APEX_DOMAIN",
    type: "string",
    default: "aldous.info",
    restartOrReload: "restart-required",
    description: "Apex domain for tenant FQDNs.",
  },
  // server wiring (V1C-CONF-06)
  keycloakPublicUrl: {
    key: "KEYCLOAK_PUBLIC_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Browser-facing Keycloak base URL (falls back to KEYCLOAK_URL when unset).",
  },
  platformApiUrl: {
    key: "PLATFORM_API_URL",
    type: "string",
    default: "http://localhost:3001",
    restartOrReload: "restart-required",
    description: "Self base URL the BFF advertises (e.g. for callbacks).",
  },
  platformApiPort: {
    key: "PLATFORM_API_PORT",
    type: "number",
    default: 3001,
    restartOrReload: "restart-required",
    description: "Port the platform-api HTTP server listens on.",
  },
  appBaseUrl: {
    key: "APP_BASE_URL",
    type: "string",
    default: "http://localhost:5173",
    restartOrReload: "restart-required",
    description: "React app base URL (post-login redirects).",
  },
  lokiUrl: {
    key: "LOKI_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Explicit Loki URL (else derived from LOKI_PORT).",
  },
  rateLimitProvider: {
    key: "RATE_LIMIT_PROVIDER",
    type: "string",
    default: "postgres",
    restartOrReload: "restart-required",
    description: 'Rate-limit backend; Redis path active only when this equals "redis".',
  },
  e2eFailureEndpointEnabled: {
    key: "E2E_FAILURE_ENDPOINT_ENABLED",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Synthetic-failure E2E endpoint enabled only when this equals "true".',
  },
  e2eAllowProdSyntheticFailure: {
    key: "E2E_ALLOW_PROD_SYNTHETIC_FAILURE",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Allow the synthetic-failure endpoint in prod only when this equals "true".',
  },
  domainRoutingProbeBaseUrl: {
    key: "DOMAIN_ROUTING_PROBE_BASE_URL",
    type: "string",
    default: "http://localhost:8081",
    restartOrReload: "restart-required",
    description: "Base URL the Caddy local routing probe targets.",
  },
  storageAvProvider: {
    key: "STORAGE_AV_PROVIDER",
    type: "string",
    default: "clamav",
    restartOrReload: "restart-required",
    description:
      "Antivirus provider selector for storage-object scanning. `stub` uses local stub adapter.",
  },
  clamavHost: {
    key: "CLAMAV_HOST",
    type: "string",
    default: "127.0.0.1",
    restartOrReload: "restart-required",
    description: "ClamAV host when STORAGE_AV_PROVIDER is set to clamav.",
  },
  clamavPort: {
    key: "CLAMAV_PORT",
    type: "number",
    default: 3310,
    restartOrReload: "restart-required",
    description: "ClamAV port when STORAGE_AV_PROVIDER is set to clamav.",
  },
  // app secrets (env-loaded; NOT Tier-0 root-of-trust and not store-managed today — typed here for
  // redaction. Promotion to a Tier-1 SecretRef via SecretStorePort is future work, not this slice.)
  apiKeyPepper: {
    key: "API_KEY_PEPPER",
    type: "string",
    default: "dev-api-key-pepper-not-for-production",
    secret: true,
    restartOrReload: "restart-required",
    description:
      "HMAC pepper for API-key hashing; the dev default carries no production guarantee.",
  },
  caddyInternalSecret: {
    key: "CADDY_INTERNAL_SECRET",
    type: "string",
    default: "",
    secret: true,
    restartOrReload: "restart-required",
    description: "Shared secret Caddy presents on the forward-auth internal endpoint.",
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
