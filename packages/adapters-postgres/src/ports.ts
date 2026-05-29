import type { User, ExternalIdentity, Membership, TenantRole } from "@platform/domain-identity";
import type { OrganisationProfile } from "@platform/contracts-organisation";

export interface IdentityRepository {
  findExternalIdentity(
    provider: string,
    providerSubject: string,
  ): Promise<{ user: User; externalIdentity: ExternalIdentity } | null>;

  createUserAndExternalIdentity(input: {
    email: string;
    displayName: string;
    provider: string;
    providerSubject: string;
  }): Promise<{ user: User; externalIdentity: ExternalIdentity }>;

  findMembershipByUser(userId: string): Promise<(Membership & { role: TenantRole }) | null>;
}

export interface OrganisationRepository {
  getById(organisationId: string): Promise<OrganisationProfile | null>;
  updateDisplayName(
    organisationId: string,
    displayName: string,
  ): Promise<OrganisationProfile | null>;
}
