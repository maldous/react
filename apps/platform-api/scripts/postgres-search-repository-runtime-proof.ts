/**
 * Provider-ID proof entrypoint for postgres-search-repository.
 *
 * The substantive proof is search-runtime-proof.ts, which validates live
 * Postgres search index/query/reindex/remove/readiness and secret-free
 * projections.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./search-runtime-proof.ts";

const proofSource = readFileSync("apps/platform-api/scripts/search-runtime-proof.ts", "utf8");
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-search-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("reindex rebuilds the tsvector and reports the count") &&
    proofSource.includes("remove deletes the document") &&
    proofSource.includes("removed document no longer appears in search") &&
    proofSource.includes("readiness.status") &&
    adapterSource.includes("INSERT INTO public.search_documents"),
  "search repository proof must assert index/query/reindex/remove/readiness state and persisted document side effects"
);
assert.ok(
  proofSource.includes("empty query rejected safely") &&
    proofSource.includes("secret-bearing metadata rejected before indexing") &&
    proofSource.includes("results carry no body or secret fields") &&
    adapterSource.includes("postgres-search-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "search repository proof must assert empty-query rejection, secret rejection, redaction, and unavailable fail-closed modes"
);
