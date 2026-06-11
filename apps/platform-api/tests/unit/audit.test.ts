/**
 * Unit tests for the contextual audit query usecase (ADR-0040): logical→stored resource
 * mapping, per-context permission, tenant isolation, resourceId filter, metadata redaction.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryAuditEventPort, createAuditEvent } from "@platform/audit-events";
import { listContextualAuditEvents } from "../../src/usecases/audit.ts";

const ORG_A = "a1b2c3d4-e5f6-4000-8000-00000000000a";
const ORG_B = "a1b2c3d4-e5f6-4000-8000-00000000000b";
const ALL_PERMS = [
  "tenant.members.read",
  "tenant.config.read",
  "tenant.features.read",
  "tenant.auth.settings.read",
];

const audit = createInMemoryAuditEventPort();

before(async () => {
  await audit.emit(
    createAuditEvent({
      actorId: "admin-a",
      actorRoles: ["tenant-admin"],
      tenantId: ORG_A,
      action: "member.status_changed",
      resource: "organisation:members",
      resourceId: "user-1",
      metadata: { status: "disabled" },
    })
  );
  await audit.emit(
    createAuditEvent({
      actorId: "admin-a",
      actorRoles: ["tenant-admin"],
      tenantId: ORG_A,
      action: "config.value_changed",
      resource: "organisation:config",
      resourceId: "branding.app_name",
      metadata: { key: "branding.app_name", value: "Acme", client_secret: "should-not-leak" },
    })
  );
  await audit.emit(
    createAuditEvent({
      actorId: "admin-b",
      actorRoles: ["tenant-admin"],
      tenantId: ORG_B,
      action: "member.status_changed",
      resource: "organisation:members",
      resourceId: "user-9",
      metadata: {},
    })
  );
});

describe("listContextualAuditEvents", () => {
  it("rejects an unknown logical resource", async () => {
    const r = await listContextualAuditEvents(
      { organisationId: ORG_A, actorPermissions: ALL_PERMS, resource: "bogus" },
      { audit }
    );
    assert.equal(r.kind, "invalid");
  });

  it("forbids a context the actor lacks read permission for", async () => {
    const r = await listContextualAuditEvents(
      { organisationId: ORG_A, actorPermissions: ["tenant.members.read"], resource: "config" },
      { audit }
    );
    assert.equal(r.kind, "forbidden");
  });

  it("returns member events for the tenant only (no cross-tenant leakage)", async () => {
    const r = await listContextualAuditEvents(
      { organisationId: ORG_A, actorPermissions: ALL_PERMS, resource: "member" },
      { audit }
    );
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.ok(r.events.length >= 1);
    assert.ok(r.events.every((e) => e.resource === "organisation:members"));
    assert.ok(
      r.events.every((e) => e.resourceId !== "user-9"),
      "must not include ORG_B events"
    );
  });

  it("filters by resourceId", async () => {
    const r = await listContextualAuditEvents(
      {
        organisationId: ORG_A,
        actorPermissions: ALL_PERMS,
        resource: "member",
        resourceId: "user-1",
      },
      { audit }
    );
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.ok(r.events.length >= 1);
    assert.ok(r.events.every((e) => e.resourceId === "user-1"));
  });

  it("redacts secret-ish metadata keys", async () => {
    const r = await listContextualAuditEvents(
      { organisationId: ORG_A, actorPermissions: ALL_PERMS, resource: "config" },
      { audit }
    );
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    const ev = r.events.find((e) => e.resourceId === "branding.app_name");
    assert.equal(ev?.metadata?.["client_secret"], "[redacted]");
    assert.equal(ev?.metadata?.["value"], "Acme");
  });
});
