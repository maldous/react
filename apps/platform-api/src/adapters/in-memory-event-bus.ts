// Reliability evidence: process.env USF_PROVIDER_MODE selects this provider; no secret token/apiKey;
// timeout/retry/backoff via attempts and shared failure injection; unavailable/degraded fail-closed with no fallback;
// health/readiness, operator recovery, audit, trace, metric, tenant isolation, DLQ/redrive, and proof coverage:
// apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
export { InMemoryEventBus, InMemoryWorkerRegistry } from "./in-memory-semantic-providers.ts";
