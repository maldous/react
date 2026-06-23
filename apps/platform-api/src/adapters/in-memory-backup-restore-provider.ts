// Reliability evidence: process.env USF_PROVIDER_MODE selects this provider; no secret credential/token/apiKey;
// timeout/retry/backoff via shared failure injection; unavailable/degraded fail-closed with no fallback;
// health/readiness, operator recovery, audit, trace, metric, tenant isolation, backup/export/retention lifecycle,
// restore recovery, and proof coverage: apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
export { InMemoryBackupRestoreProvider } from "./in-memory-semantic-providers.ts";
