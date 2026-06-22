/**
 * Provider-ID proof entrypoint for the Postgres event bus adapter.
 *
 * The substantive live proofs are:
 * - event-bus-runtime-proof.ts for publish, idempotency, tenant isolation, and payload safety
 * - event-worker-runtime-proof.ts for claim/process/retry/DLQ/heartbeat
 * - event-redrive-runtime-proof.ts for operator redrive routes
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import "./event-bus-runtime-proof.ts";
