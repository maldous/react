import type { SessionActor } from "@platform/contracts-auth";

// Canonical session personas for frontend tests (ADR-0021, ADR-0022). Pure data
// — MSW handlers in ../handlers.ts turn these into /api/session responses, and
// component tests can stub useSession with them directly. Permissions mirror the
// platform permission vocabulary so permission-gated UI behaves as in production.

export type SessionPersona = "tenantAdmin" | "viewer" | "systemAdmin" | "noMembership";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ORGANISATION_ID = "00000000-0000-0000-0000-000000000001";

export const sessionFixtures: Record<SessionPersona, SessionActor> = {
  tenantAdmin: {
    userId: "00000000-0000-0000-0000-0000000000a1",
    tenantId: TENANT_ID,
    organisationId: ORGANISATION_ID,
    roles: ["tenant-admin"],
    permissions: [
      "organisation.read",
      "organisation.update",
      "member.read",
      "member.write",
      "platform.logs.read",
      // Tenant administration control plane (ADR-0036) — mirrors resolvePermissions("tenant-admin").
      "tenant.admin.access",
      "tenant.members.read",
      "tenant.members.invite",
      "tenant.members.update_role",
      "tenant.members.delete",
      "tenant.auth.settings.read",
      "tenant.auth.settings.write",
      "tenant.features.read",
      "tenant.features.update",
      "tenant.config.read",
      "tenant.config.write",
      "tenant.email.settings.read",
      "tenant.email.settings.write",
      "tenant.domains.read",
      "tenant.domains.write",
      "tenant.storage.read",
      "tenant.storage.write",
      "tenant.observability.read",
    ],
    displayName: "Tenant Admin",
  },
  viewer: {
    userId: "00000000-0000-0000-0000-0000000000a2",
    tenantId: TENANT_ID,
    organisationId: ORGANISATION_ID,
    roles: ["viewer"],
    permissions: ["organisation.read", "member.read"],
    displayName: "Viewer",
  },
  systemAdmin: {
    userId: "00000000-0000-0000-0000-0000000000a3",
    tenantId: TENANT_ID,
    organisationId: ORGANISATION_ID,
    roles: ["system-admin"],
    permissions: [
      "organisation.read",
      "organisation.update",
      "member.read",
      "member.write",
      "platform.logs.read",
      "platform.admin",
    ],
    displayName: "System Admin",
  },
  noMembership: {
    userId: "00000000-0000-0000-0000-0000000000a4",
    tenantId: TENANT_ID,
    organisationId: ORGANISATION_ID,
    roles: [],
    permissions: [],
    displayName: "No Membership",
  },
};

/** The SessionActor for a persona — convenience for component tests that stub useSession. */
export function actorFor(persona: SessionPersona): SessionActor {
  return sessionFixtures[persona];
}
