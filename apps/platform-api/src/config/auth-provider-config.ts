// ---------------------------------------------------------------------------
// AuthProviderConfig — typed projection for identity-provider mode + the
// mock-oidc connection settings (ADR-0037/ADR-ACT-0157; V1C-CONF-06).
//
// `mode` is the OPTIONAL raw AUTH_PROVIDER_MODE: an empty/blank value must behave
// exactly like an absent variable (compose passes AUTH_PROVIDER_MODE="" via
// ${AUTH_PROVIDER_MODE:-}), so the projection keeps it raw and the call sites
// apply trim()/toLowerCase() exactly as before. The mock-oidc settings carry the
// prior dev/test defaults. mockOidcClientSecret is a FIXTURE shared secret (known
// default), marked secret only for metadata redaction — it is NOT a store-managed
// production secret and does not flow through the two-tier model.
// ---------------------------------------------------------------------------
import { loadConfig, type ResolvedConfig, type LoadConfigOptions } from "@platform/config-runtime";

export const AUTH_PROVIDER_CONFIG_SCHEMA = {
  mode: {
    key: "AUTH_PROVIDER_MODE",
    type: "string",
    optional: true,
    restartOrReload: "restart-required",
    description: "Operator-pinned provider mode (mock/real/disabled); blank ⇒ env default.",
  },
  mockOidcPublicUrl: {
    key: "MOCK_OIDC_PUBLIC_URL",
    type: "string",
    default: "http://localhost:9080",
    restartOrReload: "restart-required",
    description: "Browser-facing mock-oidc issuer base.",
  },
  mockOidcInternalUrl: {
    key: "MOCK_OIDC_INTERNAL_URL",
    type: "string",
    default: "http://mock-oidc:8080",
    restartOrReload: "restart-required",
    description: "Keycloak backchannel mock-oidc base (in-network service name).",
  },
  mockOidcClientSecret: {
    key: "MOCK_OIDC_CLIENT_SECRET",
    type: "string",
    default: "mock-oidc-shared-secret",
    secret: true,
    restartOrReload: "restart-required",
    description: "Fixture shared secret the Keycloak IdP presents to mock-oidc (dev/test).",
  },
} as const satisfies Record<string, import("@platform/config-runtime").ConfigFieldDef>;

export type AuthProviderConfig = ResolvedConfig<typeof AUTH_PROVIDER_CONFIG_SCHEMA>;

/** Load the auth-provider projection. Safe anywhere: no required keys. */
export function loadAuthProviderConfig(
  opts?: LoadConfigOptions<typeof AUTH_PROVIDER_CONFIG_SCHEMA>
): AuthProviderConfig {
  return loadConfig(AUTH_PROVIDER_CONFIG_SCHEMA, opts);
}
