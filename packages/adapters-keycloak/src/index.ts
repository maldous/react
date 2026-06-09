export const packageName = "@platform/adapters-keycloak";

// Internal Keycloak claim types ? NEVER exported to domain or React packages
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
 * Passed explicitly ? this adapter never reads environment variables directly.
 */
export interface KeycloakClientConfig {
  url: string; // server-side only ? e.g. http://keycloak:8080 or http://localhost:8080
  realm: string; // e.g. platform
  clientId: string; // e.g. platform-api
  clientSecret: string;
  /** Public-facing base URL for browser redirects (e.g. http://aldous.info/kc).
   * Falls back to `url` when absent ? correct for local dev without Caddy. */
  publicUrl?: string;
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
    // Explicit scope ensures the token includes the openid scope,
    // which is required for the userinfo endpoint to accept it.
    scope: "openid email profile",
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
    /**
     * Keycloak `kc_idp_hint`: routes the user straight to a brokered upstream
     * identity provider (e.g. mock-google) instead of the Keycloak login form.
     * MUST be a validated Keycloak IdP alias — never raw user input. The BFF
     * resolves it from a fixed product→alias map before calling this.
     */
    idpHint?: string;
  },
  config: KeycloakClientConfig
): string {
  const base = `${config.publicUrl ?? config.url}/realms/${config.realm}/protocol/openid-connect/auth`;
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope ?? "openid profile email",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  if (params.idpHint) query.set("kc_idp_hint", params.idpHint);
  return `${base}?${query.toString()}`;
}

/**
 * Stub ? kept for interface compatibility.
 * The real verification path uses getUserInfo instead, which avoids JWKS
 * caching complexity. This stub is preserved for future use cases where
 * the platform receives inbound tokens from external callers.
 */
export async function verifyKeycloakToken(token: string): Promise<Record<string, unknown> | null> {
  void token;
  return null;
}

// ---------------------------------------------------------------------------
// KeycloakAuthorisationAdapter ? implements AuthorisationPort via UMA 2.0
// KeycloakRealmAdminAdapter ? implements RealmAdminPort via Admin REST API
// KeycloakProvisioningAdapter ? creates/deletes realms (ADR-0031)
// ADR-0030 ?3a, ?6b | ADR-0031
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
  KeycloakGroup,
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
      return { granted: false, reason: "keycloak_unavailable" };
    }
  }
}

// ---------------------------------------------------------------------------
// KeycloakRealmAdminAdapter ? implements RealmAdminPort via Admin REST API
// ADR-0030 ?1b, ?6b
// ---------------------------------------------------------------------------

export interface KeycloakAdminConfig {
  url: string;
  realm: string;
  /** Service account client ID with realm-admin role (client_credentials grant). */
  adminClientId: string;
  adminClientSecret: string;
  /**
   * Optional master-realm admin username/password (e.g. the bootstrap `admin`
   * user via the public `admin-cli` client). When present, getAdminToken uses
   * the password grant instead of client_credentials. This is the dev/test
   * seeding path (ADR-ACT-0157) — it needs no pre-provisioned service-account
   * client and is never used by the production runtime, which configures a
   * confidential service account with a secret.
   */
  adminUsername?: string;
  adminPassword?: string;
}

// ---------------------------------------------------------------------------
// hasUserinfoRealmRolesMapper — pure predicate (ADR-ACT-0181 / ADR-ACT-0175)
//
// Returns true when the given array of Keycloak protocol-mapper objects contains
// a mapper that exposes realm_access.roles in /userinfo. Match is on functional
// config rather than mapper name to tolerate the two creation paths:
//   - Terraform names it "realm-roles-userinfo" (platform realm)
//   - KeycloakProvisioningAdapter names it "realm-roles-userinfo" (tenant realms)
//
// Required properties:
//   protocolMapper === "oidc-usermodel-realm-role-mapper"
//   config["claim.name"] === "realm_access.roles"
//   config["userinfo.token.claim"] === "true"
// ---------------------------------------------------------------------------

export interface KeycloakProtocolMapper {
  protocolMapper?: string;
  config?: Record<string, string>;
  [key: string]: unknown;
}

