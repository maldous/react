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
