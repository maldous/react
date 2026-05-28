import { z } from "zod";

export const packageName = "@platform/contracts-organisation";

export const OrganisationProfileSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganisationProfile = z.infer<typeof OrganisationProfileSchema>;

export const UpdateOrganisationProfileRequestSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be 100 characters or less"),
});
export type UpdateOrganisationProfileRequest = z.infer<
  typeof UpdateOrganisationProfileRequestSchema
>;

export type GetOrganisationProfileResponse = OrganisationProfile;
export type UpdateOrganisationProfileResponse = OrganisationProfile;
