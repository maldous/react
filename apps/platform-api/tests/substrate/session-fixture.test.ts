import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFixtureSessionActor, getFixtureSession } from "../../src/server/session.ts";

describe("fixture session", () => {
  it("createFixtureSessionActor returns tenant-admin actor", () => {
    const actor = createFixtureSessionActor("tenant-admin");
    assert.ok(actor.roles.includes("tenant-admin"));
    assert.ok(actor.permissions.includes("organisation.update"));
    assert.ok(actor.permissions.includes("admin.access"));
    assert.ok(actor.userId);
    assert.ok(actor.tenantId);
  });

  it("createFixtureSessionActor returns viewer actor with limited permissions", () => {
    const actor = createFixtureSessionActor("viewer");
    assert.ok(actor.roles.includes("viewer"));
    assert.ok(actor.permissions.includes("organisation.read"));
    assert.ok(!actor.permissions.includes("organisation.update"));
    assert.ok(!actor.permissions.includes("admin.access"));
  });

  it("getFixtureSession returns null when LOCAL_FIXTURE_SESSION is unauthenticated", () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "unauthenticated";
    assert.equal(getFixtureSession(), null);
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });

  it("getFixtureSession returns actor when LOCAL_FIXTURE_SESSION is tenant-admin", () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    const actor = getFixtureSession();
    assert.notEqual(actor, null);
    assert.ok(actor?.roles.includes("tenant-admin"));
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });

  it("getFixtureSession returns null when env var is not set", () => {
    delete process.env["LOCAL_FIXTURE_SESSION"];
    assert.equal(getFixtureSession(), null);
  });

  it("getFixtureSession returns actor with empty permissions when role is no-permissions", () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "no-permissions";
    const actor = getFixtureSession();
    assert.notEqual(actor, null);
    assert.ok(
      actor?.permissions.length === 0,
      "no-permissions actor should have empty permissions"
    );
    assert.ok(actor?.roles.length === 0, "no-permissions actor should have empty roles");
    assert.ok(actor?.userId, "no-permissions actor should have a userId");
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });
});
