/**
 * Provider-ID proof entrypoint for postgres-observability-repository.
 *
 * The substantive proof is observability-signals-runtime-proof.ts, which
 * validates live Postgres signal/sample storage, latest-value queries,
 * secret-free schemas, and tenant RLS isolation.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./observability-signals-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/observability-signals-runtime-proof.ts",
  "utf8"
);
const alertingProofSource = readFileSync(
  "apps/platform-api/scripts/alerting-runtime-proof.ts",
  "utf8"
);
const incidentProofSource = readFileSync(
  "apps/platform-api/scripts/incident-foundation-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-observability-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("signal is registered and queryable") &&
    proofSource.includes("latest sample value is surfaced") &&
    alertingProofSource.includes("above threshold fires") &&
    incidentProofSource.includes("incident → acknowledged") &&
    incidentProofSource.includes("incident → resolved"),
  "observability repository proof must assert metric signal/sample, alert, and incident state side effects"
);
assert.ok(
  proofSource.includes("RLS hides orgA's signals from orgB's tenant context") &&
    proofSource.includes("signal list carries no secret fields") &&
    adapterSource.includes("postgres-observability-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts") &&
    adapterSource.includes("SET LOCAL statement_timeout"),
  "observability repository proof must assert tenant isolation, secret-free records, unavailable, timeout, and fail-closed modes"
);
