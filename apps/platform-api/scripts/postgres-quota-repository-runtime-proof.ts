/**
 * Provider-ID proof entrypoint for postgres-quota-repository.
 *
 * The substantive proof is quota-enforcement-runtime-proof.ts, which validates
 * entitlement-before-quota ordering, live quota limits, usage aggregation, typed
 * denials, and no-quota allow behavior.
 */

import "./quota-enforcement-runtime-proof.ts";
