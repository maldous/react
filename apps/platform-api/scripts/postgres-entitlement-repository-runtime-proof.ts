/**
 * Provider-ID proof entrypoint for postgres-entitlement-repository.
 *
 * The substantive proof is entitlements-postgres-runtime-proof.ts, which
 * validates the live tenant_entitlements substrate, RLS, operator reads, grant
 * and revoke semantics, and secret-free entitlement records.
 */

import "./entitlements-postgres-runtime-proof.ts";
