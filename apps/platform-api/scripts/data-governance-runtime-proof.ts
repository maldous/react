import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const required = [
    "/api/admin/governance/catalog",
    "/api/admin/governance/catalog/classify",
    "/api/admin/governance/dsr",
  ];
  for (const path of required)
    assert.ok(
      routes.some((r) => r.path === path),
      `governance route registered: ${path}`
    );
  console.log(
    JSON.stringify({ capability: "V1C-13", result: "PASSED", routes: required }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
