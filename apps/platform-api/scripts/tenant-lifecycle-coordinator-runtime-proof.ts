/**
 * Provider-level proof wrapper for tenant-lifecycle-coordinator.
 *
 * The delegated proof exercises tenant provision/suspend/delete/export
 * coordination, export-before-delete, subsystem failure stop, and recovery
 * evidence for unavailable or misconfigured lifecycle dependencies.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proofSource = readFileSync(
  "apps/platform-api/scripts/tenant-lifecycle-runtime-proof.ts",
  "utf8"
);
const coordinatorSource = readFileSync(
  "apps/platform-api/src/adapters/tenant-lifecycle-coordinator.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("delete exports first") &&
    proofSource.includes("delete coordinates storage/realm/DSR/data") &&
    proofSource.includes("auditCalls.length") &&
    proofSource.includes("exportTenant"),
  "tenant lifecycle coordinator wrapper must assert delegated export-first delete state and audit side effects"
);
assert.ok(
  proofSource.includes("subsystem coordination is explicit") &&
    coordinatorSource.includes("failClosed"),
  "tenant lifecycle coordinator wrapper must assert explicit subsystem failure propagation"
);

await import("./tenant-lifecycle-runtime-proof.ts");
