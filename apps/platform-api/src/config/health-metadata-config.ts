// ---------------------------------------------------------------------------
// HealthMetadataConfig — typed projection for the /version build-metadata fields
// (V1C-CONF-06). All optional: the call site keeps its `|| "<default>"` semantics
// (empty OR unset → default), which differs from a schema default (unset only),
// so behaviour is preserved exactly. The `environment` field of /version is the
// deployment stage and is sourced from StageConfig, not duplicated here.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const HEALTH_METADATA_CONFIG_SCHEMA = {
  appVersion: {
    key: "APP_VERSION",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Reported application version (/version; defaults to 0.1.0 at the call site).",
  },
  gitSha: {
    key: "GIT_SHA",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Build commit SHA (/version; defaults to 'unknown').",
  },
  buildTime: {
    key: "BUILD_TIME",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Build timestamp (/version; defaults to 'unknown').",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type HealthMetadataConfig = ResolvedConfig<typeof HEALTH_METADATA_CONFIG_SCHEMA>;

/** Load the /version build-metadata projection. Safe anywhere: no required keys. */
export function loadHealthMetadataConfig(
  opts?: LoadConfigOptions<typeof HEALTH_METADATA_CONFIG_SCHEMA>
): HealthMetadataConfig {
  return loadConfig(HEALTH_METADATA_CONFIG_SCHEMA, opts);
}
