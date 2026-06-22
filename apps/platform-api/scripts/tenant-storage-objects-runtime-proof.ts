import { strict as assert } from "node:assert";
import { AuditAction, type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
import { S3ObjectStorageAdapter } from "@platform/adapters-object-storage";
import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { routes } from "../src/server/routes.ts";
import {
  createStorageObject,
  deleteStorageObject,
  getStorageObjectDownloadUrl,
  scanStorageObject,
} from "../src/usecases/storage-objects.ts";
import { LegalHoldGuard } from "../src/usecases/legal-hold.ts";
import { StubAntivirusPort } from "../src/ports/antivirus.ts";
import { ClamAvAdapter, loadClamAvConfig } from "../src/adapters/clamav-antivirus.ts";
import type {
  CreateStorageObjectInput,
  StorageObjectRecord,
  StorageObjectRepository,
  StorageObjectScanState,
} from "../src/ports/storage-objects.ts";
import type { QuotaDeps } from "../src/usecases/quota.ts";
import { loadLocalEnv, resolveLocalS3 } from "./lib/local-env.ts";

const ORG = "org-storage-proof";

class MemoryStorageObjectRepository implements StorageObjectRepository {
  private rows = new Map<string, StorageObjectRecord>();
  private key(organisationId: string, objectKey: string): string {
    return `${organisationId}:${objectKey}`;
  }
  async listForTenant(organisationId: string): Promise<StorageObjectRecord[]> {
    return [...this.rows.values()].filter((r) => r.organisationId === organisationId);
  }
  async get(organisationId: string, objectKey: string): Promise<StorageObjectRecord | null> {
    return this.rows.get(this.key(organisationId, objectKey)) ?? null;
  }
  async create(input: CreateStorageObjectInput): Promise<StorageObjectRecord> {
    const rec: StorageObjectRecord = {
      objectId: `obj-${this.rows.size + 1}`,
      organisationId: input.organisationId,
      objectKey: input.objectKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      scanState: "uploaded",
      createdAt: null,
      updatedAt: null,
    };
    this.rows.set(this.key(input.organisationId, input.objectKey), rec);
    return rec;
  }
  async setScanState(
    organisationId: string,
    objectKey: string,
    state: StorageObjectScanState
  ): Promise<StorageObjectRecord> {
    const rec = await this.get(organisationId, objectKey);
    if (!rec) throw new Error("storage_object_not_found");
    const next = { ...rec, scanState: state };
    this.rows.set(this.key(organisationId, objectKey), next);
    return next;
  }
  async delete(organisationId: string, objectKey: string): Promise<void> {
    this.rows.delete(this.key(organisationId, objectKey));
  }
}

function audit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: { emit: async (e) => void events.push(e), query: async () => events },
  };
}

function quotas(limit: number, initialUsage = 0): QuotaDeps {
  let usage = initialUsage;
  return {
    quota: {
      listForTenant: async () => [],
      listForTenantAsOperator: async () => [],
      getByKey: async (_organisationId, quotaKey) =>
        quotaKey === "storage.bytes"
          ? {
              organisationId: ORG,
              quotaKey: "storage.bytes",
              entitlementKey: "storage",
              meterKey: "storage.bytes",
              limit,
              window: "lifetime",
              action: "deny",
              updatedAt: null,
              updatedBy: null,
            }
          : null,
      upsert: async () => {
        throw new Error("not used");
      },
    },
    metering: {
      record: async (input) => {
        usage += input.quantity;
        return { recorded: true, deduplicated: false };
      },
      aggregate: async () => usage,
      aggregateAsOperator: async () => usage,
    },
    entitlements: {
      listForTenant: async () => [],
      listForTenantAsOperator: async () => [],
      getGrant: async (_organisationId, entitlementKey) =>
        entitlementKey === "storage"
          ? {
              organisationId: ORG,
              entitlementKey: "storage",
              state: "granted",
              source: "system",
              metadata: {},
              updatedAt: null,
              updatedBy: null,
            }
          : null,
      upsert: async () => {
        throw new Error("not used");
      },
    },
    audit: audit().port,
  };
}

