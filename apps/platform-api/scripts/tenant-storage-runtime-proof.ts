/**
 * Tenant Storage readiness runtime proof (ADR-0049 / ADR-ACT-0218, ADR-ACT-0223).
 *
 *   1. pure classifier — honest verdicts
 *   2. in-memory probe round-trip (write → read → delete)
 *   3. ISOLATION (always provable, no network): the prefix-locked S3 adapter rejects
 *      a foreign cross-prefix key via its ADR-0029 §6 guard
 *   4. LIVE MinIO probe BY DEFAULT (loads local .env; resolves S3_*→MINIO_*→defaults;
 *      ensures the bucket; writes/reads-back/deletes a probe object + rejects a
 *      foreign key). SKIPs only when MinIO is genuinely unreachable.
 *
 * Usage: npm run proof:tenant-storage   (MinIO up via `make compose-up-default`)
 * No secret is ever printed.
 */

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { S3ObjectStorageAdapter } from "@platform/adapters-object-storage";
import {
  classifyStorageProbe,
  probeTenantStorage,
  tenantStoragePrefix,
} from "../src/usecases/tenant-storage.ts";
import { loadLocalEnv, resolveLocalS3 } from "./lib/local-env.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
  assert.equal(ok, true, detail ? `${label}: ${detail}` : label);
}

function isConnRefused(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(msg);
}

function checkPureClassifier(): void {
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
}

async function checkInMemoryProbe(): Promise<void> {
  const mem = await probeTenantStorage({
    prefix: tenantStoragePrefix("org-proof"),
    port: createInMemoryObjectStoragePort(),
    assertIsolation: async () => true,
  });
  check("in-memory probe write/read/delete + isolation → configured", mem.status === "configured");
}

async function checkIsolationGuard(): Promise<void> {
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
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  // Deterministic bucket provisioning (idempotent).
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const name = (err as S3ServiceException)?.name ?? "";
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err;
    }
  }
}

async function checkLiveMinioProbe(): Promise<void> {
  // LIVE MinIO probe (by default — loads local env so it does not skip in dev).
  loadLocalEnv();
  const s3 = resolveLocalS3();
  const safeEndpoint = s3.endpoint.replace(/\/\/[^@]*@/, "//"); // strip any creds in URL
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });

  try {
    await ensureBucket(client, s3.bucket);
    check(`live MinIO reachable + bucket ready @ ${safeEndpoint} (${s3.bucket})`, true);

    const port = new S3ObjectStorageAdapter({
      bucket: s3.bucket,
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
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
    check("live probe wrote the probe object", live.wrote);
    check("live probe read it back (size-verified)", live.read);
    check("live probe deleted it (self-cleaning)", live.deleted);
    check("live probe rejected a foreign cross-prefix key", live.foreignKeyRejected);
    check("live MinIO probe → configured", live.status === "configured", live.status);
  } catch (err) {
    if (isConnRefused(err)) {
      console.log(
        `SKIP  live MinIO probe — not reachable @ ${safeEndpoint} (start it: make compose-up-default)`
      );
    } else {
      check("live MinIO probe", false, err instanceof Error ? err.message : String(err));
    }
  } finally {
    client.destroy();
  }
}

async function main(): Promise<void> {
  console.log("# Tenant storage runtime proof\n");

  // 1. Pure classifier.
  checkPureClassifier();

  // 2. In-memory probe round-trip.
  await checkInMemoryProbe();

  // 3. Isolation guard — always provable, no network.
  await checkIsolationGuard();

  // 4. LIVE MinIO probe (by default — loads local env so it does not skip in dev).
  await checkLiveMinioProbe();

  // 5. Bucket-policy / IAM-level isolation: NOT automated locally (honest).
  console.log(
    "INFO  IAM/bucket-policy isolation is NOT proven here — MinIO's admin API differs from AWS IAM;" +
      " the adapter prefix guard (proven above) is the local isolation control. See evidence for the gap."
  );

  console.log(failures === 0 ? "\n# ALL CHECKS PASSED" : `\n# ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
