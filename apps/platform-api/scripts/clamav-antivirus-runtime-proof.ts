/**
 * Provider-ID proof entrypoint for the ClamAV antivirus adapter.
 *
 * The substantive storage proof is tenant-storage-objects-runtime-proof.ts. It
 * validates quarantined uploads, quota-before-write, blocked downloads until a
 * clean scan, EICAR rejection, legal-hold delete denial, live ClamAV clean and
 * rejected verdicts, provider readiness, fail-closed unavailable-provider
 * behaviour, and live MinIO object flow.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "tenant-storage-objects-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(join(scriptDir, "../src/adapters/clamav-antivirus.ts"), "utf8");
const storageUsecaseSource = readFileSync(
  join(scriptDir, "../src/usecases/storage-objects.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes('created.scanState, "quarantined"') &&
    delegatedProofSource.includes("getStorageObjectDownloadUrl") &&
    delegatedProofSource.includes('clean?.scanState, "clean"') &&
    delegatedProofSource.includes('rejected?.scanState, "rejected"'),
  "delegated ClamAV proof must assert quarantined, clean, and rejected storage object state"
);
assert.ok(
  delegatedProofSource.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") &&
    delegatedProofSource.includes("AuditAction.StorageObjectRejected") &&
    delegatedProofSource.includes("legal hold blocks delete") &&
    delegatedProofSource.includes("quota"),
  "delegated ClamAV proof must assert rejection, audit, legal-hold, and quota side effects"
);
assert.ok(
  delegatedProofSource.includes("clamav.healthCheck") &&
    delegatedProofSource.includes("clamav.scan") &&
    delegatedProofSource.includes("ClamAV unavailable") &&
    delegatedProofSource.includes("checkLiveMinioObjectFlow"),
  "delegated ClamAV proof must assert provider readiness status, scan side effects, failure mode, and live MinIO state"
);
assert.ok(
  adapterSource.includes("assertTenantPrefixIsolation") &&
    adapterSource.includes("quotaBeforeWrite") &&
    adapterSource.includes("legalHoldDeletionBlock") &&
    adapterSource.includes('metric("clamav_scan_total"') &&
    adapterSource.includes("auditEvent") &&
    adapterSource.includes("withSpan") &&
    adapterSource.includes("fail-closed"),
  "ClamAV adapter must implement tenant isolation, quota/legal-hold gates, metrics, audit, trace, and fail-closed state"
);
assert.ok(
  storageUsecaseSource.includes('scanState: "quarantined"') &&
    storageUsecaseSource.includes("StorageObjectClean") &&
    storageUsecaseSource.includes("StorageObjectRejected") &&
    storageUsecaseSource.includes("storage_object_not_clean"),
  "storage object usecase must persist scan state and block download until clean"
);

await import("./tenant-storage-objects-runtime-proof.ts");
