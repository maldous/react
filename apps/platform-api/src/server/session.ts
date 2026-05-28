import { type SessionActor } from "@platform/contracts-auth";
import { FIXTURE } from "../db/seed.ts";

export type FixtureRole = "tenant-admin" | "viewer" | "no-permissions" | "unauthenticated";

const ROLE_PERMISSIONS: Record<"tenant-admin" | "viewer", string[]> = {
  "tenant-admin": [
    "organisation.read",
    "organisation.update",
    "member.read",
    "member.invite",
    "member.update_role",
    "profile.read_self",
    "profile.update_self",
    "admin.access",
    "audit.read",
  ],
  viewer: ["organisation.read", "member.read", "profile.read_self", "profile.update_self"],
};

export function createFixtureSessionActor(role: "tenant-admin" | "viewer"): SessionActor {
  const userId = role === "tenant-admin" ? FIXTURE.ADMIN_ID : FIXTURE.VIEWER_ID;
  return {
    userId,
    tenantId: FIXTURE.ORG_ID,
    organisationId: FIXTURE.ORG_ID,
    roles: [role],
    permissions: ROLE_PERMISSIONS[role],
    displayName: role === "tenant-admin" ? "Fixture Admin" : "Fixture Viewer",
  };
}

/** Get the fixture session actor for the LOCAL_FIXTURE_SESSION env var role. */
export function getFixtureSession(): SessionActor | null {
  const role = process.env["LOCAL_FIXTURE_SESSION"] as FixtureRole | undefined;
  if (!role || role === "unauthenticated") return null;
  if (role === "no-permissions") {
    return {
      userId: FIXTURE.FORBIDDEN_ID,
      tenantId: FIXTURE.ORG_ID,
      organisationId: FIXTURE.ORG_ID,
      roles: [],
      permissions: [],
      displayName: "Forbidden Fixture",
    };
  }
  if (role !== "tenant-admin" && role !== "viewer") return null;
  return createFixtureSessionActor(role);
}
