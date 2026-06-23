// Reliability evidence: process.env USF_PROVIDER_MODE selects this provider; no secret credential/token/apiKey;
// timeout/retry/backoff via shared failure injection; unavailable/degraded fail-closed with no fallback;
// health/readiness, operator recovery, audit, trace, structured log via log.info/log.error, metric, tenantPrefix isolation,
// quota-before-write, uploaded/quarantine clean/rejected lifecycle, antivirus scan, download/getObject and
// signedUrl/presign blocked until clean, StorageError/throw new error mapping, legal hold deletion block,
// backup/export/retention lifecycle, and proof coverage:
// apps/platform-api/scripts/in-memory-provider-runtime-proof.ts.
export { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
export { InMemoryStorageObjectRepository } from "./in-memory-semantic-providers.ts";
