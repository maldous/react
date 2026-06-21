import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import type { ObjectStoragePort } from "@platform/storage-runtime";
import type { QuotaDeps } from "./quota.ts";
import type { StorageObjectRepository, StorageObjectScanState } from "../ports/storage-objects.ts";

export interface StorageObjectsDeps {
  repository: StorageObjectRepository;
  storage: ObjectStoragePort;
  quotas: QuotaDeps;
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
  if (!input.objectKey.startsWith(`${input.organisationId}/`))
    throw new ValidationError("invalid key");
  const record = await deps.repository.create({
    organisationId: input.organisationId,
    objectKey: input.objectKey,
    contentType: input.contentType,
    sizeBytes: Buffer.byteLength(input.body),
    createdBy: input.actorId,
  });
  await deps.storage.put({
    key: input.objectKey,
    body: input.body,
    contentType: input.contentType,
    metadata: { scanState: "quarantined" },
  });
  await deps.repository.setScanState(input.organisationId, input.objectKey, "quarantined");
  return record;
}

export async function markStorageObjectScanned(
  organisationId: string,
  objectKey: string,
  state: Extract<StorageObjectScanState, "clean" | "rejected">,
  deps: StorageObjectsDeps
) {
  return deps.repository.setScanState(organisationId, objectKey, state);
}

export async function getStorageObject(
  organisationId: string,
  objectKey: string,
  deps: StorageObjectsDeps
) {
  const rec = await deps.repository.get(organisationId, objectKey);
  if (!rec) return null;
  if (rec.scanState !== "clean") throw new ForbiddenError("api.error.objectNotClean");
  return deps.storage.get(objectKey);
}

export async function deleteStorageObject(
  organisationId: string,
  objectKey: string,
  deps: StorageObjectsDeps
) {
  await deps.storage.delete(objectKey);
  await deps.repository.delete(organisationId, objectKey);
}
