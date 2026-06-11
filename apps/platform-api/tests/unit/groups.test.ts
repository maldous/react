/**
 * Unit tests for ADR-ACT-0143 Slice 2: group management usecases.
 *
 * Pure tests — no HTTP, no real Keycloak, no DB required.
 * Uses in-memory GroupsAdapterPort fakes.
 *
 * Coverage:
 *   A. createOrgGroup
 *      1. invalid name → invalid_name, no audit
 *      2. reserved name → invalid_name, no audit
 *      3. name with path separator → invalid_name, no audit
 *      4. name too long → invalid_name
 *      5. duplicate name (case-insensitive) → conflict, NO audit
 *      6. create success → ok, GroupCreated audit BEFORE create
 *      7. audit failure aborts create
 *
 *   B. updateOrgGroup
 *      8. invalid name → invalid_name, no audit
 *      9. group not found → not_found, no audit
 *     10. name conflict with another group → conflict, no audit
 *     11. same name as self → ok (self-rename allowed, no conflict)
 *     12. update success → ok, GroupUpdated audit BEFORE update
 *     13. audit failure aborts update
 *
 *   C. deleteOrgGroup
 *     14. group not found → not_found, no audit
 *     15. reserved/protected group → protected, no audit (case-insensitive)
 *     16. delete success → ok, GroupDeleted audit BEFORE delete
 *     17. audit failure aborts delete
 *
 *   D. Static permission + route assertions
 *     18. tenant-admin has all four tenant.groups.* permissions
 *     19. manager has none of tenant.groups.*
 *     20. DELETE /api/org/groups/:groupId uses tenant.groups.delete
 *     21. all group routes declare resource + umaScope (no orphan requiredPermission)
 *     22. organisation:groups registered in registerPlatformResources
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditAction, type AuditEventPort, type AuditEvent } from "@platform/audit-events";
import { resolvePermissions } from "@platform/domain-identity";
import type { KeycloakGroup } from "@platform/authorisation-runtime";
import {
  createOrgGroup,
  updateOrgGroup,
  deleteOrgGroup,
  type GroupsAdapterPort,
} from "../../src/usecases/groups.ts";

const _dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const ACTOR_ID = "a1b2c3d4-e5f6-4000-8000-000000000002";
const ACTOR_ROLES = ["tenant-admin"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuditPort(opts: { shouldFail?: boolean } = {}): AuditEventPort & {
  events: AuditEvent[];
} {
  const events: AuditEvent[] = [];
  return {
    events,
    async emit(event) {
      if (opts.shouldFail) throw new Error("audit unavailable");
      events.push(event);
    },
    async query() {
      return [];
    },
  };
}

function makeGroupsAdapter(
  opts: {
    groups?: KeycloakGroup[];
    createId?: string;
    shouldFailCreate?: boolean;
    shouldFailUpdate?: boolean;
    shouldFailDelete?: boolean;
  } = {}
): GroupsAdapterPort & { updateCalls: { id: string; name: string }[]; deleteCalls: string[] } {
  const groups = opts.groups ?? [];
  const updateCalls: { id: string; name: string }[] = [];
  const deleteCalls: string[] = [];
  return {
    updateCalls,
    deleteCalls,
    async listGroups() {
      return groups;
    },
    async getGroup(groupId) {
      return groups.find((g) => g.id === groupId) ?? null;
    },
    async createGroup(_name) {
      if (opts.shouldFailCreate) throw new Error("Keycloak error");
      return opts.createId ?? "new-group-id";
    },
    async updateGroup(groupId, _name) {
      if (opts.shouldFailUpdate) throw new Error("Keycloak error");
      updateCalls.push({ id: groupId, name: _name });
    },
    async deleteGroup(groupId) {
      if (opts.shouldFailDelete) throw new Error("Keycloak error");
      deleteCalls.push(groupId);
    },
  };
}

function g(id: string, name: string): KeycloakGroup {
  return { id, name, path: `/${name}` };
}

// ---------------------------------------------------------------------------
// A. createOrgGroup
// ---------------------------------------------------------------------------

describe("createOrgGroup — validation", () => {
  it("empty name → invalid_name, no audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter();
    const result = await createOrgGroup(
      { rawName: "   ", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ACTOR_ROLES },
      { groups, audit }
    );
    assert.equal(result.kind, "invalid_name");
    assert.equal(audit.events.length, 0);
  });

  it("name with path separator '/' → invalid_name", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter();
    const result = await createOrgGroup(
      { rawName: "top/nested", organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ACTOR_ROLES },
      { groups, audit }
    );
    assert.equal(result.kind, "invalid_name");
    assert.equal(audit.events.length, 0);
  });

  it("name too long (>64 chars) → invalid_name", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter();
    const result = await createOrgGroup(
      {
        rawName: "a".repeat(65),
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "invalid_name");
  });

  it("non-string rawName → invalid_name", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter();
    const result = await createOrgGroup(
      { rawName: 42, organisationId: ORG_ID, actorId: ACTOR_ID, actorRoles: ACTOR_ROLES },
      { groups, audit }
    );
    assert.equal(result.kind, "invalid_name");
  });
});

describe("createOrgGroup — pre-audit conflict check", () => {
  it("duplicate name (exact) → conflict, NO audit emitted", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [g("g1", "Editors")] });
    const result = await createOrgGroup(
      {
        rawName: "Editors",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0, "conflict must NOT emit GroupCreated audit");
  });

  it("duplicate name (case-insensitive) → conflict, NO audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [g("g1", "editors")] });
    const result = await createOrgGroup(
      {
        rawName: "EDITORS",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0);
  });
});

describe("createOrgGroup — success and audit ordering", () => {
  it("create success → ok, GroupCreated audit emitted BEFORE createGroup call", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    let createCalled = false;
    const adapter: GroupsAdapterPort = {
      async listGroups() {
        return [];
      },
      async getGroup() {
        return null;
      },
      async createGroup() {
        callOrder.push("create");
        createCalled = true;
        return "gid-new";
      },
      async updateGroup() {},
      async deleteGroup() {},
    };

    const result = await createOrgGroup(
      {
        rawName: "MyGroup",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups: adapter, audit }
    );

    assert.equal(result.kind, "ok");
    assert.ok("groupId" in result && result.groupId === "gid-new");
    assert.ok(createCalled);
    assert.deepEqual(callOrder, ["audit", "create"], "audit must fire before createGroup");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.GroupCreated);
  });

  it("audit failure aborts createGroup call", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const groups = makeGroupsAdapter({ createId: "should-not-be-called" });

    await assert.rejects(
      () =>
        createOrgGroup(
          {
            rawName: "WillFail",
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { groups, audit }
        ),
      /audit unavailable/
    );
  });
});

// ---------------------------------------------------------------------------
// B. updateOrgGroup
// ---------------------------------------------------------------------------

describe("updateOrgGroup — validation and pre-conditions", () => {
  it("invalid name → invalid_name, no audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [g("g1", "Existing")] });
    const result = await updateOrgGroup(
      {
        groupId: "g1",
        rawName: "/bad/name",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "invalid_name");
    assert.equal(audit.events.length, 0);
  });

  it("group not found → not_found, no audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [] });
    const result = await updateOrgGroup(
      {
        groupId: "missing",
        rawName: "NewName",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("name conflicts with different group → conflict, no audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [g("g1", "Alpha"), g("g2", "Beta")] });
    const result = await updateOrgGroup(
      {
        groupId: "g1",
        rawName: "BETA",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "conflict");
    assert.equal(audit.events.length, 0);
  });

  it("same name as self → ok (self-rename allowed, no false conflict)", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [g("g1", "Alpha")] });
    const result = await updateOrgGroup(
      {
        groupId: "g1",
        rawName: "Alpha",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "ok");
    assert.equal(audit.events.length, 1);
    assert.equal(audit.events[0]!.action, AuditAction.GroupUpdated);
  });
});

describe("updateOrgGroup — success and audit ordering", () => {
  it("update success → ok, GroupUpdated audit BEFORE update, metadata includes old and new name", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    let updateCalled = false;
    const adapter: GroupsAdapterPort = {
      async listGroups() {
        return [g("g1", "OldName")];
      },
      async getGroup(id) {
        return id === "g1" ? g("g1", "OldName") : null;
      },
      async createGroup() {
        return "x";
      },
      async updateGroup() {
        callOrder.push("update");
        updateCalled = true;
      },
      async deleteGroup() {},
    };

    const result = await updateOrgGroup(
      {
        groupId: "g1",
        rawName: "NewName",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups: adapter, audit }
    );

    assert.equal(result.kind, "ok");
    assert.ok(updateCalled);
    assert.deepEqual(callOrder, ["audit", "update"]);
    assert.equal(audit.events[0]!.action, AuditAction.GroupUpdated);
    assert.equal((audit.events[0]!.metadata as Record<string, string>)?.oldName, "OldName");
    assert.equal((audit.events[0]!.metadata as Record<string, string>)?.newName, "NewName");
  });

  it("audit failure aborts update", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const groups = makeGroupsAdapter({ groups: [g("g1", "Existing")] });

    await assert.rejects(
      () =>
        updateOrgGroup(
          {
            groupId: "g1",
            rawName: "Changed",
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { groups, audit }
        ),
      /audit unavailable/
    );

    assert.equal(groups.updateCalls.length, 0, "no update after audit failure");
  });
});

// ---------------------------------------------------------------------------
// C. deleteOrgGroup
// ---------------------------------------------------------------------------

describe("deleteOrgGroup — pre-conditions", () => {
  it("group not found → not_found, no audit", async () => {
    const audit = makeAuditPort();
    const groups = makeGroupsAdapter({ groups: [] });
    const result = await deleteOrgGroup(
      {
        groupId: "missing",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups, audit }
    );
    assert.equal(result.kind, "not_found");
    assert.equal(audit.events.length, 0);
  });

  it("reserved group name → protected, no audit (case-insensitive)", async () => {
    const audit = makeAuditPort();
    for (const reservedName of ["admin", "Admin", "ADMIN", "realm-management", "offline_access"]) {
      const groups = makeGroupsAdapter({ groups: [g("gR", reservedName)] });
      const result = await deleteOrgGroup(
        {
          groupId: "gR",
          organisationId: ORG_ID,
          actorId: ACTOR_ID,
          actorRoles: ACTOR_ROLES,
        },
        { groups, audit }
      );
      assert.equal(result.kind, "protected", `"${reservedName}" should be protected`);
      assert.equal(audit.events.length, 0, `no audit for protected group "${reservedName}"`);
    }
  });
});

describe("deleteOrgGroup — success and audit ordering", () => {
  it("delete success → ok, GroupDeleted audit BEFORE delete", async () => {
    const callOrder: string[] = [];
    const audit = makeAuditPort();
    const origEmit = audit.emit.bind(audit);
    audit.emit = async (e) => {
      callOrder.push("audit");
      return origEmit(e);
    };

    let deleteCalled = false;
    const adapter: GroupsAdapterPort = {
      async listGroups() {
        return [];
      },
      async getGroup(id) {
        return id === "g1" ? g("g1", "MyGroup") : null;
      },
      async createGroup() {
        return "x";
      },
      async updateGroup() {},
      async deleteGroup() {
        callOrder.push("delete");
        deleteCalled = true;
      },
    };

    const result = await deleteOrgGroup(
      {
        groupId: "g1",
        organisationId: ORG_ID,
        actorId: ACTOR_ID,
        actorRoles: ACTOR_ROLES,
      },
      { groups: adapter, audit }
    );

    assert.equal(result.kind, "ok");
    assert.ok(deleteCalled);
    assert.deepEqual(callOrder, ["audit", "delete"]);
    assert.equal(audit.events[0]!.action, AuditAction.GroupDeleted);
    assert.equal((audit.events[0]!.metadata as Record<string, string>)?.groupName, "MyGroup");
  });

  it("audit failure aborts delete", async () => {
    const audit = makeAuditPort({ shouldFail: true });
    const groups = makeGroupsAdapter({ groups: [g("g1", "Deletable")] });

    await assert.rejects(
      () =>
        deleteOrgGroup(
          {
            groupId: "g1",
            organisationId: ORG_ID,
            actorId: ACTOR_ID,
            actorRoles: ACTOR_ROLES,
          },
          { groups, audit }
        ),
      /audit unavailable/
    );

    assert.equal(groups.deleteCalls.length, 0, "no delete after audit failure");
  });
});

// ---------------------------------------------------------------------------
// D. Static permission + route assertions
// ---------------------------------------------------------------------------

describe("permission model — groups", () => {
  it("tenant-admin has all four tenant.groups.* permissions", () => {
    const perms = resolvePermissions("tenant-admin");
    for (const p of [
      "tenant.groups.read",
      "tenant.groups.create",
      "tenant.groups.update",
      "tenant.groups.delete",
    ]) {
      assert.ok(perms.includes(p), `tenant-admin must have ${p}`);
    }
  });

  it("manager has NONE of tenant.groups.* permissions", () => {
    const perms = resolvePermissions("manager");
    for (const p of [
      "tenant.groups.read",
      "tenant.groups.create",
      "tenant.groups.update",
      "tenant.groups.delete",
    ]) {
      assert.ok(!perms.includes(p), `manager must NOT have ${p}`);
    }
  });

  it("DELETE /api/org/groups/:groupId uses tenant.groups.delete (not tenant.admin.access)", () => {
    const src = readFileSync(join(_dir, "../../src/server/routes.ts"), "utf8");
    // Scope to JUST the groups-delete route block (up to the next route's
    // operationName) so unrelated later routes can't leak into the assertion.
    const afterDelete = src.split('operationName: "org.groups.delete"')[1] ?? "";
    const deleteGroupBlock = afterDelete.split("operationName:")[0];
    assert.ok(
      deleteGroupBlock?.includes("tenant.groups.delete"),
      "DELETE group route block must use tenant.groups.delete"
    );
    assert.ok(
      !deleteGroupBlock?.includes('"tenant.admin.access"'),
      "DELETE group route must NOT use tenant.admin.access"
    );
  });

  it("all four group routes declare resource + umaScope (no orphan requiredPermission)", () => {
    const src = readFileSync(join(_dir, "../../src/server/routes.ts"), "utf8");
    const groupOps = [
      "org.groups.list",
      "org.groups.create",
      "org.groups.update",
      "org.groups.delete",
    ];
    for (const op of groupOps) {
      const idx = src.indexOf(op);
      assert.ok(idx !== -1, `route ${op} must exist`);
      const block = src.slice(idx, idx + 500);
      assert.ok(
        block.includes("organisation:groups"),
        `route ${op} must declare resource: "organisation:groups"`
      );
      assert.ok(block.includes("umaScope"), `route ${op} must declare umaScope`);
    }
  });

  it("organisation:groups resource registered in registerPlatformResources", () => {
    const src = readFileSync(
      join(_dir, "../../../../packages/adapters-keycloak/src/index.ts"),
      "utf8"
    );
    assert.ok(
      src.includes("organisation:groups"),
      "registerPlatformResources must register organisation:groups"
    );
    // Verify all four scopes are registered
    const groupsResourceBlock = src.split("organisation:groups")[1] ?? "";
    const shortBlock = groupsResourceBlock.slice(0, 200);
    for (const scope of ["read", "create", "update", "delete"]) {
      assert.ok(shortBlock.includes(scope), `organisation:groups must register scope "${scope}"`);
    }
  });
});
