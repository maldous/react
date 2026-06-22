import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteTenant,
  suspendTenant,
  type TenantLifecycleCoordinator,
} from "../../src/usecases/tenant-lifecycle.ts";

function coordinator(options: { failAt?: keyof TenantLifecycleCoordinator } = {}) {
  const calls: string[] = [];
  const c: TenantLifecycleCoordinator = {
    exportTenant: async () => {
      calls.push("export");
      if (options.failAt === "exportTenant") throw new Error("export failed");
      return { digest: "digest-1", keyRef: "secret:key" };
    },
    suspendData: async () => {
      calls.push("suspend:data");
      if (options.failAt === "suspendData") throw new Error("data failed");
    },
    suspendStorage: async () => {
      calls.push("suspend:storage");
      if (options.failAt === "suspendStorage") throw new Error("storage failed");
    },
    suspendRealm: async () => {
      calls.push("suspend:realm");
      if (options.failAt === "suspendRealm") throw new Error("realm failed");
    },
    suspendDsr: async () => {
      calls.push("suspend:dsr");
      if (options.failAt === "suspendDsr") throw new Error("dsr failed");
    },
    deleteData: async () => {
      calls.push("delete:data");
      if (options.failAt === "deleteData") throw new Error("data failed");
    },
    deleteStorage: async () => {
      calls.push("delete:storage");
      if (options.failAt === "deleteStorage") throw new Error("storage failed");
    },
    deleteRealm: async () => {
      calls.push("delete:realm");
      if (options.failAt === "deleteRealm") throw new Error("realm failed");
    },
    deleteDsr: async () => {
      calls.push("delete:dsr");
      if (options.failAt === "deleteDsr") throw new Error("dsr failed");
    },
  };
  return { calls, coordinator: c };
}

const pool = { query: async () => ({ rows: [] }) } as never;
const actor = { actorId: "u1", actorRoles: ["system-admin"] };

test("tenant lifecycle suspend coordinates data, storage, realm and DSR after audit", async () => {
  const calls: string[] = [];
  const c = coordinator();
  const audit = { emit: async () => calls.push("audit") };
  const result = await suspendTenant("org-1", actor, {
    pool,
    audit,
    coordinator: c.coordinator,
  });
  assert.deepEqual(calls, ["audit"]);
  assert.deepEqual(c.calls, ["suspend:data", "suspend:storage", "suspend:realm", "suspend:dsr"]);
  assert.deepEqual(result.coordinated, ["data", "storage", "realm", "dsr"]);
});

test("tenant lifecycle delete exports first then coordinates storage, realm, DSR and data", async () => {
  const calls: string[] = [];
  const c = coordinator();
  const audit = { emit: async () => calls.push("audit") };
  const result = await deleteTenant("org-1", actor, {
    pool,
    audit,
    coordinator: c.coordinator,
  });
  assert.deepEqual(c.calls, [
    "export",
    "delete:storage",
    "delete:realm",
    "delete:dsr",
    "delete:data",
  ]);
  assert.deepEqual(result.coordinated, ["export", "storage", "realm", "dsr", "data"]);
  assert.equal(result.export.digest, "digest-1");
  assert.deepEqual(calls, ["audit"]);
});

test("tenant lifecycle delete stops when a subsystem coordination step fails", async () => {
  const c = coordinator({ failAt: "deleteRealm" });
  const audit = { emit: async () => undefined };
  await assert.rejects(
    () =>
      deleteTenant("org-1", actor, {
        pool,
        audit,
        coordinator: c.coordinator,
      }),
    /realm failed/
  );
  assert.deepEqual(c.calls, ["export", "delete:storage", "delete:realm"]);
});
