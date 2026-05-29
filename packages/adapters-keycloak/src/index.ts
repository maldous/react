export const packageName = "@platform/adapters-keycloak";

// Internal Keycloak claim types — NEVER exported to domain or React packages
interface KeycloakTokenClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  realm_access?: { roles: string[] };
  [key: string]: unknown;
}

// Result of mapping Keycloak claims to internal types
export interface KeycloakIdentityResult {
  providerSubject: string; // maps from JWT sub
  provider: "keycloak";
  email: string;
  displayName: string;
  realmRoles: string[];
}

/**
 * Configuration for connecting to a Keycloak realm.
 * Passed explicitly — this adapter never reads environment variables directly.
 */
export interface KeycloakClientConfig {
  url: string; // e.g. http://localhost:8080
  realm: string; // e.g. platform
  clientId: string; // e.g. platform-api
  clientSecret: string;
}

/**
 * Maps Keycloak userinfo claims to internal identity fields.
 *
 * Security rules:
 * - Returns null (refuses login) if `email` is absent or `email_verified !== true`.
 *   An unverified email could belong to someone else; provisioning on it enables
 *   account takeover via email-squatting.
 * - `preferred_username` is user-controlled and NOT used for the email field.
 *   It is used only for the display name where accuracy is not security-critical.
 * - `sub` is the authoritative stable identifier; it never changes for a given user.
 */
export function mapKeycloakClaims(claims: Record<string, unknown>): KeycloakIdentityResult | null {
  const kc = claims as KeycloakTokenClaims;

  if (!kc.email) return null;
  if (kc.email_verified !== true) return null;

  return {
    providerSubject: kc.sub,
    provider: "keycloak",
    email: kc.email,
    displayName: (kc.preferred_username ?? kc.email) as string,
    realmRoles: kc.realm_access?.roles ?? [],
  };
}

/**
 * Exchange an OAuth 2.0 authorization code for tokens using PKCE.
 *
 * The code exchange is server-to-server with a confidential client secret over
 * TLS, so the resulting tokens are trusted by provenance. We use /userinfo
 * (getUserInfo) to extract identity claims rather than parsing the JWT.
 *
 * Returns null if the exchange fails (network error, invalid code, etc.).
 */
export async function exchangeCodeForTokens(
  input: { code: string; redirectUri: string; codeVerifier: string },
  config: KeycloakClientConfig
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const tokenUrl = `${config.url}/realms/${config.realm}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) return null;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresIn: data.expires_in ?? 900,
  };
}

/**
 * Fetch user identity claims from the Keycloak /userinfo endpoint.
 *
 * The access token was obtained directly from Keycloak via a server-side
 * confidential client exchange, so the userinfo response is trusted without
 * additional JWT signature verification.
 *
 * Returns null if the request fails or the token has expired.
 */
export async function getUserInfo(
  accessToken: string,
  config: Pick<KeycloakClientConfig, "url" | "realm">
): Promise<KeycloakIdentityResult | null> {
  const userInfoUrl = `${config.url}/realms/${config.realm}/protocol/openid-connect/userinfo`;

  let res: Response;
  try {
    res = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const claims = (await res.json()) as Record<string, unknown>;
  return mapKeycloakClaims(claims); // null if email absent or email_verified !== true
}

/**
 * Build the Keycloak authorization URL for the Authorization Code + PKCE flow.
 */
export function buildAuthorizationUrl(
  params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scope?: string;
  },
  config: KeycloakClientConfig
): string {
  const base = `${config.url}/realms/${config.realm}/protocol/openid-connect/auth`;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope ?? "openid profile email",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${base}?${query.toString()}`;
}

/**
 * Stub — kept for interface compatibility.
 * The real verification path uses getUserInfo instead, which avoids JWKS
 * caching complexity. This stub is preserved for future use cases where
 * the platform receives inbound tokens from external callers.
 */
export async function verifyKeycloakToken(token: string): Promise<Record<string, unknown> | null> {
  void token;
  return null;
}

// ---------------------------------------------------------------------------
// KeycloakAuthorisationAdapter — implements AuthorisationPort via UMA 2.0
// KeycloakRealmAdminAdapter — implements RealmAdminPort via Admin REST API
// KeycloakProvisioningAdapter — creates/deletes realms (ADR-0031)
// ADR-0030 §3a, §6b | ADR-0031
// ---------------------------------------------------------------------------

