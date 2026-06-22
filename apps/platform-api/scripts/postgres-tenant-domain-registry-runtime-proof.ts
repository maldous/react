/**
 * Provider-ID proof entrypoint for the Postgres tenant-domain registry.
 *
 * The substantive proof lives in tenant-domain-claim-lifecycle-runtime-proof.ts and exercises
 * live Postgres domain claim lifecycle, cross-tenant conflict semantics, takeover guard,
 * disable-and-reclaim policy, and no token leakage.
 */

import "./tenant-domain-claim-lifecycle-runtime-proof.ts";
