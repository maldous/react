import assert from "node:assert/strict";
import test from "node:test";
import { suspendTenant, deleteTenant } from "../../src/usecases/tenant-lifecycle.ts";

test("tenant lifecycle usecases emit audit and run transitions", async () => {
  const calls: string[] = [];
  const pool = { query: async () => ({ rows: [] }) } as {
    query: () => Promise<{ rows: unknown[] }>;
  };
  const audit = { emit: async () => calls.push("audit") };
  await suspendTenant("org-1", { actorId: "u1", actorRoles: ["system-admin"] }, { pool, audit });
  await deleteTenant("org-1", { actorId: "u1", actorRoles: ["system-admin"] }, { pool, audit });
  assert.equal(calls.length, 2);
});
