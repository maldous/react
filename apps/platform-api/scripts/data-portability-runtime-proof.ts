import { strict as assert } from "node:assert";
import { buildPortableTenantExport } from "../src/usecases/data-portability.ts";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  assert.ok(
    routes.some((r) => r.path === "/api/admin/tenants/:tenantId/export"),
    "tenant export route registered"
  );
  const out = buildPortableTenantExport({
    tenantId: "tenant-1",
    sourceCommit: "deadbeef",
    entries: [{ path: "manifest.json", content: { ok: true }, order: 1 }],
  });
  assert.ok(out.archive.length > 0);
  console.log(
    JSON.stringify({ capability: "V1C-14", result: "PASSED", bytes: out.archive.length }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
