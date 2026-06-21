import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find((r) => r.method === "GET" && r.path === "/api/admin/backup");
  assert.ok(route, "backup control route is registered");
  assert.equal(route?.operationName, "admin.backup.get");
  console.log(JSON.stringify({ capability: "V2 backup control", result: "PASSED" }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