function deps(limit = 100) {
  const a = audit();
  const held = new Set<string>();
  return {
    deps: {
      repository: new MemoryStorageObjectRepository(),
      storage: createInMemoryObjectStoragePort(),
      quotas: quotas(limit),
      audit: a.port,
      legalHoldGuard: new LegalHoldGuard({
        repository: { isActive: async (_org, _table, rowId) => held.has(rowId) },
      }),
      antivirus: new StubAntivirusPort(),
    },
    auditEvents: a.events,
    hold: (objectKey: string) => held.add(objectKey),
  };
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
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

async function checkLiveMinioObjectFlow(clamav: ClamAvAdapter): Promise<void> {
  loadLocalEnv();
  const s3 = resolveLocalS3();
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  try {
    await ensureBucket(client, s3.bucket);
    const a = audit();
    const liveDeps = {
      repository: new MemoryStorageObjectRepository(),
      storage: new S3ObjectStorageAdapter({
        bucket: s3.bucket,
        region: s3.region,
        endpoint: s3.endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
        organisationId: ORG,
      }),
      quotas: quotas(10_000),
      audit: a.port,
      legalHoldGuard: new LegalHoldGuard({
        repository: { isActive: async () => false },
      }),
      antivirus: clamav,
    };
    const key = `${ORG}/live-v1c15-clean.txt`;
    await createStorageObject(
      {
        organisationId: ORG,
        objectKey: key,
        contentType: "text/plain",
        body: "live clean body",
        actorId: "proof",
      },
      liveDeps
    );
    const scanned = await scanStorageObject(ORG, key, "scanner", liveDeps);
    assert.equal(scanned?.scanState, "clean");
    const url = await getStorageObjectDownloadUrl(ORG, key, 60, liveDeps);
    assert.match(url?.url ?? "", /^http/);
    await deleteStorageObject(ORG, key, "proof", liveDeps);
    assert.equal(await liveDeps.repository.get(ORG, key), null);
  } finally {
    client.destroy();
  }
}

async function main(): Promise<void> {
  const requiredRoutes = [
    "/api/org/storage/objects",
    "/api/org/storage/objects/:objectKey",
    "/api/org/storage/objects/:objectKey/scan",
    "/api/org/storage/readiness",
    "/api/org/storage/probe",
  ];
  for (const path of requiredRoutes) {
    assert.ok(
      routes.some((r) => r.path === path),
      `storage route registered: ${path}`
    );
  }

  const quotaProof = deps(2);
  await assert.rejects(() =>
    createStorageObject(
      {
        organisationId: ORG,
        objectKey: `${ORG}/quota.txt`,
        contentType: "text/plain",
        body: "abc",
        actorId: "proof",
      },
      quotaProof.deps
    )
  );
  assert.equal((await quotaProof.deps.repository.listForTenant(ORG)).length, 0);

  const cleanProof = deps();
  const created = await createStorageObject(
    {
      organisationId: ORG,
      objectKey: `${ORG}/clean.txt`,
      contentType: "text/plain",
      body: "clean body",
      actorId: "proof",
    },
    cleanProof.deps
  );
  assert.equal(created.scanState, "quarantined");
  await assert.rejects(() =>
    getStorageObjectDownloadUrl(ORG, `${ORG}/clean.txt`, 60, cleanProof.deps)
  );
  const clean = await scanStorageObject(ORG, `${ORG}/clean.txt`, "scanner", cleanProof.deps);
  assert.equal(clean?.scanState, "clean");
  assert.match(
    (await getStorageObjectDownloadUrl(ORG, `${ORG}/clean.txt`, 60, cleanProof.deps))?.url ?? "",
    /^memory:\/\//
  );

  const rejectedProof = deps();
  await createStorageObject(
    {
      organisationId: ORG,
      objectKey: `${ORG}/eicar.txt`,
      contentType: "text/plain",
      body: "EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
      actorId: "proof",
    },
    rejectedProof.deps
  );
  const rejected = await scanStorageObject(ORG, `${ORG}/eicar.txt`, "scanner", rejectedProof.deps);
  assert.equal(rejected?.scanState, "rejected");
  await assert.rejects(() =>
    getStorageObjectDownloadUrl(ORG, `${ORG}/eicar.txt`, 60, rejectedProof.deps)
  );
  assert.equal(rejectedProof.auditEvents.at(-1)?.action, AuditAction.StorageObjectRejected);

  cleanProof.hold(`${ORG}/clean.txt`);
  await assert.rejects(() =>
    deleteStorageObject(ORG, `${ORG}/clean.txt`, "proof", cleanProof.deps)
  );

  const clamav = new ClamAvAdapter({
    ...loadClamAvConfig(),
  });
  assert.deepEqual(await clamav.healthCheck(), {
    status: "ready",
    provider: "clamav-antivirus",
  });
  assert.match(clamav.recoveryAction(), /operator recovery/);
  assert.equal(
    (
      await clamav.scan({
        objectKey: `${ORG}/clamav-clean.txt`,
        body: Buffer.from("clean body"),
        contentType: "text/plain",
      })
    ).verdict,
    "clean"
  );
  assert.equal(
    (
      await clamav.scan({
        objectKey: `${ORG}/clamav-eicar.txt`,
        body: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
        contentType: "text/plain",
      })
    ).verdict,
    "rejected"
  );
  await assert.rejects(
    () =>
      new ClamAvAdapter({
        host: "127.0.0.1",
        port: 1,
        timeoutMs: 25,
        retryAttempts: 0,
      }).scan({
        objectKey: `${ORG}/clamav-unavailable.txt`,
        body: Buffer.from("clean body"),
        contentType: "text/plain",
      }),
    /fail-closed/
  );
  await checkLiveMinioObjectFlow(clamav);

  console.log(
    JSON.stringify(
      {
        capability: "V1C-15",
        result: "PASSED",
        routes: requiredRoutes,
        semantics: [
          "quota blocks before write",
          "upload quarantines",
          "download URL blocked until clean",
          "scan promotes clean",
          "scan rejects EICAR signature",
          "legal hold blocks deletion",
          "ClamAV adapter returns clean/rejected verdicts",
          "ClamAV readiness probe returns ready",
          "ClamAV unavailable provider path fails closed",
          "live MinIO object CRUD + ClamAV scan flow passes",
        ],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
