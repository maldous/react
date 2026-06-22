/**
 * Provider-ID proof entrypoint for postgres-delegated-admin-roles.
 *
 * The substantive proof is v1c04-delegated-admin-roles-runtime-proof.ts, which
 * exercises deny-by-default, duplicate prevention, audit-before-mutation, tenant
 * isolation, revoke semantics, and list authorization. The substrate unit test
 * covers the Postgres adapter's auth wrappers and statement timeout ordering.
 */

import "./v1c04-delegated-admin-roles-runtime-proof.ts";
