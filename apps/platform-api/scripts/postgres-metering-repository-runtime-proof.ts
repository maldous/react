/**
 * Provider-ID proof entrypoint for postgres-metering-repository.
 *
 * The substantive proof is metering-runtime-proof.ts, which validates live
 * Postgres metering idempotency, entitlement gating, aggregation, tenant RLS
 * isolation, and secret-free meter event storage.
 */

import "./metering-runtime-proof.ts";
