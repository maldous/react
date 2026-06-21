import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find((r) => r.method === "GET" && r.path === "/api/admin/workflows");
  assert.ok(route, "combined workflow route is registered");
  assert.equal(route?.operationName, "admin.workflows.get");
  console.log(
    JSON.stringify(
      { capability: "V2 combined workflow control", result: "PASSED", path: route?.path },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
