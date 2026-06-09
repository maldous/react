/**
 * Brokered third-party identity providers — single source of truth (ADR-ACT-0157).
 *
 * Production architecture (unchanged across environments):
 *   React /login → BFF /auth/login?provider=<id> → Keycloak (broker)
 *               → upstream IdP → Keycloak callback → BFF /auth/callback → session
 *
 * This module owns:
 *  - the stable product provider IDs exposed to React (google/azure/apple/platform),
 *  - the env-aware provider MODE (mock | real | disabled) + its guardrails,
 *  - the product-id → Keycloak broker-alias mapping (kc_idp_hint),
 *  - the provider list returned by GET /api/auth/providers,
 *  - the mock IdP definitions used by the runtime Keycloak broker seed.
 *
 * Switching from mock to real providers is a configuration change only: the
 * product IDs, the /login contract, and the /api/auth/providers shape never move.
 */
import type { IdentityProvider } from "@platform/authorisation-runtime";

export type ProviderMode = "mock" | "real" | "disabled";

export const PRODUCT_PROVIDER_IDS = ["google", "azure", "apple", "platform"] as const;
export type ProductProviderId = (typeof PRODUCT_PROVIDER_IDS)[number];

export interface ProviderListItem {
  id: ProductProviderId;
  label: string;
  type: "oidc" | "keycloak";
  loginUrl: string;
  enabled: boolean;
  mode: "mock" | "real" | "internal";
}

interface ProductProviderDef {
  id: ProductProviderId;
  /** Fallback label; React translates by id and falls back to this. */
  label: string;
  type: "oidc" | "keycloak";
  /** Path segment on the mock-oidc fixture, e.g. "google". null for platform. */
  mockProvider: string | null;
}

const PRODUCT_PROVIDERS: ProductProviderDef[] = [
  { id: "google", label: "Continue with Google", type: "oidc", mockProvider: "google" },
  { id: "azure", label: "Continue with Microsoft", type: "oidc", mockProvider: "azure" },
  { id: "apple", label: "Continue with Apple", type: "oidc", mockProvider: "apple" },
  {
    id: "platform",
    label: "Continue with platform account",
    type: "keycloak",
    mockProvider: null,
  },
];

const THIRD_PARTY = PRODUCT_PROVIDERS.filter((p) => p.id !== "platform");

// ---------------------------------------------------------------------------
// Environment + mode
// ---------------------------------------------------------------------------

function platformEnv(): string {
  return (process.env["PLATFORM_ENV"] ?? process.env["NODE_ENV"] ?? "development").toLowerCase();
}

/** staging / prod are the "production-like" stages where mock must be guarded. */
export function isProdLikeEnv(): boolean {
  return ["staging", "production", "prod"].includes(platformEnv());
}

const MOCK_OVERRIDE_FLAG = "ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS";

export function mockOverrideEnabled(): boolean {
  return process.env[MOCK_OVERRIDE_FLAG] === "true";
}

/** True only when the operator explicitly pinned the mode (vs. an env default). */
function modeExplicitlySet(): boolean {
  return typeof process.env["AUTH_PROVIDER_MODE"] === "string";
}

export function getProviderMode(): ProviderMode {
  const raw = (process.env["AUTH_PROVIDER_MODE"] ?? "").toLowerCase();
  if (raw === "mock" || raw === "real" || raw === "disabled") return raw;
  // Default: dev/test → mock; staging/prod → real.
  return isProdLikeEnv() ? "real" : "mock";
}

/** Mock providers may run here? Always in dev/test; in prod-like only with the override. */
export function mockAllowedHere(): boolean {
  return !isProdLikeEnv() || mockOverrideEnabled();
}

// ---------------------------------------------------------------------------
// mock-oidc connection settings (env-driven; safe code defaults for dev/test)
// ---------------------------------------------------------------------------

export interface MockOidcSettings {
  /** Browser-facing issuer base (authorize + picker), e.g. http://localhost:9080. */
  publicUrl: string;
  /** Keycloak backchannel base (token/jwks/userinfo), e.g. http://mock-oidc:8080. */
  internalUrl: string;
  /** Shared fixture client secret the Keycloak IdP presents to mock-oidc. */
  clientSecret: string;
}

