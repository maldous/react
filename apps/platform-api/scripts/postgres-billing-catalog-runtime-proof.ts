/**
 * Provider-ID proof entrypoint for the Postgres billing catalog adapter.
 *
 * The substantive proof is billing-catalog-runtime-proof.ts, with behaviour
 * coverage in apps/platform-api/tests/unit/billing-catalog.test.ts. This
 * entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import "./billing-catalog-runtime-proof.ts";
