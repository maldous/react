/**
 * Provider-ID proof entrypoint for postgres-environment-registry-repository.
 *
 * The substantive proof is environment-registry-runtime-proof.ts, which validates
 * live environment registry sync, no-mock enforcement, permission checks, audit,
 * secret-free rows, and bootstrap state transitions.
 */

import "./environment-registry-runtime-proof.ts";
