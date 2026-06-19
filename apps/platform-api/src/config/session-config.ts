// ---------------------------------------------------------------------------
// SessionConfig — typed projection for session-cookie + fixture settings
// (V1C-CONF-06). All optional/defaulted → loading never fails the process.
//
// Behaviour preserved exactly: cookieSecure stays a STRING compared with
// === "true" (compose passes SESSION_COOKIE_SECURE=false, and NODE_ENV does NOT
// imply Secure — see auth.ts); ttlSeconds is the typed number default 1800;
// localFixtureSession is the optional fixture-role string used both as a truthy
// dev-mode gate and as the role value.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const SESSION_CONFIG_SCHEMA = {
  cookieDomain: {
    key: "SESSION_COOKIE_DOMAIN",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Explicit session-cookie Domain attribute (omitted when unset).",
  },
  cookieSecure: {
    key: "SESSION_COOKIE_SECURE",
    type: "string",
    default: "",
    restartOrReload: "restart-required",
    description: 'Session cookie marked Secure only when this equals "true".',
  },
  ttlSeconds: {
    key: "SESSION_TTL_SECONDS",
    type: "number",
    default: 1800,
    restartOrReload: "restart-required",
    description: "Session cookie Max-Age / TTL in seconds.",
  },
  localFixtureSession: {
    key: "LOCAL_FIXTURE_SESSION",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Dev/test fixture session role; also the local-fixture-mode gate.",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type SessionConfig = ResolvedConfig<typeof SESSION_CONFIG_SCHEMA>;

/** Load the session projection. Safe anywhere: no required keys. */
export function loadSessionConfig(
  opts?: LoadConfigOptions<typeof SESSION_CONFIG_SCHEMA>
): SessionConfig {
  return loadConfig(SESSION_CONFIG_SCHEMA, opts);
}
