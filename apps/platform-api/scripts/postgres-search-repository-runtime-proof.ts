/**
 * Provider-ID proof entrypoint for postgres-search-repository.
 *
 * The substantive proof is search-runtime-proof.ts, which validates live
 * Postgres search index/query/reindex/remove/readiness and secret-free
 * projections.
 */

import "./search-runtime-proof.ts";
