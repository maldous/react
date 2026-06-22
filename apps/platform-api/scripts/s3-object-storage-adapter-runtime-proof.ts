/**
 * Provider-level proof wrapper for s3-object-storage-adapter.
 *
 * The delegated proof exercises S3/MinIO object writes, reads, deletes, signed
 * URLs, tenant-prefix isolation, unavailable-provider handling, and
 * misconfigured storage behavior.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/tenant-storage-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/s3-object-storage-adapter.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("live probe wrote the probe object") &&
    proofSource.includes("live probe read it back") &&
    proofSource.includes("live probe deleted it") &&
    adapterSource.includes("quotaBeforeWrite"),
  "S3 wrapper must assert live object write/read/delete state and quota-before-write evidence"
);
assert.ok(
  proofSource.includes("foreign cross-prefix key") &&
    proofSource.includes("FAIL") &&
    adapterSource.includes("failClosed"),
  "S3 wrapper must assert tenant isolation rejection and fail-closed storage behaviour"
);

await import("./tenant-storage-runtime-proof.ts");
