/**
 * Provider-ID proof entrypoint for postgres-observability-repository.
 *
 * The substantive proof is observability-signals-runtime-proof.ts, which
 * validates live Postgres signal/sample storage, latest-value queries,
 * secret-free schemas, and tenant RLS isolation.
 */

import "./observability-signals-runtime-proof.ts";
