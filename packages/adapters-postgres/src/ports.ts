import type { User, ExternalIdentity, Membership, TenantRole } from "@platform/domain-identity";
import type { OrganisationProfile } from "@platform/contracts-organisation";

export interface IdentityRepository {
  findExternalIdentity(
    provider: string,
    providerSubject: string
  ): Promise<{ user: User; externalIdentity: ExternalIdentity } | null>;

  createUserAndExternalIdentity(input: {
    email: string;
    displayName: string;
    provider: string;
    providerSubject: string;
  }): Promise<{ user: User; externalIdentity: ExternalIdentity }>;

  /** Find an existing user by email (case-insensitive). Used to re-link a new
   *  external identity to an existing account when the IdP subject rotated (e.g. a
   *  Keycloak realm rebuild) — ADR-ACT-0282. */
  findUserByEmail(email: string): Promise<User | null>;

  /** Attach a new (provider, providerSubject) external identity to an EXISTING
   *  user. Safe only after the caller has verified the email (getUserInfo refuses
   *  unverified emails). Idempotent on the (provider, providerSubject) unique key. */
  linkExternalIdentity(
    userId: string,
    input: { provider: string; providerSubject: string; email: string }
  ): Promise<ExternalIdentity>;

  findMembershipByUser(userId: string): Promise<(Membership & { role: TenantRole }) | null>;

  /**
   * Consume any unexpired pending invitations for the given user email,
   * creating membership records in the relevant tenant schemas.
   * Called on first login to implement JIT membership (ADR-0030 §4g).
   */
  consumePendingInvitationsForUser(
    userId: string,
    email: string
  ): Promise<Array<{ organisationId: string; role: TenantRole }>>;
}

export interface OrganisationRepository {
  getById(organisationId: string): Promise<OrganisationProfile | null>;
  updateDisplayName(
    organisationId: string,
    displayName: string
  ): Promise<OrganisationProfile | null>;
}