export function hasUserinfoRealmRolesMapper(mappers: unknown[]): boolean {
  return mappers.some((m) => {
    const mapper = m as KeycloakProtocolMapper;
    return (
      mapper.protocolMapper === "oidc-usermodel-realm-role-mapper" &&
      mapper.config?.["claim.name"] === "realm_access.roles" &&
      mapper.config?.["userinfo.token.claim"] === "true"
    );
  });
}

// ---------------------------------------------------------------------------
// authorizationServerConfig — UMA resource-server configuration (ADR-ACT-0200)
//
// policyEnforcementMode is ENFORCING (not PERMISSIVE): a UMA resource with no
// granting permission is denied by default. This is the deny-by-default posture
// required by ADR-0021/ADR-0029 — new tenants are NOT fail-open. Every UMA-gated
// route also carries a static `requiredPermission`, so when UMA denies, the BFF
// pipeline falls back to the role-based check rather than locking users out.
// ---------------------------------------------------------------------------

export function authorizationServerConfig(): {
  policyEnforcementMode: "ENFORCING";
  allowRemoteResourceManagement: boolean;
  decisionStrategy: "AFFIRMATIVE";
} {
  return {
    policyEnforcementMode: "ENFORCING",
    allowRemoteResourceManagement: true,
    decisionStrategy: "AFFIRMATIVE",
  };
}

export class KeycloakRealmAdminAdapter implements RealmAdminPort {
  private readonly config: KeycloakAdminConfig;

  constructor(config: KeycloakAdminConfig) {
    this.config = config;
  }

