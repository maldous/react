import type { OrganisationProfile } from "@platform/contracts-organisation";
import { NotFoundError, ValidationError } from "@platform/platform-errors";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type { OrganisationRepository } from "../ports/organisation-repository.ts";

const logger = createLogger({ name: "organisation-usecase" });
const tracer = createTracer("@platform/platform-api", "0.1.0");

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

export async function getOrganisationProfile(
  input: { organisationId: string },
  deps: { organisations: OrganisationRepository }
): Promise<OrganisationProfile> {
  const { organisationId } = input;
  return withSpan(tracer, "organisation.profile.get", async (span) => {
    span.setAttribute("organisationId", organisationId);
    const opLogger = logger.child({ organisationId, operation: "organisation.profile.get" });
    opLogger.info("fetching organisation profile");
    const profile = await deps.organisations.getById(organisationId);
    if (!profile) {
      opLogger.warn("organisation not found");
      throw new NotFoundError("Organisation not found");
    }
    opLogger.info("organisation profile fetched");
    return profile;
  });
}

export async function updateOrganisationDisplayName(
  input: { organisationId: string; displayName: string },
  deps: { organisations: OrganisationRepository }
): Promise<OrganisationProfile> {
  const { organisationId } = input;
  const displayName = normaliseOrganisationDisplayName(input.displayName);
  return withSpan(tracer, "organisation.profile.update", async (span) => {
    span.setAttribute("organisationId", organisationId);
    const opLogger = logger.child({ organisationId, operation: "organisation.profile.update" });
    opLogger.info("updating organisation display name");
    const profile = await deps.organisations.updateDisplayName(organisationId, displayName);
    if (!profile) {
      opLogger.warn("organisation not found during update");
      throw new NotFoundError("Organisation not found");
    }
    opLogger.info("organisation display name updated");
    return profile;
  });
}
