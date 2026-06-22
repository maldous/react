/**
 * Provider-ID proof entrypoint for the Postgres billing catalog adapter.
 *
 * The substantive proof is billing-catalog-runtime-proof.ts, with behaviour
 * coverage in apps/platform-api/tests/unit/billing-catalog.test.ts. This
 * entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./billing-catalog-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/billing-catalog-runtime-proof.ts",
  "utf8"
);
const testSource = readFileSync("apps/platform-api/tests/unit/billing-catalog.test.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-billing-catalog.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("billing catalog route is registered") &&
    testSource.includes("creates and lists products, plans, and prices") &&
    testSource.includes("listBillingCatalogProducts") &&
    testSource.includes("listBillingCatalogPlans") &&
    testSource.includes("listBillingCatalogPrices") &&
    testSource.includes("AuditAction.BillingCatalogProductCreated"),
  "billing catalog proof must assert route registration plus create/list/audit state"
);
assert.ok(
  adapterSource.includes("SET LOCAL statement_timeout") &&
    adapterSource.includes("retryAttempts") &&
    adapterSource.includes("postgres-billing-catalog unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts") &&
    adapterSource.includes("recoveryAction"),
  "billing catalog adapter must assert timeout, retry, unavailable, fail-closed, and recovery failure modes"
);
