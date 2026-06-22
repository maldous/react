/**
 * Provider-ID proof entrypoint for postgres-rate-limit-repository.
 *
 * The substantive proof is rate-limits-runtime-proof.ts, which validates live
 * Postgres rate-limit policy mutation, entitlement-before-counting, allow/deny
 * fixed-window behavior, tenant RLS isolation, and secret-free records.
 */

import "./rate-limits-runtime-proof.ts";
