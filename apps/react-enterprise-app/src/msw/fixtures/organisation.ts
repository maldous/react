import type { OrganisationProfile } from "@platform/contracts-organisation";

// Canonical organisation-profile fixture for frontend tests. Shape mirrors the
// GraphQL Organisation type / OrganisationProfileSchema exactly.
export const organisationFixture: OrganisationProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "fixture-org",
  displayName: "Fixture Organisation",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
