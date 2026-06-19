// ---------------------------------------------------------------------------
// StageConfig — typed projection for deployment-stage detection (V1C-CONF-06).
//
// PLATFORM_ENV / NODE_ENV are read across the server for stage gating, but the
// call sites use SUBTLY DIFFERENT expressions (some read PLATFORM_ENV only, some
// NODE_ENV only, some the PLATFORM_ENV → NODE_ENV → "development" chain). This
// projection exposes BOTH raw values (optional) plus resolveStage() for the
// combined chain, so every call site reconstructs its exact prior semantics —
// no behaviour change. Both keys optional → loading never fails the process.
//
// Loaded PER CALL (not memoised at module scope) so it reads the live process.env
// exactly like the prior direct reads — tests that flip the stage between calls
// keep working.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const STAGE_CONFIG_SCHEMA = {
  platformEnv: {
    key: "PLATFORM_ENV",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Deployment stage (authoritative when set).",
  },
  nodeEnv: {
    key: "NODE_ENV",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Node environment (stage fallback / production check).",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type StageConfig = ResolvedConfig<typeof STAGE_CONFIG_SCHEMA>;

/** Load the stage projection. Safe anywhere: no required keys. */
export function loadStageConfig(opts?: LoadConfigOptions<typeof STAGE_CONFIG_SCHEMA>): StageConfig {
  return loadConfig(STAGE_CONFIG_SCHEMA, opts);
}

/** The combined stage string: PLATFORM_ENV → NODE_ENV → "development" (prior derivation). */
export function resolveStage(cfg: StageConfig): string {
  return cfg.platformEnv ?? cfg.nodeEnv ?? "development";
}
