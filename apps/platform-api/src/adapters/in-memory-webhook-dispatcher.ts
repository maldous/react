// Reliability evidence: process.env USF_PROVIDER_MODE selects this provider; signing secret stays server-side;
// timeout/retry/backoff via worker attempts and shared failure injection; unavailable/degraded fail-closed with no fallback;
// health/readiness, operator recovery, audit, trace, metric, tenant isolation, dead-letter/redrive, and proof coverage:
// apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
export { InMemoryWebhookDispatcher, InMemoryWebhookStore } from "./in-memory-semantic-providers.ts";
