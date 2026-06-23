import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";
import { emitRuntimeProofObservabilityEvidence } from "./lib/runtime-evidence.ts";

emitRuntimeProofObservabilityEvidence("observability-readiness-route");

async function main(): Promise<void> {
  const route = routes.find(
    (r) => r.method === "GET" && r.path === "/api/admin/observability/readiness"
  );
  assert.ok(route, "observability readiness route is registered");
  assert.equal(route?.operationName, "admin.observability.readiness");
  assert.equal(route?.requiredPermission, "platform.observability.read");
  assert.equal(route?.resource, "admin:observability");
  console.log(
    JSON.stringify(
      {
        capability: "V2 observability readiness",
        stopCondition: "operator route registered on the admin observability surface",
        result: "PASSED",
        route: {
          method: route?.method,
          path: route?.path,
          operationName: route?.operationName,
        },
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
