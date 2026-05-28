import { type SessionActor } from "@platform/contracts-auth";
import { resolvePermissions } from "@platform/domain-identity";
import { FIXTURE } from "../db/seed.ts";

export type FixtureRole = "tenant-admin" | "viewer" | "no-membership" | "unauthenticated";

export function createFixtureSessionActor(role: "tenant-admin" | "viewer"): SessionActor {
  const userId = role === "tenant-admin" ? FIXTURE.ADMIN_ID : FIXTURE.VIEWER_ID;
  return {
    userId,
    tenantId: FIXTURE.ORG_ID,
    organisationId: FIXTURE.ORG_ID,
    roles: [role],
    permissions: resolvePermissions(role),
    displayName: role === "tenant-admin" ? "Fixture Admin" : "Fixture Viewer",
  };
}

/** Get the fixture session actor for the LOCAL_FIXTURE_SESSION env var role. */
export function getFixtureSession(): SessionActor | null {
  const role = process.env["LOCAL_FIXTURE_SESSION"] as FixtureRole | undefined;
  if (!role || role === "unauthenticated") return null;
  if (role === "no-membership") {
    // Test-only fixture — not production identity semantics.
    // Represents an authenticated user with no active organisation membership.
    // SessionActorSchema requires non-null strings; empty strings signal the
    // absence of membership context without violating the schema contract.
    // The pipeline rejects with 403 (permission check) before the handler or
    // RuntimeContext ever reads tenantId/organisationId, so the empty strings
    // never propagate to business logic.
    return {
      userId: FIXTURE.FORBIDDEN_ID,
      tenantId: "",
      organisationId: "",
      roles: [],
      permissions: [],
      displayName: "No Membership Fixture",
    };
  }
  if (role !== "tenant-admin" && role !== "viewer") return null;
  return createFixtureSessionActor(role);
}
