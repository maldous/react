/**
 * Provider-ID proof entrypoint for the Postgres API key repository.
 *
 * The substantive live proof is api-keys-runtime-proof.ts, which validates
 * one-time secret return, hash/salt storage, tenant-scoped listing, RLS isolation,
 * authentication, revoked-key denial, and no secret/hash exposure in list output.
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

import "./api-keys-runtime-proof.ts";
