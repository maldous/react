import { resolvePermissions } from "@platform/domain-identity";
import type { KeycloakIdentityResult } from "@platform/adapters-keycloak";
import type { SessionStore, CreateSessionCommand } from "@platform/session-runtime";
import type { IdentityRepository } from "../ports/identity-repository.ts";

export interface AuthUseCaseDeps {
  identities: IdentityRepository;
  sessions: SessionStore;
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
  sessionTtlSeconds = 1800
): Promise<SessionResolution> {
  // Step 1?2: Look up or create the internal User + ExternalIdentity
  let pair = await deps.identities.findExternalIdentity(
    identity.provider,
    identity.providerSubject
  );

  if (!pair) {
    pair = await deps.identities.createUserAndExternalIdentity({
      email: identity.email,
      displayName: identity.displayName,
      provider: identity.provider,
      providerSubject: identity.providerSubject,
    });
  }

  const { user } = pair;

  // Step 3: Find the user's active membership
  const membership = await deps.identities.findMembershipByUser(user.id);

  // Users with no membership are authenticated but have no org context.
  // The no-membership pattern is documented in ADR-ACT-0008.
  // They can still log in; permission guards will reject specific routes.
  const tenantId = membership?.organisationId ?? "";
  const organisationId = membership?.organisationId ?? "";
  const roles: string[] = membership ? [membership.role] : [];
  const permissions = membership ? resolvePermissions(membership.role) : [];

  // Step 4: Create server-side session (ADR-0022 ? no raw tokens stored)
  const command: CreateSessionCommand = {
    userId: user.id,
    tenantId,
    organisationId,
    roles,
    permissions,
    displayName: user.displayName,
    ttlSeconds: sessionTtlSeconds,
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