import type {
  AuthorisationPort,
  Resource,
  AccessDecision,
  RealmAdminPort,
  IdentityProvider,
  MfaPolicy,
  SessionPolicy,
  ResourcePolicy,
  SysadminBrokeringConfig,
  RealmProvisioningPort,
  RealmProvisioningConfig,
} from "@platform/authorisation-runtime";

export class KeycloakAuthorisationAdapter implements AuthorisationPort {
  private readonly config: KeycloakClientConfig;

  constructor(config: KeycloakClientConfig) {
    this.config = config;
  }

  async checkAccess(resource: Resource, accessToken: string): Promise<AccessDecision> {
    const tokenUrl = `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
      audience: this.config.clientId,
      permission: `${resource.name}#${resource.scope}`,
      response_include_resource_name: "false",
    });
    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
        body,
      });
      if (response.ok) {
        const data = (await response.json()) as { access_token?: string };
        return { granted: true, rpt: data.access_token ?? "" };
      }
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const errorCode = String(err["error"] ?? "");
      if (errorCode === "insufficient_scope")
        return { granted: false, reason: "insufficient_scope" };
      if (String(err["error_description"] ?? "").includes("auth_level"))
        return { granted: false, reason: "insufficient_auth_level" };
      return { granted: false, reason: "policy_denied" };
    } catch {
      return { granted: false, reason: "policy_denied" };
    }
  }
}

// ---------------------------------------------------------------------------
// KeycloakRealmAdminAdapter — implements RealmAdminPort via Admin REST API
// ADR-0030 §1b, §6b
// ---------------------------------------------------------------------------

export interface KeycloakAdminConfig {
  url: string;
  realm: string;
  /** Service account client ID with realm-admin role */
  adminClientId: string;
  adminClientSecret: string;
}

export class KeycloakRealmAdminAdapter implements RealmAdminPort {
  private readonly config: KeycloakAdminConfig;

  constructor(config: KeycloakAdminConfig) {
    this.config = config;
  }

