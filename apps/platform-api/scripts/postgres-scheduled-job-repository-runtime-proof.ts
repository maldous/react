/**
 * Provider-ID proof entrypoint for postgres-scheduled-job-repository.
 *
 * The substantive proof is scheduled-jobs-runtime-proof.ts, which validates
 * scheduled job persistence, due enqueue, deduplication, pause, run-now, and
 * tenant isolation semantics.
 */

import "./scheduled-jobs-runtime-proof.ts";
