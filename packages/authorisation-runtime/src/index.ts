/**
 * @platform/authorisation-runtime
 *
 * Port interfaces for the Policy Enforcement Point (PEP) pattern and
 * tenant realm administration. Zero @platform/* dependencies.
 *
 * ADR-0030: Dynamic authorisation and tenant admin self-service.
 * ADR-0031: Infrastructure provisioning privilege model.
 */

export const packageName = "@platform/authorisation-runtime";

// ---------------------------------------------------------------------------
// Resource authorisation (UMA 2.0 / Keycloak Authorization Services)
// ---------------------------------------------------------------------------

export interface Resource {
  /** Resource name registered in Keycloak, e.g. "organisation:profile" */
  name: string;
  /** Scope on the resource, e.g. "read" | "write" */
  scope: string;
}

export type AccessDenialReason =
  | "insufficient_scope" // token lacks required scope
  | "insufficient_auth_level" // step-up auth required (MFA, re-auth)
  | "policy_denied" // Keycloak policy evaluation returned deny
  | "no_session"; // no valid token presented

export type AccessDecision =
  | { granted: true; rpt: string } // RPT for downstream use
  | { granted: false; reason: AccessDenialReason };

export interface AuthorisationPort {
  /**
   * Check whether the current access token grants access to resource+scope.
   * Implements the UMA ticket endpoint call (ADR-0030 ?3a).
   * Returns an RPT (Requesting Party Token) on success.
   */
  checkAccess(resource: Resource, accessToken: string): Promise<AccessDecision>;
}

/** Noop implementation ? always denies. For testing and as a safe default. */
export function createDenyAllAuthorisationPort(): AuthorisationPort {
  return {
    async checkAccess() {
      return { granted: false, reason: "policy_denied" };
    },
  };
}

/** Noop implementation ? always grants. For development only. */
export function createAllowAllAuthorisationPort(): AuthorisationPort {
  return {
    async checkAccess(_resource) {
      return { granted: true, rpt: "dev-noop-rpt" };
    },
  };
}

// ---------------------------------------------------------------------------
// Realm administration (ADR-0030 ?1b, ?6b)
// ---------------------------------------------------------------------------

export interface IdentityProvider {
  alias: string;
  displayName: string;
  /** "oidc" | "saml" | "keycloak-oidc" */
  providerId: string;
  config: Record<string, string>;
  enabled: boolean;
}

export interface MfaPolicy {
  /** "none" | "optional" | "required" */
  required: "none" | "optional" | "required";
  /** "totp" | "webauthn" */
  type: "totp" | "webauthn";
  gracePeriodSeconds?: number;
}

export interface SessionPolicy {
  accessTokenLifespanSeconds: number;
  ssoSessionIdleTimeoutSeconds: number;
  ssoSessionMaxLifespanSeconds: number;
  rememberMe: boolean;
}

export interface ResourcePolicy {
  name: string;
  /** "role" | "time" | "aggregated" | "user" | "group" | "regex" | "js" */
  type: "role" | "time" | "aggregated" | "user" | "group" | "regex" | "js";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface SysadminBrokeringConfig {
  enabled: boolean;
  requireMfa: boolean;
  auditAllAccess: boolean;
}

export interface RealmAdminPort {
  // Identity providers
  listIdentityProviders(): Promise<IdentityProvider[]>;
  upsertIdentityProvider(idp: IdentityProvider): Promise<void>;
  removeIdentityProvider(alias: string): Promise<void>;

  // MFA policy
  getMfaPolicy(): Promise<MfaPolicy>;
  setMfaPolicy(policy: MfaPolicy): Promise<void>;

  // Session policy
  getSessionPolicy(): Promise<SessionPolicy>;
  setSessionPolicy(policy: SessionPolicy): Promise<void>;

  // Per-resource policies
  getResourcePolicy(resourceName: string): Promise<ResourcePolicy[]>;
  setResourcePolicy(resourceName: string, policy: ResourcePolicy): Promise<void>;
  removeResourcePolicy(resourceName: string, policyName: string): Promise<void>;

