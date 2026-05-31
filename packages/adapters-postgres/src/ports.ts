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
