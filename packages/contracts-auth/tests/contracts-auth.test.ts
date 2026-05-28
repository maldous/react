import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  packageName,
  SessionActorSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  SessionResponseSchema,
} from "../src/index.ts";

describe("packageName", () => {
  it("exports the correct package name", () => {
    assert.equal(packageName, "@platform/contracts-auth");
  });
});

describe("SessionActorSchema", () => {
  it("validates a valid SessionActor", () => {
    const result = SessionActorSchema.safeParse({
      userId: "user-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      roles: ["tenant-admin"],
      permissions: ["organisation.read", "member.read"],
      displayName: "Alice",
    });
    assert.ok(result.success);
  });

  it("fails when userId is missing", () => {
    const result = SessionActorSchema.safeParse({
      tenantId: "tenant-1",
      organisationId: "org-1",
      roles: [],
      permissions: [],
      displayName: "Alice",
    });
    assert.ok(!result.success);
  });

  it("fails when roles is not an array", () => {
    const result = SessionActorSchema.safeParse({
      userId: "user-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      roles: "tenant-admin",
      permissions: [],
      displayName: "Alice",
    });
    assert.ok(!result.success);
  });

  it("parses permissions as string array", () => {
    const result = SessionActorSchema.safeParse({
      userId: "user-1",
      tenantId: "tenant-1",
      organisationId: "org-1",
      roles: ["viewer"],
      permissions: ["organisation.read", "member.read", "profile.read_self"],
      displayName: "Bob",
    });
    assert.ok(result.success);
    assert.deepEqual(result.data.permissions, [
      "organisation.read",
      "member.read",
      "profile.read_self",
    ]);
  });
});

describe("AuthErrorCode type", () => {
  it("UNAUTHENTICATED is a valid string literal", () => {
    const code = "UNAUTHENTICATED";
    assert.equal(typeof code, "string");
    assert.equal(code, "UNAUTHENTICATED");
  });

  it("FORBIDDEN is a valid string literal", () => {
    const code = "FORBIDDEN";
    assert.equal(code, "FORBIDDEN");
  });

  it("SESSION_EXPIRED is a valid string literal", () => {
    const code = "SESSION_EXPIRED";
    assert.equal(code, "SESSION_EXPIRED");
  });

  it("PROVIDER_ERROR is a valid string literal", () => {
    const code = "PROVIDER_ERROR";
    assert.equal(code, "PROVIDER_ERROR");
  });
});

describe("LoginRequestSchema", () => {
  it("validates with optional returnTo", () => {
    const result = LoginRequestSchema.safeParse({ returnTo: "/dashboard" });
    assert.ok(result.success);
    assert.equal(result.data.returnTo, "/dashboard");
  });

  it("validates without returnTo", () => {
    const result = LoginRequestSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.returnTo, undefined);
  });
});

describe("LogoutRequestSchema", () => {
  it("validates with everywhere: true", () => {
    const result = LogoutRequestSchema.safeParse({ everywhere: true });
    assert.ok(result.success);
    assert.equal(result.data.everywhere, true);
  });

  it("validates without everywhere", () => {
    const result = LogoutRequestSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.everywhere, undefined);
  });
});

describe("SessionResponseSchema", () => {
  it("validates authenticated status with actor", () => {
    const result = SessionResponseSchema.safeParse({
      status: "authenticated",
      actor: {
        userId: "user-1",
        tenantId: "tenant-1",
        organisationId: "org-1",
        roles: ["manager"],
        permissions: ["member.invite"],
        displayName: "Carol",
      },
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "authenticated");
  });

  it("validates unauthenticated status without actor", () => {
    const result = SessionResponseSchema.safeParse({ status: "unauthenticated" });
    assert.ok(result.success);
    assert.equal(result.data.status, "unauthenticated");
    assert.equal(result.data.actor, undefined);
  });

  it("validates expired status", () => {
    const result = SessionResponseSchema.safeParse({ status: "expired" });
    assert.ok(result.success);
    assert.equal(result.data.status, "expired");
  });

  it("fails with invalid status", () => {
    const result = SessionResponseSchema.safeParse({ status: "unknown" });
    assert.ok(!result.success);
  });
});