  // Sysadmin cross-domain brokering (ADR-0029 ?2e)
  getSysadminBrokering(): Promise<SysadminBrokeringConfig>;
  setSysadminBrokering(config: SysadminBrokeringConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// Realm provisioning (ADR-0031)
// Used only by the platform provisioning service ? never by request handlers.
// ---------------------------------------------------------------------------

export interface RealmProvisioningConfig {
  realmName: string;
  displayName: string;
  bffClientId: string;
  bffClientSecret: string;
  bffRedirectUris: string[];
}

export interface RealmProvisioningPort {
  /**
   * Create a new Keycloak realm for a tenant.
   * Requires master-realm admin credentials (ADR-0031).
   */
  createRealm(config: RealmProvisioningConfig): Promise<void>;

  /**
   * Delete a tenant's Keycloak realm.
   * All users, sessions, and IdP configurations are permanently removed.
   */
  deleteRealm(realmName: string): Promise<void>;

  /** Check if a realm already exists (idempotency guard). */
  realmExists(realmName: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Theme / branding (ADR-0029 ?4)
// ---------------------------------------------------------------------------

export interface TenantTheme {
  displayName: string;
  primaryColour: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export const DEFAULT_THEME: Readonly<TenantTheme> = {
  displayName: "Enterprise Platform",
  primaryColour: "#4f46e5",
  logoUrl: null,
  faviconUrl: null,
};

// ---------------------------------------------------------------------------
// Per-resource provisioning config (ADR-0031, ADR-ACT-0142)
//
// Each resource type (database, identity, cache, storage) is independently
// configurable. A tenant can mix tiers ? e.g. dedicated DB + shared cache.
//
// Tiers:
//   shared    ? tenant namespace/schema/realm within platform shared infra
//   dedicated ? operator-provisioned dedicated infra; platform sets it up
//   external  ? tenant manages their own infra; platform stores config only
//   air-gapped ? no platform connection; tenant manages entirely offline
// ---------------------------------------------------------------------------

export type ResourceTier = "shared" | "dedicated" | "external" | "air-gapped";

export interface DatabaseResourceConfig {
  tier: ResourceTier;
  /** For dedicated/external: connection URL to the tenant's own DB instance */
  connectionUrl?: string;
}

export interface IdentityResourceConfig {
  tier: ResourceTier;
  /** For dedicated/external: Keycloak base URL of tenant's own instance */
  keycloakUrl?: string;
  provisionerClientId?: string;
  provisionerClientSecret?: string;
}

export interface CacheResourceConfig {
  tier: ResourceTier;
  /** For dedicated/external: Redis URL of tenant's own instance */
  redisUrl?: string;
  /** For dedicated: admin URL for ACL management */
  adminUrl?: string;
}

export interface StorageResourceConfig {
  tier: ResourceTier;
  bucket?: string;
  region?: string;
  endpoint?: string;
  adminAccessKeyId?: string;
  adminSecretAccessKey?: string;
}

export interface TenantResourceConfig {
  database: DatabaseResourceConfig;
  identity: IdentityResourceConfig;
  cache: CacheResourceConfig;
  storage: StorageResourceConfig;
}

export const DEFAULT_RESOURCE_CONFIG: Readonly<TenantResourceConfig> = {
  database: { tier: "shared" },
  identity: { tier: "shared" },
  cache: { tier: "shared" },
  storage: { tier: "shared" },
};

export function mergeResourceConfig(partial?: Partial<TenantResourceConfig>): TenantResourceConfig {
  return {
    database: { ...DEFAULT_RESOURCE_CONFIG.database, ...partial?.database },
    identity: { ...DEFAULT_RESOURCE_CONFIG.identity, ...partial?.identity },
    cache: { ...DEFAULT_RESOURCE_CONFIG.cache, ...partial?.cache },
    storage: { ...DEFAULT_RESOURCE_CONFIG.storage, ...partial?.storage },
  };
}
