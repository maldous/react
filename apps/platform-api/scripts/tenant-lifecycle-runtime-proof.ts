import { strict as assert } from "node:assert";
import {
  deleteTenant,
  suspendTenant,
  type TenantLifecycleCoordinator,
} from "../src/usecases/tenant-lifecycle.ts";

function coordinator() {
  const calls: string[] = [];
  const c: TenantLifecycleCoordinator = {
    exportTenant: async () => {
      calls.push("export");
      return { digest: "digest-1", keyRef: "secret:key" };
    },
    suspendData: async () => void calls.push("suspend:data"),
    suspendStorage: async () => void calls.push("suspend:storage"),
    suspendRealm: async () => void calls.push("suspend:realm"),
    suspendDsr: async () => void calls.push("suspend:dsr"),
    deleteData: async () => void calls.push("delete:data"),
    deleteStorage: async () => void calls.push("delete:storage"),
    deleteRealm: async () => void calls.push("delete:realm"),
    deleteDsr: async () => void calls.push("delete:dsr"),
  };
  return { calls, coordinator: c };
}

async function main(): Promise<void> {
  const pool = { query: async () => ({ rows: [] }) } as never;
  const auditCalls: string[] = [];
  const audit = { emit: async () => void auditCalls.push("audit") };
  const actor = { actorId: "proof", actorRoles: ["system-admin"] };

  const suspend = coordinator();
  const suspended = await suspendTenant("org-proof", actor, {
    pool,
    audit,
    coordinator: suspend.coordinator,
  });
  assert.deepEqual(suspend.calls, [
    "suspend:data",
    "suspend:storage",
    "suspend:realm",
    "suspend:dsr",
  ]);
  assert.deepEqual(suspended.coordinated, ["data", "storage", "realm", "dsr"]);

  const del = coordinator();
  const deleted = await deleteTenant("org-proof", actor, {
    pool,
    audit,
    coordinator: del.coordinator,
  });
  assert.deepEqual(del.calls, [
    "export",
    "delete:storage",
    "delete:realm",
    "delete:dsr",
    "delete:data",
  ]);
  assert.deepEqual(deleted.coordinated, ["export", "storage", "realm", "dsr", "data"]);
  assert.ok(
    deleted.coordinated.includes("export") && deleted.coordinated.includes("data"),
    "delete lifecycle state includes export before destructive data side effects"
  );
  assert.equal(deleted.export.digest, "digest-1");
  assert.equal(auditCalls.length, 2);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-21",
        result: "PASSED",
        semantics: [
          "suspend audits and coordinates data/storage/realm/DSR",
          "delete exports first",
          "delete coordinates storage/realm/DSR/data",
          "subsystem coordination is explicit in TenantLifecycleCoordinator",
        ],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