  private async getAdminToken(): Promise<string> {
    const tokenUrl = `${this.config.url}/realms/master/protocol/openid-connect/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.adminClientId,
        client_secret: this.config.adminClientSecret,
      }),
    });
    if (!response.ok) throw new Error(`Keycloak admin token fetch failed: ${response.status}`);
    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  private adminUrl(path: string): string {
    return `${this.config.url}/admin/realms/${this.config.realm}${path}`;
  }

  async listIdentityProviders(): Promise<IdentityProvider[]> {
    const token = await this.getAdminToken();
    const response = await fetch(this.adminUrl("/identity-provider/instances"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return (await response.json()) as IdentityProvider[];
  }

  async upsertIdentityProvider(idp: IdentityProvider): Promise<void> {
    const token = await this.getAdminToken();
    const existing = await fetch(this.adminUrl(`/identity-provider/instances/${idp.alias}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const method = existing.ok ? "PUT" : "POST";
    const url = existing.ok
      ? this.adminUrl(`/identity-provider/instances/${idp.alias}`)
      : this.adminUrl("/identity-provider/instances");
    await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(idp),
    });
  }

  async removeIdentityProvider(alias: string): Promise<void> {
    const token = await this.getAdminToken();
    await fetch(this.adminUrl(`/identity-provider/instances/${alias}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async getMfaPolicy(): Promise<MfaPolicy> {
    const token = await this.getAdminToken();
    const response = await fetch(this.adminUrl(""), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const realm = (await response.json()) as Record<string, unknown>;
    return {
      required: (realm["otpPolicyType"] as MfaPolicy["required"]) ?? "optional",
      type: String(realm["otpPolicyAlgorithm"] ?? "totp").includes("webauthn")
        ? "webauthn"
        : "totp",
    };
  }

  async setMfaPolicy(policy: MfaPolicy): Promise<void> {
    const token = await this.getAdminToken();
    await fetch(this.adminUrl(""), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ otpPolicyType: policy.required }),
    });
  }

  async getSessionPolicy(): Promise<SessionPolicy> {
    const token = await this.getAdminToken();
    const response = await fetch(this.adminUrl(""), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const realm = (await response.json()) as Record<string, unknown>;
    return {
      accessTokenLifespanSeconds: Number(realm["accessTokenLifespan"] ?? 900),
      ssoSessionIdleTimeoutSeconds: Number(realm["ssoSessionIdleTimeout"] ?? 1800),
      ssoSessionMaxLifespanSeconds: Number(realm["ssoSessionMaxLifespan"] ?? 36000),
      rememberMe: Boolean(realm["rememberMe"] ?? false),
    };
  }

  async setSessionPolicy(policy: SessionPolicy): Promise<void> {
    const token = await this.getAdminToken();
    await fetch(this.adminUrl(""), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accessTokenLifespan: policy.accessTokenLifespanSeconds,
        ssoSessionIdleTimeout: policy.ssoSessionIdleTimeoutSeconds,
        ssoSessionMaxLifespan: policy.ssoSessionMaxLifespanSeconds,
        rememberMe: policy.rememberMe,
      }),
    });
  }

  async getResourcePolicy(resourceName: string): Promise<ResourcePolicy[]> {
    void resourceName;
    // Keycloak Authorization Services resource policy query
    // Implementation depends on client resource server setup (ADR-0030 §3)
    return [];
  }

  async setResourcePolicy(resourceName: string, policy: ResourcePolicy): Promise<void> {
    void resourceName;
    void policy;
    // Keycloak Authorization Services policy creation
    // Implementation tracked in ADR-ACT-0143
  }

  async removeResourcePolicy(resourceName: string, policyName: string): Promise<void> {
    void resourceName;
    void policyName;
  }

  async getSysadminBrokering(): Promise<SysadminBrokeringConfig> {
    const idps = await this.listIdentityProviders();
    const platformIdp = idps.find((i) => i.alias === "platform-realm");
    return {
      enabled: platformIdp?.enabled ?? false,
      requireMfa: true,
      auditAllAccess: true,
    };
  }

  async setSysadminBrokering(config: SysadminBrokeringConfig): Promise<void> {
    if (config.enabled) {
      await this.upsertIdentityProvider({
        alias: "platform-realm",
        displayName: "Login with Platform Admin",
        providerId: "keycloak-oidc",
        config: {},
        enabled: true,
      });
    } else {
      await this.removeIdentityProvider("platform-realm");
    }
  }
}

// ---------------------------------------------------------------------------
// KeycloakProvisioningAdapter — creates/deletes realms via master realm admin
// ADR-0031: infrastructure provisioning privilege model
// ---------------------------------------------------------------------------

export interface KeycloakProvisioningConfig {
  url: string;
  /** Master realm service account client ID */
  provisionerClientId: string;
  provisionerClientSecret: string;
}

export class KeycloakProvisioningAdapter implements RealmProvisioningPort {
  private readonly config: KeycloakProvisioningConfig;

  constructor(config: KeycloakProvisioningConfig) {
    this.config = config;
  }

  private async getMasterToken(): Promise<string> {
    const tokenUrl = `${this.config.url}/realms/master/protocol/openid-connect/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.provisionerClientId,
        client_secret: this.config.provisionerClientSecret,
      }),
    });
    if (!response.ok) throw new Error(`Keycloak provisioner token failed: ${response.status}`);
    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  async realmExists(realmName: string): Promise<boolean> {
    const token = await this.getMasterToken();
    const response = await fetch(`${this.config.url}/admin/realms/${realmName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  }

  async createRealm(cfg: RealmProvisioningConfig): Promise<void> {
    if (await this.realmExists(cfg.realmName)) return; // idempotent
    const token = await this.getMasterToken();
    const response = await fetch(`${this.config.url}/admin/realms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        realm: cfg.realmName,
        displayName: cfg.displayName,
        enabled: true,
        accessTokenLifespan: 900,
        ssoSessionIdleTimeout: 1800,
        ssoSessionMaxLifespan: 36000,
        registrationAllowed: false,
        loginWithEmailAllowed: true,
        duplicateEmailsAllowed: false,
        verifyEmail: false,
        resetPasswordAllowed: true,
      }),
    });
    if (!response.ok)
      throw new Error(`Failed to create realm ${cfg.realmName}: ${response.status}`);
    // Register the BFF client for this realm
    await this.createBffClient(cfg, token);
  }

  private async createBffClient(cfg: RealmProvisioningConfig, token: string): Promise<void> {
    await fetch(`${this.config.url}/admin/realms/${cfg.realmName}/clients`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: cfg.bffClientId,
        secret: cfg.bffClientSecret,
        publicClient: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        redirectUris: cfg.bffRedirectUris,
        webOrigins: ["+"],
        protocol: "openid-connect",
      }),
    });
  }

  async deleteRealm(realmName: string): Promise<void> {
    const token = await this.getMasterToken();
    await fetch(`${this.config.url}/admin/realms/${realmName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
