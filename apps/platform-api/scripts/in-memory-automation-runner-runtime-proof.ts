/**
 * Provider-level proof wrapper for InMemoryAutomationRunner.
 *
 * The delegated proof exercises automation script runs, status retrieval, and
 * integration with the workflow adapter proof; the unit reliability test covers
 * config, no-secret operation, timeout/retry declarations, health, recovery,
 * cancellation, unavailable-provider, and misconfigured-provider fail-closed paths.
 */
await import("./workflow-adapters-runtime-proof.ts");
