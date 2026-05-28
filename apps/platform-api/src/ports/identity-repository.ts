import type { User, ExternalIdentity, Membership, TenantRole } from "@platform/domain-identity";

/**
 * Repository port for identity-related reads and writes.
 *
 * Only the operations required for the OAuth callback flow are modelled here.
 * Future operations (role changes, membership management) belong in separate ports.
 */
export interface IdentityRepository {
  /**
   * Find a User + ExternalIdentity pair by provider and subject.
   * Returns null when no matching ExternalIdentity exists.
   */
  findExternalIdentity(
    provider: string,
    providerSubject: string
  ): Promise<{ user: User; externalIdentity: ExternalIdentity } | null>;

  /**
   * Create a new User and ExternalIdentity in a single transaction.
   * Used when a first-time Keycloak login has no matching local identity.
   */
  createUserAndExternalIdentity(input: {
    email: string;
    displayName: string;
    provider: string;
    providerSubject: string;
  }): Promise<{ user: User; externalIdentity: ExternalIdentity }>;

  /**
   * Find the most recent active Membership for a given user.
   * Returns null when the user has no membership (no-membership actor).
   */
  findMembershipByUser(userId: string): Promise<(Membership & { role: TenantRole }) | null>;
}