export function getMockOidcSettings(): MockOidcSettings {
  const strip = (u: string) => u.replace(/\/+$/, "");
  return {
    publicUrl: strip(process.env["MOCK_OIDC_PUBLIC_URL"] ?? "http://localhost:9080"),
    // Keycloak backchannel (token/jwks/userinfo). mock-oidc runs PER-ENV in the
    // same project as Keycloak, so the backchannel is the in-network service name
    // http://mock-oidc:8080 (resolved on the shared project network), while the
    // browser-facing issuer (publicUrl) stays host/Cloudflare-reachable.
    internalUrl: strip(process.env["MOCK_OIDC_INTERNAL_URL"] ?? "http://mock-oidc:8080"),
    clientSecret: process.env["MOCK_OIDC_CLIENT_SECRET"] ?? "mock-oidc-shared-secret",
  };
}

// ---------------------------------------------------------------------------
// Real provider config (per-provider, env-driven). Absent for now — the mock→real
// switch only requires populating these (no React/contract change).
// ---------------------------------------------------------------------------

interface RealProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

function getRealProviderConfig(id: ProductProviderId): RealProviderConfig | null {
  const prefix = `REAL_${id.toUpperCase()}`;
  const issuer = process.env[`${prefix}_ISSUER`];
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (issuer && clientId && clientSecret) return { issuer, clientId, clientSecret };
  return null;
}

function anyRealProviderConfigured(): boolean {
  return THIRD_PARTY.some((p) => getRealProviderConfig(p.id) !== null);
}

// ---------------------------------------------------------------------------
// Mapping + provider list
// ---------------------------------------------------------------------------

/** Keycloak broker alias for a product id in the current mode. */
export function brokerAliasFor(id: ProductProviderId, mode: ProviderMode): string | null {
  if (id === "platform") return null;
  return mode === "mock" ? `mock-${id}` : id; // real alias is the bare product id
}

/** Is this third-party provider currently enabled (advertised + usable)? */
function thirdPartyEnabled(id: ProductProviderId, mode: ProviderMode): boolean {
  if (mode === "disabled") return false;
  if (mode === "mock") return mockAllowedHere();
  return getRealProviderConfig(id) !== null; // real: only if configured
}

/**
 * Providers to render on /login. Platform (internal Keycloak) is always present;
 * third-party providers appear only when enabled for the current mode/env.
 */
export function listEnabledProviders(): ProviderListItem[] {
  const mode = getProviderMode();
  const items: ProviderListItem[] = [];
  for (const p of PRODUCT_PROVIDERS) {
    if (p.id === "platform") {
      items.push({
        id: "platform",
        label: p.label,
        type: "keycloak",
        loginUrl: "/auth/login?provider=platform",
        enabled: true,
        mode: "internal",
      });
      continue;
    }
    if (!thirdPartyEnabled(p.id, mode)) continue;
    items.push({
      id: p.id,
      label: p.label,
      type: "oidc",
      loginUrl: `/auth/login?provider=${p.id}`,
      enabled: true,
      mode: mode === "mock" ? "mock" : "real",
    });
  }
  return items;
}

/**
 * Resolve a user-supplied `provider` param to a Keycloak kc_idp_hint.
 * Returns { ok:true, idpHint } for valid + enabled providers (platform → null
 * hint). Returns { ok:false } for unknown, disabled, or not-currently-enabled
 * providers — the caller MUST reject these. This is the only place product ids
 * become Keycloak aliases, so arbitrary kc_idp_hint injection is impossible.
 */
export function resolveProviderHint(
  raw: string | null | undefined
): { ok: true; id: ProductProviderId; idpHint: string | null } | { ok: false } {
  const id = (raw ?? "platform") as ProductProviderId;
  if (!PRODUCT_PROVIDER_IDS.includes(id)) return { ok: false };
  if (id === "platform") return { ok: true, id, idpHint: null };
  const mode = getProviderMode();
  if (!thirdPartyEnabled(id, mode)) return { ok: false };
  return { ok: true, id, idpHint: brokerAliasFor(id, mode) };
}

// ---------------------------------------------------------------------------
// Mock IdP definitions for the runtime Keycloak broker seed
// ---------------------------------------------------------------------------

