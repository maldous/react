import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const required = [
    "/api/admin/billing/catalog/products",
    "/api/admin/billing/catalog/plans",
    "/api/admin/billing/catalog/prices",
    "/api/org/billing/catalog",
  ];
  for (const path of required) {
    const route = routes.find((r) => r.path === path);
    assert.ok(route, `billing catalog route is registered: ${path}`);
    assert.equal(route.path, path, `billing catalog route lookup returns exact path: ${path}`);
  }
  console.log(
    JSON.stringify(
      { capability: "V1 billing catalog", result: "PASSED", routes: required },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
