// ---------------------------------------------------------------------------
// ProviderReadinessConfig — narrow typed projection for provider/readiness
// seams that still need env-backed endpoints or selectors (V1C-CONF-06).
//
// These values are intentionally optional/defaulted so the reporting paths stay
// best-effort and do not fail process startup.
// ---------------------------------------------------------------------------
import { loadConfig, type LoadConfigOptions, type ResolvedConfig } from "@platform/config-runtime";

export const PROVIDER_READINESS_CONFIG_SCHEMA = {
  temporalAddress: {
    key: "TEMPORAL_ADDRESS",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Temporal service base URL for the workflow provider seam.",
  },
  temporalHttpUrl: {
    key: "TEMPORAL_HTTP_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Legacy Temporal HTTP URL fallback.",
  },
  temporalNamespace: {
    key: "TEMPORAL_NAMESPACE",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Temporal namespace for SDK connections.",
  },
  windmillUrl: {
    key: "WINDMILL_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Windmill base URL for the automation provider seam.",
  },
  windmillToken: {
    key: "WINDMILL_TOKEN",
    type: "string",
    optional: true,
    secret: true,
    restartOrReload: "restart-required",
    description: "Windmill API token (optional).",
  },
  pgbackrestRepo1S3Bucket: {
    key: "PGBACKREST_REPO1_S3_BUCKET",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "pgBackRest repository bucket used by the backup readiness report.",
  },
  pgbackrestRetention: {
    key: "PGBACKREST_RETENTION",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "pgBackRest retention string used by the backup readiness report.",
  },
  billingProvider: {
    key: "BILLING_PROVIDER",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Selected billing provider for readiness reporting.",
  },
  billingUrl: {
    key: "BILLING_URL",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Billing provider endpoint for readiness reporting.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type ProviderReadinessConfig = ResolvedConfig<typeof PROVIDER_READINESS_CONFIG_SCHEMA>;

export function loadProviderReadinessConfig(
  opts?: LoadConfigOptions<typeof PROVIDER_READINESS_CONFIG_SCHEMA>
): ProviderReadinessConfig {
  return loadConfig(PROVIDER_READINESS_CONFIG_SCHEMA, opts);
}
