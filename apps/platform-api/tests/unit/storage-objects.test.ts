import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { createStorageObject, getStorageObject } from "../../src/usecases/storage-objects.ts";

type Repo = {
  listForTenant: () => Promise<unknown[]>;
  get: () => Promise<{
    objectId: string;
    organisationId: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    scanState: "uploaded" | "quarantined" | "scanning" | "clean" | "rejected";
    createdAt: null;
    updatedAt: null;
  }>;
  create: (input: {
    organisationId: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    createdBy: string;
  }) => Promise<{
    objectId: string;
    organisationId: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    scanState: "uploaded";
    createdAt: null;
    updatedAt: null;
  }>;
  setScanState: (
    _o: string,
    _k: string,
    state: "uploaded" | "quarantined" | "scanning" | "clean" | "rejected"
  ) => Promise<{
    objectId: string;
    organisationId: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    scanState: "uploaded" | "quarantined" | "scanning" | "clean" | "rejected";
    createdAt: null;
    updatedAt: null;
  }>;
  delete: () => Promise<void>;
};

describe("storage objects", () => {
  it("creates then blocks download until clean", async () => {
    const repo = {
      listForTenant: async () => [],
      get: async () => ({
        objectId: "o1",
        organisationId: "org-1",
        objectKey: "org-1/file.txt",
        contentType: "text/plain",
        sizeBytes: 3,
        scanState: "uploaded",
        createdAt: null,
        updatedAt: null,
      }),
      create: async (input: {
        organisationId: string;
        objectKey: string;
        contentType: string;
        sizeBytes: number;
        createdBy: string;
      }) => ({
        objectId: "o1",
        organisationId: input.organisationId,
        objectKey: input.objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        scanState: "uploaded",
        createdAt: null,
        updatedAt: null,
      }),
      setScanState: async (
        _o: string,
        _k: string,
        state: "uploaded" | "quarantined" | "scanning" | "clean" | "rejected"
      ) => ({
        objectId: "o1",
        organisationId: "org-1",
        objectKey: "org-1/file.txt",
        contentType: "text/plain",
        sizeBytes: 3,
        scanState: state,
        createdAt: null,
        updatedAt: null,
      }),
      delete: async () => {},
    };
    const storage = createInMemoryObjectStoragePort();
    await createStorageObject(
      {
        organisationId: "org-1",
        objectKey: "org-1/file.txt",
        contentType: "text/plain",
        body: "abc",
        actorId: "u1",
      },
      {
        repository: repo as Repo,
        storage,
        quotas: {
          quota: { listQuotas: async () => [] },
          metering: { listUsage: async () => [] },
          entitlements: { listEntitlements: async () => [] },
          audit: { emit: async () => undefined },
        } as never,
      }
    );
    await assert.rejects(() =>
      getStorageObject("org-1", "org-1/file.txt", {
        repository: repo as Repo,
        storage,
        quotas: {
          quota: { listQuotas: async () => [] },
          metering: { listUsage: async () => [] },
          entitlements: { listEntitlements: async () => [] },
          audit: { emit: async () => undefined },
        } as never,
      })
    );
  });
});
