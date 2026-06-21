import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find((r) => r.method === "GET" && r.path === "/api/admin/billing");
  assert.ok(route, "billing control route is registered");
  assert.equal(route?.operationName, "admin.billing.get");
  assert.ok(
    routes.some((r) => r.path === "/api/admin/billing/catalog/products"),
    "billing catalog products route is registered"
  );
  assert.ok(
    routes.some((r) => r.path === "/api/org/billing/catalog"),
    "tenant billing catalog read route is registered"
  );
  console.log(
    JSON.stringify(
      { capability: "V2 billing control", result: "PASSED", path: route?.path },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
