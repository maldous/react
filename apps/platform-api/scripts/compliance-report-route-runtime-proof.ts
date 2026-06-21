/**
 * Compliance report route registration proof.
 *
 * Proves the operator route is wired into the server route table and points at the
 * compliance-report surface used by admin tooling.
 */

import { strict as assert } from "node:assert";
import { routes } from "../src/server/routes.ts";

async function main(): Promise<void> {
  const route = routes.find(
    (r) => r.method === "GET" && r.path === "/api/admin/data/compliance-report"
  );

  assert.ok(route, "compliance report route is registered");
  assert.equal(route?.operationName, "admin.data.complianceReport.get");
  assert.equal(route?.requiredPermission, "platform.data.read");
  assert.equal(route?.resource, "admin:data");

  console.log(
    JSON.stringify(
      {
        capability: "V1C-19 Compliance report route",
        stopCondition: "operator route registered on the admin data surface",
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
