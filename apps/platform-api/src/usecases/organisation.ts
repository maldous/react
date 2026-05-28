import type { OrganisationProfile } from "@platform/contracts-organisation";
import { NotFoundError, ValidationError } from "@platform/platform-errors";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";

/**
 * Use cases in the canonical first-slice pattern (ADR-ACT-0008) are pure:
 *  - depend only on injected ports (no module-level singletons)
 *  - never read environment variables
 *  - never construct adapters
 *  - never resolve sessions
 *  - never know SQL
 *
 * Logging and tracing are owned by the API pipeline / handler layer so the
 * use case stays testable as plain TypeScript with a fake repository.
 */

const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;

export function normaliseOrganisationDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Display name is required");
  }
  if (trimmed.length < 2) {
    throw new ValidationError("Display name must be at least 2 characters");
  }
  if (trimmed.length > 120) {
    throw new ValidationError("Display name must be 120 characters or less");
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    throw new ValidationError("Display name must not contain control characters");
  }
  return trimmed;
}

export interface OrganisationUseCaseDeps {
  organisations: OrganisationRepository;
}

export async function getOrganisationProfile(
  input: { organisationId: string },
  deps: OrganisationUseCaseDeps
): Promise<OrganisationProfile> {
  const profile = await deps.organisations.getById(input.organisationId);
  if (!profile) {
    throw new NotFoundError("Organisation not found");
  }
  return profile;
}

export async function updateOrganisationDisplayName(
  input: { organisationId: string; displayName: string },
  deps: OrganisationUseCaseDeps
): Promise<OrganisationProfile> {
  const displayName = normaliseOrganisationDisplayName(input.displayName);
  const profile = await deps.organisations.updateDisplayName(input.organisationId, displayName);
  if (!profile) {
    throw new NotFoundError("Organisation not found");
  }
  return profile;
}
