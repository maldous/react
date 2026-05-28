export const packageName = "@platform/adapters-keycloak";

// Internal Keycloak claim types — NEVER exported to domain or React packages
interface KeycloakTokenClaims {
  sub: string;
  preferred_username: string;
  email?: string;
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
 * Maps Keycloak JWT claims to internal identity fields.
 * This is the ONLY place where Keycloak claim names appear.
 * All other packages use the mapped result.
 */
export function mapKeycloakClaims(claims: Record<string, unknown>): KeycloakIdentityResult {
  const kc = claims as KeycloakTokenClaims;
  return {
    providerSubject: kc.sub,
    provider: "keycloak",
    email: (kc.email ?? kc.preferred_username) as string,
    displayName: (kc.preferred_username ?? kc.email ?? kc.sub) as string,
    realmRoles: kc.realm_access?.roles ?? [],
  };
}

/**
 * Placeholder for Keycloak token verification.
 * Real implementation uses keycloak-connect or openid-client at the adapter layer.
 * Returns null if the token cannot be verified.
 */
export async function verifyKeycloakToken(token: string): Promise<Record<string, unknown> | null> {
  // Implementation: decode + verify JWT signature using JWKS endpoint
  // This stub returns null — real impl goes in ADR-ACT-0108 full implementation
  void token;
  return null;
}

/**
 * Placeholder for Keycloak authorization code exchange.
 * Real implementation uses openid-client Authorization Code + PKCE flow.
 */
export async function exchangeCodeForTokens(
  _code: string,
  _redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  // Stub — real implementation wires openid-client at adapter layer
  return null;
}
