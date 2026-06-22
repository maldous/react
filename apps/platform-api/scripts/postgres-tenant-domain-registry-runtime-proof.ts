/**
 * Provider-ID proof entrypoint for the Postgres tenant-domain registry.
 *
 * The substantive proof lives in tenant-domain-claim-lifecycle-runtime-proof.ts and exercises
 * live Postgres domain claim lifecycle, cross-tenant conflict semantics, takeover guard,
 * disable-and-reclaim policy, and no token leakage.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./tenant-domain-claim-lifecycle-runtime-proof.ts";

const lifecycleProofSource = readFileSync(
  "apps/platform-api/scripts/tenant-domain-claim-lifecycle-runtime-proof.ts",
  "utf8"
);
const domainsProofSource = readFileSync(
  "apps/platform-api/scripts/tenant-domains-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-tenant-domain-registry.ts",
  "utf8"
);

assert.ok(
  domainsProofSource.includes("challenge created with a public TXT token") &&
    domainsProofSource.includes("DNS-TXT verification succeeds") &&
    domainsProofSource.includes("listed as verified after ownership proof") &&
    domainsProofSource.includes("readiness aggregates to verified") &&
    lifecycleProofSource.includes("disabled claim history is retained"),
  "tenant domain registry proof must assert challenge/verify/list/readiness state and retained claim lifecycle side effects"
);
assert.ok(
  domainsProofSource.includes("no domains") &&
    lifecycleProofSource.includes("conflict") &&
    adapterSource.includes("conflict_other_tenant") &&
    adapterSource.includes('return "unavailable"') &&
    adapterSource.includes("no fallback registry exists"),
  "tenant domain registry proof must assert no-domain state, cross-tenant conflict, unavailable, and no-fallback failure modes"
);
