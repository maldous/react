/**
 * Provider-ID proof entrypoint for postgres-retention.
 *
 * The substantive proof is retention-runtime-proof.ts, which validates
 * retention policy validation, audit-before-change behavior, legal-hold guarded
 * candidate processing, outcomes, and retention route registration.
 */

import "./retention-runtime-proof.ts";
