import { resolvePermissions } from "@platform/domain-identity";
import type { KeycloakIdentityResult } from "@platform/adapters-keycloak";
import type { SessionStore, CreateSessionCommand } from "@platform/session-runtime";
import type { IdentityRepository } from "../ports/identity-repository.ts";
import { encryptToken } from "../server/token-crypto.ts";

export interface AuthUseCaseDeps {
  identities: IdentityRepository;
  sessions: SessionStore;
}

/** Tokens returned by the Keycloak token exchange. Optional — absent for fixture sessions. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  idToken?: string; // OIDC id_token — stored for logout id_token_hint (ADR-ACT-0157)
}

export interface SessionResolution {
  sessionId: string;
  userId: string;
  tenantId: string;
  organisationId: string;
  roles: string[];
  permissions: string[];
  displayName: string;
}

/**
 * Resolve or create a platform session for a verified Keycloak identity.
 *
 * Flow (ADR-0022):
 * 1. Look up ExternalIdentity by (provider, providerSubject)
 * 2. If not found, create User + ExternalIdentity (first-time login)
 * 3. Look up active Membership for the user
 * 4. Resolve permissions from role (ADR-0021)
 * 5. Create a server-side session (stored in Redis via SessionStore)
 * 6. Return the session ID so the handler can set the cookie
 *
 * This use case is pure:
 * - no pg imports
 * - no env var reads
 * - no HTTP types
 * - no Keycloak SDK types beyond KeycloakIdentityResult
 */
export async function resolveSessionFromIdentity(
  identity: KeycloakIdentityResult,
  deps: AuthUseCaseDeps,
  sessionTtlSeconds = 1800,
  tokens?: TokenSet
): Promise<SessionResolution> {
  // Step 1?2: Look up or create the internal User + ExternalIdentity
  let pair = await deps.identities.findExternalIdentity(
    identity.provider,
    identity.providerSubject
  );

  if (!pair) {
    // The (provider, subject) is unknown. The email is already verified upstream
    // (getUserInfo refuses unverified emails), so if an account with this email
    // already exists, RE-LINK the new external identity to it rather than failing on
    // the unique-email constraint. This handles IdP subject rotation — notably a
    // Keycloak realm rebuild, which gives every user a fresh subject (ADR-ACT-0282).
    const existingUser = await deps.identities.findUserByEmail(identity.email);
    if (existingUser) {
      const externalIdentity = await deps.identities.linkExternalIdentity(existingUser.id, {
        provider: identity.provider,
        providerSubject: identity.providerSubject,
        email: identity.email,
      });
      pair = { user: existingUser, externalIdentity };
    } else {
      pair = await deps.identities.createUserAndExternalIdentity({
        email: identity.email,
        displayName: identity.displayName,
        provider: identity.provider,
        providerSubject: identity.providerSubject,
      });
    }
  }

  const { user } = pair;

  // Step 2b: Consume any pending invitations for this user's email (JIT membership).
  // This is a no-op when no invitations exist or all are already consumed.
  // Must run before findMembershipByUser so the membership is visible immediately.
  await deps.identities.consumePendingInvitationsForUser(user.id, identity.email);

  // Step 3: Derive roles and permissions.
  //
  // system-admin is a Keycloak realm role (no DB membership) — ADR-0021.
  // All other roles come exclusively from the platform DB membership record.
  // The Keycloak BFF client includes realm_access.roles in /userinfo (ADR-ACT-0175),
  // so identity.realmRoles is populated with the user's Keycloak realm assignments.
  const isSystemAdmin = identity.realmRoles.includes("system-admin");

  // Skip the DB lookup for system admins — they have no org membership.
  const membership = isSystemAdmin ? null : await deps.identities.findMembershipByUser(user.id);

  const tenantId = membership?.organisationId ?? "";
  const organisationId = membership?.organisationId ?? "";
  const roles: string[] = isSystemAdmin ? ["system-admin"] : membership ? [membership.role] : [];
  const permissions = isSystemAdmin
    ? resolvePermissions("system-admin")
    : membership
      ? resolvePermissions(membership.role)
      : [];

  // Step 4: Create server-side session.
  // Tokens are encrypted before storage (ADR-ACT-0153 / ADR-0022 amendment).
  // Fixture sessions pass no tokens; only real Keycloak sessions store them.
  const command: CreateSessionCommand = {
    userId: user.id,
    tenantId,
    organisationId,
    roles,
    permissions,
    displayName: user.displayName,
    ttlSeconds: sessionTtlSeconds,
    ...(tokens
      ? {
          accessTokenEnc: encryptToken(tokens.accessToken),
          refreshTokenEnc: encryptToken(tokens.refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          ...(tokens.idToken ? { idTokenEnc: encryptToken(tokens.idToken) } : {}),
        }
      : {}),
  };

  const sessionId = await deps.sessions.create(command);

  return {
    sessionId,
    userId: user.id,
    tenantId,
    organisationId,
    roles,
    permissions,
    displayName: user.displayName,
  };
}

/**
 * Read and validate an existing session from a session ID.
 * Returns null when the session does not exist or has expired.
 */
export async function readSession(
  sessionId: string,
  deps: { sessions: SessionStore }
): Promise<SessionResolution | null> {
  const record = await deps.sessions.find(sessionId);
  if (!record) return null;

  return {
    sessionId: record.sessionId,
    userId: record.userId,
    tenantId: record.tenantId,
    organisationId: record.organisationId,
    roles: record.roles,
    permissions: record.permissions,
    displayName: record.displayName,
  };
}

/**
 * Destroy a session (logout).
 */
export async function destroySession(
  sessionId: string,
  deps: { sessions: SessionStore }
): Promise<void> {
  await deps.sessions.destroy(sessionId);
}
