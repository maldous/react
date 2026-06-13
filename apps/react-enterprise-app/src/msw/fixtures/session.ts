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
      "tenant.webhooks.read",
      "tenant.webhooks.write",
      "tenant.platform.read",
      "tenant.entitlements.read",
      "tenant.metering.read",
      // Developer platform (Phase 3, ADR-ACT-0257).
      "tenant.api_keys.read",
      "tenant.api_keys.write",
      "tenant.developer.read",
      // Search (Phase 4, ADR-ACT-0258).
      "tenant.search.read",
      // Profile + notification preferences self-service (Phase 6, ADR-ACT-0260).
      "profile.read_self",
      "profile.update_self",
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
      // Platform operations cockpit (ADR-ACT-0235) — mirrors resolvePermissions("system-admin").
      "tenant.platform.read",
      // Entitlements (Phase 1, ADR-ACT-0254): operator assigns; read alias for nav.
      "platform.entitlements.read",
      "platform.entitlements.write",
      "tenant.entitlements.read",
      // Metering + quota (Phase 2, ADR-ACT-0256).
      "platform.metering.read",
      "platform.metering.write",
      "platform.quotas.read",
      "platform.quotas.write",
      "tenant.metering.read",
      // Developer platform (Phase 3, ADR-ACT-0257): operator reads keys + sets rate limits.
      "platform.api_keys.read",
      "platform.rate_limits.read",
      "platform.rate_limits.write",
      "tenant.api_keys.read",
      "tenant.developer.read",
      // Search (Phase 4, ADR-ACT-0258): operator readiness + reindex.
      "platform.search.read",
      "platform.search.write",
      "tenant.search.read",
      // Event bus + workers (Phase 5, ADR-ACT-0259): operator-only.
      "platform.events.read",
      "platform.events.write",
      "platform.workers.read",
      // Notifications + profile self-service (Phase 6, ADR-ACT-0260).
      "platform.notifications.read",
      "platform.notifications.write",
      "profile.read_self",
      "profile.update_self",
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
