import type { OrganisationProfile } from "@platform/contracts-organisation";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
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

// Detect ASCII control characters by code point (0-31, 127) rather than a
// literal-control-char regex range (error-prone — Sonar S6324).
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normaliseOrganisationDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("feature.organisation.profile.form.displayName.validation.required");
  }
  if (trimmed.length < 2) {
    throw new ValidationError("feature.organisation.profile.form.displayName.validation.tooShort");
  }
  if (trimmed.length > 120) {
    throw new ValidationError("feature.organisation.profile.form.displayName.validation.tooLong");
  }
  if (hasControlChar(trimmed)) {
    throw new ValidationError("feature.organisation.profile.form.displayName.validation.invalid");
  }
  return trimmed;
}

export interface OrganisationUseCaseDeps {
  organisations: OrganisationRepository;
  audit: AuditEventPort;
}

export async function getOrganisationProfile(
  input: { organisationId: string },
  deps: OrganisationUseCaseDeps
): Promise<OrganisationProfile> {
  const profile = await deps.organisations.getById(input.organisationId);
  if (!profile) {
    throw new NotFoundError("api.error.organisationNotFound");
  }
  return profile;
}

export async function updateOrganisationDisplayName(
  input: {
    organisationId: string;
    displayName: string;
    actor: { actorId: string; actorRoles: string[]; sourceHost?: string };
  },
  deps: OrganisationUseCaseDeps
): Promise<OrganisationProfile> {
  const displayName = normaliseOrganisationDisplayName(input.displayName);
  const existing = await deps.organisations.getById(input.organisationId);
  if (!existing) {
    throw new NotFoundError("api.error.organisationNotFound");
  }
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.OrganisationUpdated,
      resource: "organisation:profile",
      resourceId: input.organisationId,
      metadata: {
        before: { displayName: existing.displayName },
        after: { displayName },
      },
      sourceHost: input.actor.sourceHost,
    })
  );
  const profile = await deps.organisations.updateDisplayName(input.organisationId, displayName);
  if (!profile) {
    throw new NotFoundError("api.error.organisationNotFound");
  }
  return profile;
}
