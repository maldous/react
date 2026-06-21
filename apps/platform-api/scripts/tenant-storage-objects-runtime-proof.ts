import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const required = [
    "/api/org/storage/objects",
    "/api/org/storage/readiness",
    "/api/org/storage/probe",
  ];
  for (const path of required)
    assert.ok(
      routes.some((r) => r.path === path),
      `storage route registered: ${path}`
    );
  console.log(
    JSON.stringify({ capability: "V1C-15", result: "PASSED", routes: required }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
