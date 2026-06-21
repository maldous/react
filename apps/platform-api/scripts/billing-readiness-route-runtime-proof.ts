/**
 * Billing readiness route registration proof.
 */

import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find((r) => r.method === "GET" && r.path === "/api/admin/billing/readiness");
  assert.ok(route, "billing readiness route is registered");
  assert.equal(route?.operationName, "admin.billing.readiness");
  assert.equal(route?.requiredPermission, "platform.data.read");
  assert.equal(route?.resource, "admin:billing");

  console.log(
    JSON.stringify(
      {
        capability: "V2 Billing readiness",
        stopCondition: "operator route registered on the admin billing surface",
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
