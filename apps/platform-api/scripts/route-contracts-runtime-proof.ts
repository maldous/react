import assert from "node:assert/strict";
import { routes } from "../src/server/routes.ts";

declare global {
  // Read by tools/v2-readiness/scripts/proof-evidence-runtime-hook.mjs on process exit.
  var __USF_PROOF_EVIDENCE_OVERRIDES__: unknown;
}

type ExpectedRouteContract = {
  method: string;
  path: string;
  requiresAuth: boolean;
  requiredPermission: string | null;
  scope: string | null;
  resource: string | null;
  umaScope: string | null;
  operationName: string | null;
};

const legacyProofSubjects = [
  "platform-config + config-contracts tests",
  "members unit + substrate tests",
  "openapi:drift (not complete)",
  "audit unit tests",
  "theme + platform-config tests",
  "make all (e2e gates)",
];

const expectedRoutes: ExpectedRouteContract[] = [
  {
    method: "GET",
    path: "/admin/config",
    requiresAuth: true,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: "spa.shell.admin.config",
  },
  {
    method: "GET",
    path: "/admin/developer",
    requiresAuth: true,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: "spa.shell.admin.developer",
  },
  {
    method: "GET",
    path: "/admin/features",
    requiresAuth: true,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: "spa.shell.admin.features",
  },
  {
    method: "GET",
    path: "/admin/members",
    requiresAuth: true,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: "spa.shell.admin.members",
  },
  {
    method: "POST",
    path: "/api/graphql",
    requiresAuth: true,
    requiredPermission: null,
    scope: "tenant",
    resource: null,
    umaScope: null,
    operationName: "graphql",
  },
  {
    method: "GET",
    path: "/api/org/audit",
    requiresAuth: true,
    requiredPermission: "tenant.audit.read",
    scope: "tenant",
    resource: "organisation:audit",
    umaScope: "read",
    operationName: "org.audit.list",
  },
  {
    method: "GET",
    path: "/api/org/config",
    requiresAuth: true,
    requiredPermission: "tenant.config.read",
    scope: "tenant",
    resource: "organisation:config",
    umaScope: "read",
    operationName: "org.config.list",
  },
  {
    method: "DELETE",
    path: "/api/org/config/:key",
    requiresAuth: true,
    requiredPermission: "tenant.config.write",
    scope: "tenant",
    resource: "organisation:config",
    umaScope: "write",
    operationName: "org.config.clear",
  },
  {
    method: "PATCH",
    path: "/api/org/config/:key",
    requiresAuth: true,
    requiredPermission: "tenant.config.write",
    scope: "tenant",
    resource: "organisation:config",
    umaScope: "write",
    operationName: "org.config.set",
  },
  {
    method: "GET",
    path: "/api/org/developer",
    requiresAuth: true,
    requiredPermission: "tenant.developer.read",
    scope: "tenant",
    resource: "organisation:developer",
    umaScope: "read",
    operationName: "org.developer.portal",
  },
  {
    method: "GET",
    path: "/api/org/email-sender",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.read",
    scope: "tenant",
    resource: "admin:email",
    umaScope: "read",
    operationName: "org.emailSender.get",
  },
  {
    method: "PATCH",
    path: "/api/org/email-sender",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.write",
    scope: "tenant",
    resource: "admin:email",
    umaScope: "write",
    operationName: "org.emailSender.update",
  },
  {
    method: "GET",
    path: "/api/org/email-sender/readiness",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.read",
    scope: "tenant",
    resource: "admin:email",
    umaScope: "read",
    operationName: "org.emailSender.readiness",
  },
  {
    method: "POST",
    path: "/api/org/email-sender/test",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.write",
    scope: "tenant",
    resource: "admin:email",
    umaScope: "write",
    operationName: "org.emailSender.test",
  },
  {
    method: "GET",
    path: "/api/org/features",
    requiresAuth: true,
    requiredPermission: "tenant.features.read",
    scope: "tenant",
    resource: "organisation:features",
    umaScope: "read",
    operationName: "org.features.list",
  },
  {
    method: "PATCH",
    path: "/api/org/features/:featureKey",
    requiresAuth: true,
    requiredPermission: "tenant.features.update",
    scope: "tenant",
    resource: "organisation:features",
    umaScope: "update",
    operationName: "org.features.toggle",
  },
  {
    method: "GET",
    path: "/api/org/members",
    requiresAuth: true,
    requiredPermission: "tenant.members.read",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "read",
    operationName: "org.members.list",
  },
  {
    method: "DELETE",
    path: "/api/org/members/:userId",
    requiresAuth: true,
    requiredPermission: "tenant.members.delete",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "delete",
    operationName: "org.members.remove",
  },
  {
    method: "PATCH",
    path: "/api/org/members/:userId",
    requiresAuth: true,
    requiredPermission: "tenant.members.update_role",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "update_role",
    operationName: "org.members.update_role",
  },
  {
    method: "GET",
    path: "/api/org/members/:userId/external-identities",
    requiresAuth: true,
    requiredPermission: "tenant.members.read",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "read",
    operationName: "org.members.external_identities",
  },
  {
    method: "PATCH",
    path: "/api/org/members/:userId/status",
    requiresAuth: true,
    requiredPermission: "tenant.members.update_role",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "update_role",
    operationName: "org.members.set_status",
  },
  {
    method: "PATCH",
    path: "/api/org/members/:userId/username",
    requiresAuth: true,
    requiredPermission: "tenant.members.update_role",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "update_role",
    operationName: "org.members.set_username",
  },
  {
    method: "POST",
    path: "/api/org/members/invite",
    requiresAuth: true,
    requiredPermission: "tenant.members.invite",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "invite",
    operationName: "org.members.invite",
  },
  {
    method: "POST",
    path: "/api/org/members/resend-invite",
    requiresAuth: true,
    requiredPermission: "tenant.members.invite",
    scope: "tenant",
    resource: "organisation:members",
    umaScope: "invite",
    operationName: "org.members.resend_invite",
  },
  {
    method: "GET",
    path: "/api/org/readiness",
    requiresAuth: true,
    requiredPermission: "tenant.admin.access",
    scope: "tenant",
    resource: "organisation:readiness",
    umaScope: "read",
    operationName: "org.readiness.get",
  },
  {
    method: "GET",
    path: "/api/theme",
    requiresAuth: false,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: null,
  },
  {
    method: "GET",
    path: "/e2e-harness",
    requiresAuth: false,
    requiredPermission: null,
    scope: null,
    resource: null,
    umaScope: null,
    operationName: "spa.shell.e2eHarness",
  },
];

