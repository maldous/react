/**
 * Provider-level proof wrapper for InMemoryWorkflowOrchestrator.
 *
 * The delegated proof exercises workflow start, status, tenant access,
 * approval transitions, cancellation, and fail-closed unavailable or
 * misconfigured-provider paths covered by the unit reliability tests.
 */
await import("./workflow-adapters-runtime-proof.ts");
