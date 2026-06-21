import { ValidationError, ForbiddenError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";

export type ResidencyTag = string;

export interface DataResidencyRepository {
  getResidencyTag(organisationId: string): Promise<ResidencyTag | null>;
  setResidencyTag(organisationId: string, residencyTag: ResidencyTag): Promise<void>;
}

export interface DataResidencyDeps {
  repository: DataResidencyRepository;
  audit: AuditEventPort;
}

export interface DataResidencyActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

const TAG_RE = /^[a-z]{2}(?:-[a-z0-9]+)*$/i;

export function validateResidencyTag(tag: string): ResidencyTag {
  const trimmed = tag.trim();
  if (!TAG_RE.test(trimmed)) {
    throw new ValidationError("api.error.invalidInput", {
      safeDetails: { field: "residencyTag" },
    });
  }
  return trimmed.toLowerCase();
}

export async function setTenantResidency(
  input: { organisationId: string; residencyTag: string; actor: DataResidencyActor },
  deps: DataResidencyDeps
): Promise<{ kind: "ok"; residencyTag: ResidencyTag } | { kind: "invalid"; message: string }> {
  let tag: ResidencyTag;
  try {
    tag = validateResidencyTag(input.residencyTag);
  } catch {
    return { kind: "invalid", message: "residencyTag must be a region code" };
  }

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.OrganisationUpdated,
      resource: "organisation",
      resourceId: input.organisationId,
      metadata: { residencyTag: tag },
      sourceHost: input.actor.sourceHost,
    })
  );
  await deps.repository.setResidencyTag(input.organisationId, tag);
  return { kind: "ok", residencyTag: tag };
}

export async function assertTenantResidencyPlacement(
  input: { organisationId: string; targetRegion: string; actorId: string },
  deps: { repository: DataResidencyRepository }
): Promise<void> {
  const tag = await deps.repository.getResidencyTag(input.organisationId);
  if (!tag) return;
  if (tag.toLowerCase() !== input.targetRegion.toLowerCase()) {
    throw new ForbiddenError("api.error.residencyPlacementBlocked", {
      safeDetails: { residencyTag: tag, targetRegion: input.targetRegion },
    });
  }
}
