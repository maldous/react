import {
  createHealthResponse,
  createReadinessResponse,
  createVersionResponse,
  type DependencyStatus,
  type HealthResponse,
  type ReadinessResponse,
  type VersionResponse,
} from "@platform/api-runtime";
import { PostgresReadinessAdapter } from "@platform/adapters-postgres";
import { KeycloakRealmAdminAdapter, type KeycloakAdminConfig } from "@platform/adapters-keycloak";
import { getPostgresReadinessAdapter } from "./dependencies.ts";
import { getFixtureSession } from "./session.ts";

export { type HealthResponse, type ReadinessResponse, type VersionResponse };

export function getHealth(): HealthResponse {
  return createHealthResponse();
}

// ---------------------------------------------------------------------------
// Keycloak mapper readiness check (ADR-ACT-0181 / ADR-ACT-0175)
//
// Guards against the deployment-ordering failure where the BFF client is
// missing the realm-roles-userinfo protocol mapper. Without it,
// resolveSessionFromIdentity() cannot read realm_access.roles from /userinfo
// and system-admin users silently get roles:[] with no startup error.
//
// Design:
//   - Memoised after first "present" result — mapper is provisioning-owned and
//     won't vanish mid-run; re-checking on every probe is unnecessary churn.
//   - Skipped (→ "ok") when LOCAL_FIXTURE_SESSION is set — fixture sessions
//     bypass Keycloak entirely, making the mapper irrelevant.
//   - In production (NODE_ENV=production) a "missing" result flows through to a
//     503 on /readyz. In dev/test it is demoted to "unknown" (warning-level).
// ---------------------------------------------------------------------------

/** Injectable for testing — production code uses getDefaultMapperConfig(). */
export interface MapperCheckConfig {
  adminConfig: KeycloakAdminConfig;
  clientId: string;
}

let _mapperOkMemo = false;

/** Reset memo — only for use in tests. */
export function _resetMapperMemo(): void {
  _mapperOkMemo = false;
}

function getDefaultMapperConfig(): MapperCheckConfig | null {
  const url = process.env["KEYCLOAK_URL"];
  const adminClientId = process.env["KEYCLOAK_PROVISIONER_CLIENT_ID"];
  const adminClientSecret = process.env["KEYCLOAK_PROVISIONER_CLIENT_SECRET"];
  const realm = process.env["KEYCLOAK_REALM"] ?? "platform";
  const clientId = process.env["KEYCLOAK_CLIENT_ID"] ?? "platform-api";

  if (!url || !adminClientId) return null;

  return {
    adminConfig: {
      url,
      realm,
      adminClientId,
      adminClientSecret: adminClientSecret ?? "",
    },
    clientId,
  };
}

async function checkMapperReadiness(cfg: MapperCheckConfig | null): Promise<DependencyStatus> {
  // Fixture mode: Keycloak auth path not used, mapper irrelevant.
  if (getFixtureSession()) return "ok";

  // Not configured (e.g. unit test environment without env vars).
  if (!cfg) return "unknown";

  // Memoised: once confirmed present, skip further checks.
  if (_mapperOkMemo) return "ok";

  const adapter = new KeycloakRealmAdminAdapter(cfg.adminConfig);
  const result = await adapter.checkUserinfoRealmRolesMapper(cfg.clientId);

  if (result === "present") {
    _mapperOkMemo = true;
    return "ok";
  }

  if (result === "missing") {
    // In production, a missing mapper is a hard dependency failure (503).
    // In dev/test, demote to "unknown" so a not-yet-provisioned local stack
    // doesn't block development.
    return process.env["NODE_ENV"] === "production" ? "failed" : "unknown";
  }

  // "unavailable" (admin API unreachable / auth error) — always unknown.
  return "unknown";
}

/**
 * Readiness probe.
 *
 * SQL is owned by the PostgresReadinessAdapter — server/ contains no raw SQL.
 * `opts.postgresUrl` and `opts.mapperConfig` may be injected by tests;
 * production uses the shared composition root in dependencies.ts.
 */
export async function getReadiness(opts?: {
  postgresUrl?: string;
  mapperConfig?: MapperCheckConfig | null;
}): Promise<ReadinessResponse> {
  const adapter = opts?.postgresUrl
    ? new PostgresReadinessAdapter(opts.postgresUrl)
    : getPostgresReadinessAdapter();
  const dbStatus = await adapter.ping();

  // Mapper config: use injected value if provided (allows null to skip check in
  // tests that don't set env vars), otherwise derive from environment.
  const mapperCfg: MapperCheckConfig | null =
    opts && "mapperConfig" in opts ? (opts.mapperConfig ?? null) : getDefaultMapperConfig();
  const mapperStatus = await checkMapperReadiness(mapperCfg);

  return createReadinessResponse({ database: dbStatus, keycloak_mapper: mapperStatus });
}

export function getVersion(): VersionResponse {
  // Use || (not ??) so an EMPTY APP_VERSION/GIT_SHA/BUILD_TIME (compose passes
  // `${APP_VERSION:-}` which is "" when unset, not undefined) falls back to a valid
  // default — /version must always return a non-empty version (api-contract test).
  return createVersionResponse({
    version: process.env["APP_VERSION"] || "0.1.0",
    commit: process.env["GIT_SHA"] || "unknown",
    buildTime: process.env["BUILD_TIME"] || "unknown",
    environment: process.env["NODE_ENV"] || "development",
  });
}
