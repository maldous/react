import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAuditEvent, createInMemoryAuditEventPort, AuditAction } from "../src/index.ts";

describe("createAuditEvent", () => {
  it("creates an event with required fields", () => {
    const event = createAuditEvent({
      actorId: "user-1",
      tenantId: "tenant-1",
      action: AuditAction.OrganisationUpdated,
      resource: "organisation",
      resourceId: "org-1",
    });
    assert.ok(typeof event.id === "string" && event.id.length > 0);
    assert.ok(typeof event.timestamp === "string");
    assert.strictEqual(event.actorId, "user-1");
    assert.strictEqual(event.action, AuditAction.OrganisationUpdated);
  });
});

describe("createInMemoryAuditEventPort", () => {
  it("emit and query round-trip", async () => {
    const port = createInMemoryAuditEventPort();
    const event = createAuditEvent({
      actorId: "user-1",
      tenantId: "tenant-1",
      action: AuditAction.UserLoggedIn,
      resource: "session",
      resourceId: "session-1",
    });
    await port.emit(event);
    const results = await port.query({ tenantId: "tenant-1" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]!.actorId, "user-1");
  });

  it("filters by actorId", async () => {
    const port = createInMemoryAuditEventPort();
    await port.emit(
      createAuditEvent({
        actorId: "user-1",
        tenantId: "t1",
        action: AuditAction.UserLoggedIn,
        resource: "session",
        resourceId: "s1",
      })
    );
    await port.emit(
      createAuditEvent({
        actorId: "user-2",
        tenantId: "t1",
        action: AuditAction.UserLoggedIn,
        resource: "session",
        resourceId: "s2",
      })
    );
    const results = await port.query({ tenantId: "t1", actorId: "user-1" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]!.actorId, "user-1");
  });

  it("filters by action", async () => {
    const port = createInMemoryAuditEventPort();
    await port.emit(
      createAuditEvent({
        actorId: "u1",
        tenantId: "t1",
        action: AuditAction.UserLoggedIn,
        resource: "session",
        resourceId: "s1",
      })
    );
    await port.emit(
      createAuditEvent({
        actorId: "u1",
        tenantId: "t1",
        action: AuditAction.OrganisationUpdated,
        resource: "org",
        resourceId: "o1",
      })
    );
    const results = await port.query({ tenantId: "t1", action: AuditAction.UserLoggedIn });
    assert.strictEqual(results.length, 1);
  });

  it("returns empty for unmatched tenant", async () => {
    const port = createInMemoryAuditEventPort();
    await port.emit(
      createAuditEvent({
        actorId: "u1",
        tenantId: "t1",
        action: AuditAction.UserLoggedIn,
        resource: "s",
        resourceId: "s1",
      })
    );
    const results = await port.query({ tenantId: "other-tenant" });
    assert.strictEqual(results.length, 0);
  });
});
