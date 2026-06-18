import { z } from "zod";

export const packageName = "@platform/contracts-organisation";

export const OrganisationProfileSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganisationProfile = z.infer<typeof OrganisationProfileSchema>;

/**
 * Update request bounds mirror the domain rules enforced by
 * apps/platform-api `normaliseOrganisationDisplayName`. Keep them in lock-step
 * so the contract validates exactly what the domain accepts.
 */
export const UpdateOrganisationProfileRequestSchema = z
  .object({
    displayName: z
      .string()
      .min(2, "Display name must be at least 2 characters")
      .max(120, "Display name must be 120 characters or less"),
  })
  .strict();
export type UpdateOrganisationProfileRequest = z.infer<
  typeof UpdateOrganisationProfileRequestSchema
>;

export type GetOrganisationProfileResponse = OrganisationProfile;
export type UpdateOrganisationProfileResponse = OrganisationProfile;