  private async getAdminToken(): Promise<string> {
    const tokenUrl = `${this.config.url}/realms/master/protocol/openid-connect/token`;
    // Password grant via admin-cli (dev/test seeding) when admin user creds are
    // supplied; otherwise the production client_credentials service-account grant.
    const body =
      this.config.adminUsername && this.config.adminPassword
        ? new URLSearchParams({
            grant_type: "password",
            client_id: this.config.adminClientId || "admin-cli",
            username: this.config.adminUsername,
            password: this.config.adminPassword,
          })
        : new URLSearchParams({
            grant_type: "client_credentials",
            client_id: this.config.adminClientId,
            client_secret: this.config.adminClientSecret,
          });
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Keycloak admin token fetch failed: ${response.status}`);
    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  private adminUrl(path: string): string {
    return `${this.config.url}/admin/realms/${this.config.realm}${path}`;
  }

  // Read a bounded, single-line slice of an error response body for diagnostics.
  // Keycloak admin errors are small JSON ({error, error_description}); we cap the
  // length and collapse whitespace so nothing large or multi-line leaks into logs.
  private async readSafeBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.replace(/\s+/g, " ").trim().slice(0, 300);
    } catch {
      return "<unreadable body>";
    }
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
    const instanceUrl = this.adminUrl(`/identity-provider/instances/${idp.alias}`);
    const existing = await fetch(instanceUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 → create (POST); 200 → update (PUT). Any other status is an admin-side
    // failure (auth, realm, Keycloak down) and must not be silently treated as "create".
    if (!existing.ok && existing.status !== 404) {
      throw new Error(
        `upsertIdentityProvider(${idp.alias}): existence check failed: ` +
          `${existing.status} ${await this.readSafeBody(existing)}`
      );
    }
    const method = existing.ok ? "PUT" : "POST";
    const url = existing.ok ? instanceUrl : this.adminUrl("/identity-provider/instances");
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(idp),
    });
    if (!res.ok) {
      throw new Error(
        `upsertIdentityProvider(${method} ${idp.alias}): Keycloak admin write failed: ` +
          `${res.status} ${await this.readSafeBody(res)}`
      );
    }
  }

  async removeIdentityProvider(alias: string): Promise<void> {
    const token = await this.getAdminToken();
    const res = await fetch(this.adminUrl(`/identity-provider/instances/${alias}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 is intentionally idempotent: the provider is already absent. Any other
    // non-OK status is a real failure and must surface rather than silently pass.
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `removeIdentityProvider(${alias}): Keycloak admin delete failed: ` +
          `${res.status} ${await this.readSafeBody(res)}`
      );
    }
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
    const token = await this.getAdminToken();
    const clientUuid = await this._getBffClientUuid(token);
    if (!clientUuid) return [];
    const res = await fetch(
      `${this.config.url}/admin/realms/${this.config.realm}/clients/${clientUuid}/authz/resource-server/policy?name=${encodeURIComponent(resourceName)}&max=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    return (await res.json()) as ResourcePolicy[];
  }

  async setResourcePolicy(resourceName: string, policy: ResourcePolicy): Promise<void> {
    const ALLOWED_POLICY_TYPES: ResourcePolicy["type"][] = [
      "role",
      "time",
      "aggregated",
      "user",
      "group",
      "regex",
    ];
    if (!ALLOWED_POLICY_TYPES.includes(policy.type)) {
      throw new Error(`setResourcePolicy: policy type "${policy.type}" is not allowed`);
    }
    const token = await this.getAdminToken();
    const clientUuid = await this._getBffClientUuid(token);
    if (!clientUuid) throw new Error("setResourcePolicy: BFF client not found");
    const policyUrl = `${this.config.url}/admin/realms/${this.config.realm}/clients/${clientUuid}/authz/resource-server/policy`;
    const body = { ...policy, resources: [resourceName] };
    const res = await fetch(policyUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`setResourcePolicy: failed ${res.status}`);
    }
  }

  async removeResourcePolicy(resourceName: string, policyName: string): Promise<void> {
    const token = await this.getAdminToken();
    const clientUuid = await this._getBffClientUuid(token);
    if (!clientUuid) return;
    const searchRes = await fetch(
      `${this.config.url}/admin/realms/${this.config.realm}/clients/${clientUuid}/authz/resource-server/policy?name=${encodeURIComponent(policyName)}&max=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!searchRes.ok) return;
    const policies = (await searchRes.json()) as Array<{ id: string }>;
    const policyId = policies[0]?.id;
    if (!policyId) return;
    await fetch(
      `${this.config.url}/admin/realms/${this.config.realm}/clients/${clientUuid}/authz/resource-server/policy/${policyId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    void resourceName;
  }

  /** Helper: resolve the BFF client UUID (platform-api) by clientId. Cached-free (called per operation). */
  private async _getBffClientUuid(token: string): Promise<string | null> {
    const res = await fetch(this.adminUrl(`/clients?clientId=platform-api&max=1`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const clients = (await res.json()) as Array<{ id: string }>;
    return clients[0]?.id ?? null;
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

  /**
   * Check whether the BFF client for a given clientId has the required
   * realm-roles-userinfo mapper (ADR-ACT-0181 / ADR-ACT-0175).
   *
   * Returns:
   *   "present"     — mapper found with correct functional config
   *   "missing"     — admin API responded but mapper is absent or misconfigured
   *   "unavailable" — admin API is unreachable or returned an auth error
   */
  async checkUserinfoRealmRolesMapper(
    clientId: string
  ): Promise<"present" | "missing" | "unavailable"> {
    let token: string;
    try {
      token = await this.getAdminToken();
    } catch {
      return "unavailable";
    }

    // Look up the client's internal Keycloak UUID by clientId
    let clientUuid: string;
    try {
      const res = await fetch(
        this.adminUrl(`/clients?clientId=${encodeURIComponent(clientId)}&max=2`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return "unavailable";
      const list = (await res.json()) as Array<{ id?: string }>;
      const found = list[0]?.id;
      if (!found) return "missing";
      clientUuid = found;
    } catch {
      return "unavailable";
    }

    // Fetch protocol mappers for this client
    let mappers: unknown[];
    try {
      const res = await fetch(this.adminUrl(`/clients/${clientUuid}/protocol-mappers/models`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return "unavailable";
      mappers = (await res.json()) as unknown[];
    } catch {
      return "unavailable";
    }

    return hasUserinfoRealmRolesMapper(mappers) ? "present" : "missing";
  }

  // ---------------------------------------------------------------------------
  // Group management (ADR-ACT-0143 Slice 2)
  // Uses the realm admin token (per-tenant service account, ADR-ACT-0186).
  // Reads fail-soft (return [] / null on non-OK) so list never throws.
  // Writes throw on non-OK — caller converts to result types.
  // ---------------------------------------------------------------------------

  async listGroups(): Promise<KeycloakGroup[]> {
    const token = await this.getAdminToken();
    const res = await fetch(this.adminUrl("/groups?max=200"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return (await res.json()) as KeycloakGroup[];
  }

  async getGroup(groupId: string): Promise<KeycloakGroup | null> {
    const token = await this.getAdminToken();
    const res = await fetch(this.adminUrl(`/groups/${encodeURIComponent(groupId)}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as KeycloakGroup;
  }

  async createGroup(name: string): Promise<string> {
    const token = await this.getAdminToken();
    const res = await fetch(this.adminUrl("/groups"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`createGroup: failed ${res.status}`);
    // Keycloak returns 201 with Location: .../groups/{id}
    const location = res.headers.get("location") ?? "";
    const id = location.split("/").pop() ?? "";
    if (!id) throw new Error("createGroup: could not extract group ID from Location header");
    return id;
  }

  async updateGroup(groupId: string, name: string, existing: KeycloakGroup): Promise<void> {
    const token = await this.getAdminToken();
    // Merge to avoid wiping existing group attributes/roles
    const body: KeycloakGroup = { ...existing, name };
    const res = await fetch(this.adminUrl(`/groups/${encodeURIComponent(groupId)}`), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`updateGroup: failed ${res.status}`);
  }

  async deleteGroup(groupId: string): Promise<void> {
    const token = await this.getAdminToken();
    const res = await fetch(this.adminUrl(`/groups/${encodeURIComponent(groupId)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`deleteGroup: failed ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// KeycloakProvisioningAdapter ? creates/deletes realms via master realm admin
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

    // Give Keycloak a short moment to propagate the new realm before
    // registering the BFF client. The admin token has full realm-admin
    // access, so permission issues should not arise; this delay handles
    // any transient Keycloak propagation timing.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await this.createBffClient(cfg);
  }

  private async createBffClient(cfg: RealmProvisioningConfig): Promise<void> {
    // Use admin token instead of provisioner token for managing tenant realm
    // resources (client creation, mapper, authorization config). The provisioner
    // create-realm role does not grant manage-clients on the new realm.
    const adminToken = await this.getMasterToken();
    const clientsUrl = `${this.config.url}/admin/realms/${cfg.realmName}/clients`;
    const res = await fetch(clientsUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: cfg.bffClientId,
        secret: cfg.bffClientSecret,
        publicClient: false,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        authorizationServicesEnabled: true,
        redirectUris: cfg.bffRedirectUris,
        webOrigins: ["+"],
        protocol: "openid-connect",
      }),
    });

    // Throw on failure so the provisioning caller knows the client wasn't created
    // and can clean up. 409 = already exists from a prior partial provisioning;
    // we still add the mapper in case it was left absent.
    if (!res.ok && res.status !== 409) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `createBffClient: failed to create client ${cfg.bffClientId} in realm ${cfg.realmName}: ${res.status} ${errBody}`
      );
    }

    // Add realm-roles-in-userinfo mapper so the BFF can read realmRoles from /userinfo.
    // This mirrors the Terraform-managed mapper on the platform realm (ADR-ACT-0179).
    // Without it, system-admin role detection fails for users authenticating via this realm.
    if (res.ok || res.status === 409) {
      const clients = await fetch(`${clientsUrl}?clientId=${cfg.bffClientId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (clients.ok) {
        const list = (await clients.json()) as Array<{ id: string }>;
        const clientId = list[0]?.id;
        if (clientId) {
          await fetch(`${clientsUrl}/${clientId}/protocol-mappers/models`, {
            method: "POST",
            headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "realm-roles-userinfo",
              protocol: "openid-connect",
              protocolMapper: "oidc-usermodel-realm-role-mapper",
              config: {
                "claim.name": "realm_access.roles",
                multivalued: "true",
                "id.token.claim": "false",
                "access.token.claim": "false",
                "userinfo.token.claim": "true",
              },
            }),
          });

          // Configure the authorization resource server in ENFORCING mode
          // (ADR-ACT-0200, security fix). In ENFORCING mode any UMA resource
          // without an explicit granting permission is denied by default —
          // closing the prior fail-open hole where PERMISSIVE mode auto-granted
          // every policy-less resource to any authenticated tenant user.
          //
          // This is safe because every UMA-gated route (resource+umaScope) also
          // declares a static `requiredPermission`; when UMA denies, the BFF
          // pipeline falls back to the role-based permission check
          // (apps/platform-api/src/server/pipeline.ts). Sensitive resources
          // (admin:auth, platform:support#enter, organisation:members#delete)
          // therefore deny-by-default until an admin grants a policy via
          // setResourcePolicy().
          const authzRes = await fetch(`${clientsUrl}/${clientId}/authz/resource-server`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${adminToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(authorizationServerConfig()),
          });
          if (!authzRes.ok) {
            const errBody = await authzRes.text().catch(() => "");
            throw new Error(
              `createBffClient: failed to configure authorization server for client ${cfg.bffClientId}: ${authzRes.status} ${errBody}`
            );
          }
        }
      }
    }
  }

  async deleteRealm(realmName: string): Promise<void> {
    const token = await this.getMasterToken();
    await fetch(`${this.config.url}/admin/realms/${realmName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /**
   * Create a realm-admin service account for Auth Settings operations (ADR-ACT-0186).
   *
   * Creates a confidential client in the given realm with serviceAccountsEnabled=true,
   * then grants it the minimum realm-management roles needed for Auth Settings:
   *   - manage-identity-providers  (IdP CRUD)
   *   - manage-realm               (MFA / session / sysadmin-brokering policy)
   *
   * The caller supplies the clientId and clientSecret (generated by provisioning).
   * Returns the same credential so the caller can persist it.
   *
   * If the client already exists (409) the method is idempotent: it still
   * attempts role grants in case a prior partial run left them absent.
   *
   * Throws if any step fails (realm unavailable, token error, role lookup fails).
   * The provisioning caller is responsible for cleanup via cleanupSteps.
   */
  async createAuthSettingsServiceAccount(
    realmName: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ clientId: string; clientSecret: string }> {
    // Use admin token for managing tenant realm resources (the provisioner
    // token lacks manage-clients on the new realm).
    const adminToken = await this.getMasterToken();
    const baseUrl = `${this.config.url}/admin/realms/${realmName}`;

    // 1. Create the confidential client with service accounts enabled
    const createRes = await fetch(`${baseUrl}/clients`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        secret: clientSecret,
        publicClient: false,
        standardFlowEnabled: false,
        serviceAccountsEnabled: true,
        directAccessGrantsEnabled: false,
        enabled: true,
        description: "Auth Settings API service account (ADR-ACT-0186)",
      }),
    });
    // 409 = already exists; treat as success, continue to grant roles
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(
        `createAuthSettingsServiceAccount: failed to create client ${clientId} in realm ${realmName}: ${createRes.status}`
      );
    }

    // 2. Resolve the client UUID (needed for service-account-user lookup)
    const lookupRes = await fetch(
      `${baseUrl}/clients?clientId=${encodeURIComponent(clientId)}&max=1`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    if (!lookupRes.ok)
      throw new Error(
        `createAuthSettingsServiceAccount: client lookup failed: ${lookupRes.status}`
      );
    const clients = (await lookupRes.json()) as Array<{ id: string }>;
    const clientUuid = clients[0]?.id;
    if (!clientUuid)
      throw new Error(
        `createAuthSettingsServiceAccount: client ${clientId} not found after create`
      );

    // 3. Get the realm-management client UUID
    const rmRes = await fetch(`${baseUrl}/clients?clientId=realm-management&max=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!rmRes.ok)
      throw new Error(
        `createAuthSettingsServiceAccount: realm-management lookup failed: ${rmRes.status}`
      );
    const rmClients = (await rmRes.json()) as Array<{ id: string }>;
    const rmUuid = rmClients[0]?.id;
    if (!rmUuid)
      throw new Error("createAuthSettingsServiceAccount: realm-management client not found");

    // 4. Get the specific roles needed
    const rolesNeeded = ["manage-identity-providers", "manage-realm"];
    const roleObjs: Array<{ id: string; name: string }> = [];
    for (const roleName of rolesNeeded) {
      const rRes = await fetch(
        `${baseUrl}/clients/${rmUuid}/roles/${encodeURIComponent(roleName)}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        }
      );
      if (!rRes.ok)
        throw new Error(
          `createAuthSettingsServiceAccount: role ${roleName} not found: ${rRes.status}`
        );
      roleObjs.push((await rRes.json()) as { id: string; name: string });
    }

    // 5. Get the service account user for our new client
    const saRes = await fetch(`${baseUrl}/clients/${clientUuid}/service-account-user`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!saRes.ok)
      throw new Error(
        `createAuthSettingsServiceAccount: service-account-user fetch failed: ${saRes.status}`
      );
    const saUser = (await saRes.json()) as { id: string };

    // 6. Grant the roles (idempotent — Keycloak ignores already-granted roles)
    const grantRes = await fetch(`${baseUrl}/users/${saUser.id}/role-mappings/clients/${rmUuid}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(roleObjs),
    });
    if (!grantRes.ok && grantRes.status !== 409) {
      throw new Error(`createAuthSettingsServiceAccount: role grant failed: ${grantRes.status}`);
    }

    return { clientId, clientSecret };
  }

  /**
   * Register the platform resource catalogue in a Keycloak realm's Authorization Server.
   * Called on tenant provisioning and when new resources are added to the platform.
   * Idempotent — POST returns 409 when resource already exists; we skip silently.
   *
   * Default resource registration makes no access-control behaviour change on day 1 —
   * policies are configured separately by `setResourcePolicy()`.
   */
  async registerPlatformResources(realmName: string, bffClientId: string): Promise<void> {
    // Use admin token (not provisioner token) for managing tenant realm resources.
    // The provisioner's create-realm role does not grant manage-clients on
    // the new realm, so client lookup and resource registration would 403.
    const token = await this.getMasterToken();

    // Resolve BFF client UUID
    const clientsRes = await fetch(
      `${this.config.url}/admin/realms/${realmName}/clients?clientId=${encodeURIComponent(bffClientId)}&max=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!clientsRes.ok)
      throw new Error(`registerPlatformResources: client lookup failed ${clientsRes.status}`);
    const clients = (await clientsRes.json()) as Array<{ id: string }>;
    const clientUuid = clients[0]?.id;
    if (!clientUuid)
      throw new Error(
        `registerPlatformResources: BFF client ${bffClientId} not found in realm ${realmName}`
      );

    const resourcesUrl = `${this.config.url}/admin/realms/${realmName}/clients/${clientUuid}/authz/resource-server/resource`;

    const resources = [
      {
        name: "organisation:profile",
        type: "urn:platform:resources:organisation",
        scopes: ["read", "write"],
      },
      {
        name: "organisation:members",
        type: "urn:platform:resources:organisation",
        scopes: ["read", "invite", "update_role", "delete"],
      },
      {
        name: "organisation:groups",
        type: "urn:platform:resources:organisation",
        scopes: ["read", "create", "update", "delete"],
      },
      {
        name: "organisation:sub-organisations",
        type: "urn:platform:resources:organisation",
        scopes: ["read", "create", "update", "delete"],
      },
      {
        name: "organisation:features",
        type: "urn:platform:resources:organisation",
        scopes: ["read", "update"],
      },
      { name: "admin:auth", type: "urn:platform:resources:admin", scopes: ["read", "write"] },
      {
        name: "admin:tenants",
        type: "urn:platform:resources:admin",
        scopes: ["create", "read", "update", "delete"],
      },
      { name: "platform:admin", type: "urn:platform:resources:platform", scopes: ["access"] },
      { name: "profile:self", type: "urn:platform:resources:profile", scopes: ["read", "write"] },
      { name: "audit:platform", type: "urn:platform:resources:audit", scopes: ["read"] },
      { name: "audit:tenant", type: "urn:platform:resources:audit", scopes: ["read"] },
      { name: "platform:support", type: "urn:platform:resources:platform", scopes: ["enter"] },
    ];

    for (const resource of resources) {
      const body = {
        name: resource.name,
        type: resource.type,
        scopes: resource.scopes.map((s) => ({ name: s })),
        displayName: resource.name,
      };
      const res = await fetch(resourcesUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 409) {
        throw new Error(
          `registerPlatformResources: failed to register ${resource.name}: ${res.status}`
        );
      }
    }
  }
}
