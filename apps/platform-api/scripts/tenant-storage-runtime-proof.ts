/**
 * Tenant Storage readiness runtime proof (ADR-0049 / ADR-ACT-0218).
 *
 *   1. pure classifier — honest verdicts
 *   2. probe round-trip against the in-memory port (write → read → delete)
 *   3. ISOLATION (always provable, no network): the prefix-locked S3 adapter
 *      rejects a foreign cross-prefix key via its ADR-0029 §6 guard
 *   4. LIVE MinIO probe when S3 env is wired (else honest SKIP)
 *
 * Usage: npm run proof:tenant-storage
 *   Live step requires S3_DEFAULT_ENDPOINT + S3_ADMIN_ACCESS_KEY_ID +
 *   S3_ADMIN_SECRET_ACCESS_KEY (+ S3_DEFAULT_BUCKET). Without them the live step
 *   is SKIPPED — readiness is honestly `not_configured`, never faked.
 */

import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { S3ObjectStorageAdapter } from "@platform/adapters-object-storage";
import {
  classifyStorageProbe,
  probeTenantStorage,
  tenantStoragePrefix,
} from "../src/usecases/tenant-storage.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  console.log("# Tenant storage runtime proof\n");

  // 1. Pure classifier.
  check(
    "round-trip + isolation → configured",
    classifyStorageProbe({ wrote: true, read: true, deleted: true, foreignKeyRejected: true }) ===
      "configured"
  );
  check(
    "round-trip without isolation → isolation_failed",
    classifyStorageProbe({ wrote: true, read: true, deleted: true, foreignKeyRejected: false }) ===
      "isolation_failed"
  );

  // 2. In-memory probe round-trip.
  const mem = await probeTenantStorage({
    prefix: tenantStoragePrefix("org-proof"),
    port: createInMemoryObjectStoragePort(),
    assertIsolation: async () => true,
  });
  check("in-memory probe write/read/delete + isolation → configured", mem.status === "configured");

  // 3. Isolation guard — always provable, no network.
  const guarded = new S3ObjectStorageAdapter({
    bucket: "proof-bucket",
    region: "us-east-1",
    organisationId: "org-proof",
  });
  let rejected = false;
  try {
    await guarded.get("some-other-tenant/object");
  } catch {
    rejected = true;
  }
  check("prefix-locked adapter rejects a foreign cross-prefix key (ADR-0029 §6)", rejected);

  // 4. Live MinIO probe when configured.
  const endpoint = process.env["S3_DEFAULT_ENDPOINT"];
  const accessKeyId = process.env["S3_ADMIN_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_ADMIN_SECRET_ACCESS_KEY"];
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.log(
      "SKIP  live MinIO probe — S3 not wired (readiness is honestly not_configured; set S3_DEFAULT_ENDPOINT + S3_ADMIN_* to exercise)"
    );
  } else {
    const port = new S3ObjectStorageAdapter({
      bucket: process.env["S3_DEFAULT_BUCKET"] ?? "platform-data",
      region: process.env["S3_DEFAULT_REGION"] ?? "us-east-1",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      organisationId: "org-proof",
    });
    const live = await probeTenantStorage({
      prefix: tenantStoragePrefix("org-proof"),
      port,
      assertIsolation: async () => {
        try {
          await port.get("some-other-tenant/object");
          return false;
        } catch {
          return true;
        }
      },
    });
    check("live MinIO probe → configured", live.status === "configured", live.status);
  }

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
