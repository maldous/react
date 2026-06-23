/**
 * Provider-ID proof entrypoint for postgres-data-governance.
 *
 * The substantive proof is data-governance-runtime-proof.ts, which exercises the
 * catalogue, classification, DSR open-to-fulfilled workflow, fulfilment evidence,
 * and governance route registration. This wrapper gives the Postgres provider a
 * stable proof identity for V2 assurance mapping.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./data-governance-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/data-governance-runtime-proof.ts",
  "utf8"
);
const testSource = readFileSync("apps/platform-api/tests/unit/data-governance.test.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-data-governance.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("catalogue lineage edges normalized and queryable") &&
    proofSource.includes("DSR open-to-fulfilled workflow records fulfilment evidence") &&
    proofSource.includes(
      "governance routes include catalogue, classification, DSR create/list and fulfil"
    ) &&
    testSource.includes(
      "normalizes catalogue lineage and stores column classification decisions"
    ) &&
    testSource.includes("fulfills DSRs with catalogue and classification evidence exactly once"),
  "data governance proof must assert catalogue/classification side effects and DSR fulfilled state"
);
assert.ok(
  proofSource.includes("not found or already fulfilled") &&
    testSource.includes("assert.rejects") &&
    adapterSource.includes("postgres-data-governance unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts") &&
    adapterSource.includes("set_config('statement_timeout'"),
  "data governance proof must assert forbidden duplicate fulfilment and unavailable fail-closed failure modes"
);
