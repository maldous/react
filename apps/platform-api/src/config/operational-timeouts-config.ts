// ---------------------------------------------------------------------------
// OperationalTimeoutsConfig — typed projection for bounded adapter operation
// timeouts (V1C-CONF-06 / ADR-0076).
//
// These values are optional/defaulted so migration from adapter-local env reads
// preserves runtime behaviour while keeping all environment access inside the
// typed config boundary.
// ---------------------------------------------------------------------------
import { loadConfig, type LoadConfigOptions, type ResolvedConfig } from "@platform/config-runtime";

export const OPERATIONAL_TIMEOUTS_CONFIG_SCHEMA = {
  composeEnvironmentOperationTimeoutMs: {
    key: "COMPOSE_ENV_OPERATION_TIMEOUT_MS",
    type: "number",
    default: 120000,
    restartOrReload: "restart-required",
    description: "Timeout in milliseconds for non-dry-run environment operation adapter calls.",
  },
  legalHoldPostgresStatementTimeoutMs: {
    key: "LEGAL_HOLD_POSTGRES_STATEMENT_TIMEOUT_MS",
    type: "number",
    default: 5000,
    restartOrReload: "restart-required",
    description: "Postgres statement timeout in milliseconds for legal-hold repository queries.",
  },
  tenantDomainPostgresStatementTimeoutMs: {
    key: "TENANT_DOMAIN_POSTGRES_STATEMENT_TIMEOUT_MS",
    type: "number",
    default: 5000,
    restartOrReload: "restart-required",
    description: "Postgres statement timeout in milliseconds for tenant-domain registry queries.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type OperationalTimeoutsConfig = ResolvedConfig<typeof OPERATIONAL_TIMEOUTS_CONFIG_SCHEMA>;

export function loadOperationalTimeoutsConfig(
  opts?: LoadConfigOptions<typeof OPERATIONAL_TIMEOUTS_CONFIG_SCHEMA>
): OperationalTimeoutsConfig {
  return loadConfig(OPERATIONAL_TIMEOUTS_CONFIG_SCHEMA, opts);
}
