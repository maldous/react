// ---------------------------------------------------------------------------
// Profile self-service usecase (ADR-0068 / ADR-ACT-0260)
//
// A user reads/updates ONLY their own profile. The userId is always the authenticated
// session subject, passed by the route — never a path/body param — so cross-user edits
// are structurally impossible. Updates are audited (audit-before-change). Tenant +
// user scoped (RLS). No secrets.
// ---------------------------------------------------------------------------

import { ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { UserProfile } from "@platform/contracts-admin";
import type { ProfileRepository } from "../ports/profile-repository.ts";

export interface ProfileDeps {
  profiles: ProfileRepository;
  audit: AuditEventPort;
}

export interface ProfileActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string | undefined;
}

const DEFAULT_PROFILE: UserProfile = { displayName: "", locale: "en-GB", timezone: "UTC" };

/** The calling user's own profile (defaults when none saved yet). */
export async function getMyProfile(
  organisationId: string,
  userId: string,
  deps: ProfileDeps
): Promise<UserProfile> {
  const record = await deps.profiles.getForUser(organisationId, userId);
  return record ?? DEFAULT_PROFILE;
}

/** Update the calling user's own profile (audited). */
export async function updateMyProfile(
  input: {
    organisationId: string;
    userId: string;
    displayName: string;
    locale: string;
    timezone: string;
    actor: ProfileActor;
  },
  deps: ProfileDeps
): Promise<UserProfile> {
  if (input.displayName.trim().length === 0) {
    throw new ValidationError("api.error.displayNameRequired", {});
  }
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.ProfileUpdated,
      resource: "user_profile",
      resourceId: input.userId,
      // Non-secret metadata only.
      metadata: { locale: input.locale, timezone: input.timezone },
      sourceHost: input.actor.sourceHost,
    })
  );
  return deps.profiles.upsertForUser({
    organisationId: input.organisationId,
    userId: input.userId,
    displayName: input.displayName.trim(),
    locale: input.locale,
    timezone: input.timezone,
  });
}
