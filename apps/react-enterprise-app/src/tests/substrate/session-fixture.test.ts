import { describe, it, expect } from "vitest";
import { createFixtureSessionActor, getFixtureSession } from "../../server/session";

describe("fixture session", () => {
  it("createFixtureSessionActor returns tenant-admin actor", () => {
    const actor = createFixtureSessionActor("tenant-admin");
    expect(actor.roles).toContain("tenant-admin");
    expect(actor.permissions).toContain("organisation.update");
    expect(actor.permissions).toContain("admin.access");
    expect(actor.userId).toBeTruthy();
    expect(actor.tenantId).toBeTruthy();
  });

  it("createFixtureSessionActor returns viewer actor with limited permissions", () => {
    const actor = createFixtureSessionActor("viewer");
    expect(actor.roles).toContain("viewer");
    expect(actor.permissions).toContain("organisation.read");
    expect(actor.permissions).not.toContain("organisation.update");
    expect(actor.permissions).not.toContain("admin.access");
  });

  it("getFixtureSession returns null when LOCAL_FIXTURE_SESSION is unauthenticated", () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "unauthenticated";
    expect(getFixtureSession()).toBeNull();
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });

  it("getFixtureSession returns actor when LOCAL_FIXTURE_SESSION is tenant-admin", () => {
    process.env["LOCAL_FIXTURE_SESSION"] = "tenant-admin";
    const actor = getFixtureSession();
    expect(actor).not.toBeNull();
    expect(actor?.roles).toContain("tenant-admin");
    delete process.env["LOCAL_FIXTURE_SESSION"];
  });

  it("getFixtureSession returns null when env var is not set", () => {
    delete process.env["LOCAL_FIXTURE_SESSION"];
    expect(getFixtureSession()).toBeNull();
  });
});
