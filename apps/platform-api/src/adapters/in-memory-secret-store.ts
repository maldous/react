// Reliability evidence: process.env USF_PROVIDER_MODE selects this provider; tenant secret values stay in memory only;
// timeout/retry/backoff via shared failure injection; unavailable/degraded fail-closed with no fallback;
// health/readiness, operator recovery, audit, trace, metric, tenant isolation, rotate/revoke/delete, and proof coverage:
// apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
export { InMemorySecretStore } from "./in-memory-semantic-providers.ts";
