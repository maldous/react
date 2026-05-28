import type { OrganisationProfile } from "@platform/contracts-organisation";

export interface OrganisationRepository {
  getById(organisationId: string): Promise<OrganisationProfile | null>;
  updateDisplayName(
    organisationId: string,
    displayName: string
  ): Promise<OrganisationProfile | null>;
}
