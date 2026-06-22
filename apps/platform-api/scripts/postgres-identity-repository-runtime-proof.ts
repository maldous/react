/**
 * Provider-level proof wrapper for postgres-identity-repository.
 *
 * The delegated proof exercises the live tenant/domain identity matrix through
 * the Postgres identity repository and fails on unavailable or misconfigured
 * identity storage behavior.
 */
await import("./domain-identity-matrix-runtime-proof.ts");
