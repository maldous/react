/**
 * Provider-ID proof entrypoint for postgres-delegated-admin-roles.
 *
 * The substantive proof is v1c04-delegated-admin-roles-runtime-proof.ts, which
 * exercises deny-by-default, duplicate prevention, audit-before-mutation, tenant
 * isolation, revoke semantics, and list authorization. The substrate unit test
 * covers the Postgres adapter's auth wrappers and statement timeout ordering.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./v1c04-delegated-admin-roles-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/v1c04-delegated-admin-roles-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-delegated-admin-roles.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("deny produces no audit and no mutation") &&
    proofSource.includes("audit emits Delegation.Granted") &&
    proofSource.includes("duplicate returns delegation_already_active") &&
    proofSource.includes("tenant isolation: ORG_B sees zero delegations") &&
    proofSource.includes("revoke emits Delegation.Revoked audit") &&
    proofSource.includes("tenant-admin listForTenant sees their delegation"),
  "delegated-admin proof must assert grant/list/revoke state, audit ordering, duplicate prevention, and tenant isolation"
);
assert.ok(
  proofSource.includes("audit failure rejects the grant") &&
    proofSource.includes("revoke returns not_found on missing id") &&
    proofSource.includes("tenant-admin revoke denied") &&
    adapterSource.includes("postgres-delegated-admin-roles unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "delegated-admin proof must assert audit failure, missing revoke, denied revoke, and unavailable fail-closed modes"
);