/**
 * Keycloak OIDC identity-provider representations for the three mock personas.
 * Endpoints are split deliberately (ADR-ACT-0157):
 *   - authorizationUrl → PUBLIC_URL (browser front channel)
 *   - token/jwks/userinfo + issuer → INTERNAL_URL (Keycloak backchannel)
 * The id_token `iss` equals PUBLIC_URL/<provider>; Keycloak validates it as a
 * string against `issuer`, so the two horizons never need to be the same host.
 */
export function buildMockIdpDefinitions(settings = getMockOidcSettings()): IdentityProvider[] {
  return THIRD_PARTY.map((p) => {
    const seg = p.mockProvider!;
    return {
      alias: `mock-${p.id}`,
      displayName: `Mock ${p.label.replace(/^Continue with /, "")}`,
      providerId: "oidc",
      enabled: true,
      // Trusted upstream IdPs (Google/Microsoft/Apple) only release verified
      // emails, so Keycloak marks the brokered email verified. Keycloak does not
      // import the per-token email_verified claim without this. (ADR-ACT-0157)
      trustEmail: true,
      config: {
        clientId: `kc-broker-${seg}`,
        clientSecret: settings.clientSecret,
        // Backchannel issuer is the browser issuer (validated as a string only).
        issuer: `${settings.publicUrl}/${seg}`,
        authorizationUrl: `${settings.publicUrl}/${seg}/auth`,
        tokenUrl: `${settings.internalUrl}/${seg}/token`,
        jwksUrl: `${settings.internalUrl}/${seg}/jwks`,
        userInfoUrl: `${settings.internalUrl}/${seg}/me`,
        defaultScope: "openid email profile",
        clientAuthMethod: "client_secret_post",
        validateSignature: "true",
        useJwksUrl: "true",
        syncMode: "IMPORT",
        pkceEnabled: "false",
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Startup guardrail (fail-fast) — called from the server bootstrap
// ---------------------------------------------------------------------------

export interface ProviderModeWarning {
  level: "warn";
  message: string;
  fields: Record<string, unknown>;
}

/**
 * Validate the provider mode at startup. Throws (fail-fast) on dangerous
 * misconfiguration; returns any non-fatal warnings for the caller to log.
 *
 *  - mock in staging/prod WITHOUT the explicit override → refuse to start.
 *  - explicit AUTH_PROVIDER_MODE=real with NO real provider configured → refuse
 *    to start (operator asked for real but supplied none). A *defaulted* real
 *    mode (env unset) does not fail — it simply shows platform-only.
 *  - mock in staging/prod WITH the override → start, but emit a loud warning
 *    (the visible "evidence" that a temporary bootstrap is active).
 */
export function validateProviderModeAtStartup(): ProviderModeWarning[] {
  const mode = getProviderMode();
  const env = platformEnv();
  const warnings: ProviderModeWarning[] = [];

  if (mode === "mock" && isProdLikeEnv() && !mockOverrideEnabled()) {
    throw new Error(
      `AUTH_PROVIDER_MODE=mock is refused in '${env}'. Mock identity providers are a ` +
        `non-production fixture. To run them temporarily before real providers are ` +
        `configured, you MUST set ${MOCK_OVERRIDE_FLAG}=true (and remove it once real ` +
        `providers exist). See docs/local-development/mock-identity.md.`
    );
  }

  if (mode === "real" && modeExplicitlySet() && !anyRealProviderConfigured()) {
    throw new Error(
      `AUTH_PROVIDER_MODE=real but no real provider is configured. Set REAL_<PROVIDER>_ISSUER/` +
        `_CLIENT_ID/_CLIENT_SECRET (e.g. REAL_GOOGLE_ISSUER), or use AUTH_PROVIDER_MODE=mock ` +
        `with ${MOCK_OVERRIDE_FLAG}=true as a temporary bootstrap.`
    );
  }

  if (mode === "mock" && isProdLikeEnv() && mockOverrideEnabled()) {
    warnings.push({
      level: "warn",
      message:
        `⚠ TEMPORARY: mock identity providers are ENABLED in '${env}' via ${MOCK_OVERRIDE_FLAG}. ` +
        `This is a non-production bootstrap and MUST be removed once real providers are configured.`,
      fields: { providerMode: mode, env, override: MOCK_OVERRIDE_FLAG },
    });
  }

  return warnings;
}
