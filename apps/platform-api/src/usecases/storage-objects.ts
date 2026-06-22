import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import type { ObjectStoragePort } from "@platform/storage-runtime";
import { type AuditEventPort, AuditAction, createAuditEvent } from "@platform/audit-events";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import { type QuotaDeps, assertQuotaWithDelta } from "./quota.ts";
import type { LegalHoldGuard } from "./legal-hold.ts";
import type { AntivirusPort } from "../ports/antivirus.ts";
import type { StorageObjectRepository, StorageObjectScanState } from "../ports/storage-objects.ts";

const log = createLogger({
  name: "storage-objects",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("storage-objects");
const storageObjectMetrics = new Map<string, number>();

function recordStorageObjectMetric(operation: string, outcome: "success" | "error"): void {
  const key = `${operation}:${outcome}`;
  storageObjectMetrics.set(key, (storageObjectMetrics.get(key) ?? 0) + 1);
}

export function getStorageObjectMetric(operation: string, outcome: "success" | "error"): number {
  return storageObjectMetrics.get(`${operation}:${outcome}`) ?? 0;
}

async function withStorageObjectSpan<T>(
  operation: string,
  organisationId: string,
  objectKey: string,
  run: () => Promise<T>
): Promise<T> {
  return withSpan(
    tracer,
    `storage-objects.${operation}`,
    async () => {
      try {
        const result = await run();
        recordStorageObjectMetric(operation, "success");
        log.info({ operation, organisationId, objectKey }, "storage_object.operation.complete");
        return result;
      } catch (err) {
        recordStorageObjectMetric(operation, "error");
        log.error({ err, operation, organisationId, objectKey }, "storage_object.operation.failed");
        throw err;
      }
    },
    { "storage.operation": operation, "storage.tenant": organisationId }
  );
}

export interface StorageObjectsDeps {
  repository: StorageObjectRepository;
  storage: ObjectStoragePort;
  quotas: QuotaDeps;
  audit: AuditEventPort;
  legalHoldGuard: LegalHoldGuard;
  antivirus: AntivirusPort;
}

async function readObjectBody(body: ReadableStream | AsyncIterable<unknown>): Promise<Buffer> {
  if (!("getReader" in body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function createStorageObject(
  input: {
    organisationId: string;
    objectKey: string;
    contentType: string;
    body: string;
    actorId: string;
  },
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("create", input.organisationId, input.objectKey, async () => {
    if (!input.objectKey.startsWith(`${input.organisationId}/`))
      throw new ValidationError("invalid key");
    const sizeBytes = Buffer.byteLength(input.body);
    // Quota-before-write is enforced before repository creation or object upload.
    await assertQuotaWithDelta(input.organisationId, "storage.bytes", sizeBytes, deps.quotas);
    const record = await deps.repository.create({
      organisationId: input.organisationId,
      objectKey: input.objectKey,
      contentType: input.contentType,
      sizeBytes,
      createdBy: input.actorId,
    });
    await deps.storage.put({
      key: input.objectKey,
      body: input.body,
      contentType: input.contentType,
      metadata: { scanState: "quarantined" },
    });
    await deps.repository.setScanState(input.organisationId, input.objectKey, "quarantined");
    await deps.quotas.metering.record({
      organisationId: input.organisationId,
      meterKey: "storage.bytes",
      quantity: sizeBytes,
      idempotencyKey: `storage-object:${record.objectId}`,
      subjectId: input.objectKey,
      source: "storage-objects",
      metadata: { contentType: input.contentType },
    });
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actorId,
        actorRoles: [],
        tenantId: input.organisationId,
        action: AuditAction.StorageObjectCreated,
        resource: "storage_object",
        resourceId: input.objectKey,
        metadata: { sizeBytes, scanState: "quarantined" },
      })
    );
    return deps.repository.get(input.organisationId, input.objectKey) ?? record;
  });
}

export async function scanStorageObject(
  organisationId: string,
  objectKey: string,
  actorId: string,
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("scan", organisationId, objectKey, async () => {
    const rec = await deps.repository.get(organisationId, objectKey);
    if (!rec) return null;
    await deps.repository.setScanState(organisationId, objectKey, "scanning");
    const obj = await deps.storage.get(objectKey);
    if (!obj) {
      return deps.repository.setScanState(organisationId, objectKey, "quarantined");
    }
    let verdict: Extract<StorageObjectScanState, "clean" | "rejected">;
    let reason: string | undefined;
    try {
      const scan = await deps.antivirus.scan({
        objectKey,
        body: await readObjectBody(obj.body),
        contentType: obj.contentType,
      });
      verdict = scan.verdict;
      reason = scan.reason;
    } catch (err) {
      await deps.repository.setScanState(organisationId, objectKey, "quarantined");
      throw new ForbiddenError("api.error.objectScanUnavailable", {
        safeDetails: { objectKey, state: "quarantined" },
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    const updated = await deps.repository.setScanState(organisationId, objectKey, verdict);
    await deps.storage.put({
      key: objectKey,
      body: await readObjectBody((await deps.storage.get(objectKey))!.body),
      contentType: obj.contentType,
      metadata: { ...obj.metadata, scanState: verdict, ...(reason ? { scanReason: reason } : {}) },
    });
    await deps.audit.emit(
      createAuditEvent({
        actorId,
        actorRoles: [],
        tenantId: organisationId,
        action:
          verdict === "clean"
            ? AuditAction.StorageObjectScanClean
            : AuditAction.StorageObjectRejected,
        resource: "storage_object",
        resourceId: objectKey,
        metadata: { verdict, ...(reason ? { reason } : {}) },
      })
    );
    return updated;
  });
}

export async function markStorageObjectScanned(
  organisationId: string,
  objectKey: string,
  state: Extract<StorageObjectScanState, "clean" | "rejected">,
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("mark-scanned", organisationId, objectKey, () =>
    deps.repository.setScanState(organisationId, objectKey, state)
  );
}

export async function getStorageObject(
  organisationId: string,
  objectKey: string,
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("download", organisationId, objectKey, async () => {
    const rec = await deps.repository.get(organisationId, objectKey);
    if (!rec) return null;
    if (rec.scanState !== "clean") throw new ForbiddenError("api.error.objectNotClean");
    return deps.storage.get(objectKey);
  });
}

export async function getStorageObjectDownloadUrl(
  organisationId: string,
  objectKey: string,
  expiresInSeconds: number,
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("signedUrl", organisationId, objectKey, async () => {
    const rec = await deps.repository.get(organisationId, objectKey);
    if (!rec) return null;
    if (rec.scanState !== "clean") throw new ForbiddenError("api.error.objectNotClean");
    return {
      objectKey,
      url: await deps.storage.getPresignedUrl({ key: objectKey, expiresInSeconds }),
      expiresInSeconds,
    };
  });
}

export async function deleteStorageObject(
  organisationId: string,
  objectKey: string,
  actorId: string,
  deps: StorageObjectsDeps
) {
  return withStorageObjectSpan("delete", organisationId, objectKey, async () => {
    await deps.legalHoldGuard.assertCanDelete(organisationId, "object_storage", objectKey);
    await deps.storage.delete(objectKey);
    await deps.repository.delete(organisationId, objectKey);
    await deps.audit.emit(
      createAuditEvent({
        actorId,
        actorRoles: [],
        tenantId: organisationId,
        action: AuditAction.StorageObjectDeleted,
        resource: "storage_object",
        resourceId: objectKey,
        metadata: {},
      })
    );
  });
}
