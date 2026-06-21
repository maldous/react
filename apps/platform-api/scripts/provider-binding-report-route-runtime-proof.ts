import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find((r) => r.method === "GET" && r.path === "/api/admin/provider-bindings");
  assert.ok(route, "provider binding report route is registered");
  assert.equal(route?.operationName, "admin.providerBindings.get");
  console.log(
    JSON.stringify(
      { capability: "V2 provider binding report", result: "PASSED", path: route?.path },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
