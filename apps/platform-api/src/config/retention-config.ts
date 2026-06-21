// ---------------------------------------------------------------------------
// RetentionTickWorkerConfig — typed projection for the background retention
// tick worker (V1C-12b / ADR-0064 / V1C-CONF-06 / ADR-0076).
//
// Single opt-out flag. Semantics preserved EXACTLY against the prior
// module-load `process.env[...] === "true"` check:
//  * absent            -> tickDisabled=false (worker runs; matches old default)
//  * "true" or "1"     -> tickDisabled=true  (worker disabled)
//  * "false" or "0"    -> tickDisabled=false (worker runs; explicit)
//  * anything else      -> ConfigError at boot (was previously silently false
//                          under the old `=== "true"` check). The change is
//                          deliberate per ADR-0076 fail-closed semantics: a
//                          misconfigured env var now refuses to start instead
//                          of silently running. ADR-0076 / V1C-CONF-01.
//
//  Changing the env requires a pod restart (restartOrReload=restart-required
//  per the ADR-0076 typed-config convention).
// ---------------------------------------------------------------------------
import { loadConfig, type LoadConfigOptions, type ResolvedConfig } from "@platform/config-runtime";

export const RETENTION_TICK_WORKER_CONFIG_SCHEMA = {
  tickDisabled: {
    key: "V1C12B_RETENTION_TICK_DISABLED",
    type: "boolean",
    default: false,
    restartOrReload: "restart-required",
    description:
      "Disable the background retention tick worker when true (V1C-12b / ADR-0064). Defaults to false.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type RetentionTickWorkerConfig = ResolvedConfig<typeof RETENTION_TICK_WORKER_CONFIG_SCHEMA>;

/** Load the retention tick worker projection. Safe anywhere: no required keys. */
export function loadRetentionTickWorkerConfig(
  opts?: LoadConfigOptions<typeof RETENTION_TICK_WORKER_CONFIG_SCHEMA>
): RetentionTickWorkerConfig {
  return loadConfig(RETENTION_TICK_WORKER_CONFIG_SCHEMA, opts);
}
