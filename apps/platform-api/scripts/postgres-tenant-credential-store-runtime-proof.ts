/**
 * Provider-ID proof entrypoint for the Postgres tenant credential store.
 *
 * The substantive proof is credential-lifecycle-runtime-proof.ts, which validates
 * per-tenant credentials against Keycloak, preserves existing credentials when a
 * candidate is invalid, writes lifecycle metadata, uses the validated credential
 * for a real realm mutation, and avoids printing secrets.
 *
 * This entrypoint names the concrete provider so adversarial provider reliability
 * checks can bind unavailable/misconfigured proof evidence to the adapter.
 */

await import("./credential-lifecycle-runtime-proof.ts");