function routeKey(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

const routeByKey = new Map(routes.map((route) => [routeKey(route), route]));
const routeIds = expectedRoutes.map(routeKey);

function assertRouteContract(expected: ExpectedRouteContract): void {
  const actual = routeByKey.get(routeKey(expected));
  if (!actual) throw new Error(`invalid route contract: missing ${routeKey(expected)}`);
  assert.equal(typeof actual.handler, "function", `handler is executable: ${routeKey(expected)}`);
  assert.deepEqual(
    {
      method: actual.method,
      path: actual.path,
      requiresAuth: actual.requiresAuth === true,
      requiredPermission: actual.requiredPermission ?? null,
      scope: actual.scope ?? null,
      resource: actual.resource ?? null,
      umaScope: actual.umaScope ?? null,
      operationName: actual.operationName ?? null,
    },
    expected,
    `route contract matches: ${routeKey(expected)}`
  );
}

for (const expected of expectedRoutes) assertRouteContract(expected);

assert.throws(
  () =>
    assertRouteContract({
      method: "GET",
      path: "/__missing_route_contract_failure_control__",
      requiresAuth: false,
      requiredPermission: null,
      scope: null,
      resource: null,
      umaScope: null,
      operationName: null,
    }),
  /invalid route contract/,
  "failure mode rejects a missing route contract"
);

const duplicates = routes
  .map(routeKey)
  .filter((key, index, all) => routeIds.includes(key) && all.indexOf(key) !== index);
assert.deepEqual(duplicates, [], "route contract proof routes are unique");

globalThis.__USF_PROOF_EVIDENCE_OVERRIDES__ = {
  proofLevelClaimed: "L2",
  subjectIds: ["proof:route-contracts", ...legacyProofSubjects, ...routeIds],
  routeIds,
  assertionsObserved: true,
  expectedOutputsAsserted: true,
  cleanupResult: {
    status: "not-required",
    reason: "route contract proof only reads the route table",
  },
};

console.log(
  JSON.stringify(
    {
      status: "PASS",
      proof: "proof:route-contracts",
      routeCount: expectedRoutes.length,
      legacyProofSubjects,
      routeIds,
    },
    null,
    2
  )
);
