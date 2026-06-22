import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import { createInMemoryObjectStoragePort } from "@platform/storage-runtime";
import { ForbiddenError } from "@platform/platform-errors";
import {
  createStorageObject,
  deleteStorageObject,
  getStorageObject,
  getStorageObjectDownloadUrl,
  scanStorageObject,
} from "../../src/usecases/storage-objects.ts";
import { LegalHoldGuard } from "../../src/usecases/legal-hold.ts";
import { StubAntivirusPort, type AntivirusPort } from "../../src/ports/antivirus.ts";
import type {
  CreateStorageObjectInput,
  StorageObjectRecord,
  StorageObjectRepository,
  StorageObjectScanState,
} from "../../src/ports/storage-objects.ts";
import type { QuotaDeps } from "../../src/usecases/quota.ts";

const ORG = "org-1";

class MemoryStorageObjectRepository implements StorageObjectRepository {
  private rows = new Map<string, StorageObjectRecord>();

  private key(organisationId: string, objectKey: string) {
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
    if (!rec) throw new Error("not_found");
    const next = { ...rec, scanState: state };
    this.rows.set(this.key(organisationId, objectKey), next);
    return next;
  }

  async delete(organisationId: string, objectKey: string): Promise<void> {
    this.rows.delete(this.key(organisationId, objectKey));
  }
}

function captureAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

function quotaDeps(limit = 100, usage = 0): QuotaDeps {
  let recorded = usage;
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
        recorded += input.quantity;
        return { recorded: true, deduplicated: false };
      },
      aggregate: async () => recorded,
      aggregateAsOperator: async () => recorded,
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
    audit: captureAudit().port,
  };
}

function deps(
  options: { quotaLimit?: number; quotaUsage?: number; antivirus?: AntivirusPort } = {}
) {
  const audit = captureAudit();
  const held = new Set<string>();
  return {
    deps: {
      repository: new MemoryStorageObjectRepository(),
      storage: createInMemoryObjectStoragePort(),
      quotas: quotaDeps(options.quotaLimit, options.quotaUsage),
      audit: audit.port,
      legalHoldGuard: new LegalHoldGuard({
        repository: {
          isActive: async (_organisationId, _resourceTable, rowId) => held.has(rowId),
        },
      }),
      antivirus: options.antivirus ?? new StubAntivirusPort(),
    },
    audit,
    hold: (objectKey: string) => held.add(objectKey),
  };
}

describe("storage objects", () => {
  it("enforces storage byte quota before upload", async () => {
    const ctx = deps({ quotaLimit: 2 });
    await assert.rejects(
      () =>
        createStorageObject(
          {
            organisationId: ORG,
            objectKey: `${ORG}/file.txt`,
            contentType: "text/plain",
            body: "abc",
            actorId: "u1",
          },
          ctx.deps
        ),
      /api.error.quotaExceeded/
    );
    assert.equal((await ctx.deps.repository.listForTenant(ORG)).length, 0);
  });

  it("quarantines upload, blocks download until clean, then returns a signed URL", async () => {
    const ctx = deps();
    const created = await createStorageObject(
      {
        organisationId: ORG,
        objectKey: `${ORG}/file.txt`,
        contentType: "text/plain",
        body: "abc",
        actorId: "u1",
      },
      ctx.deps
    );
    assert.equal(created.scanState, "quarantined");
    await assert.rejects(
      () => getStorageObject(ORG, `${ORG}/file.txt`, ctx.deps),
      /api.error.objectNotClean/
    );

    const scanned = await scanStorageObject(ORG, `${ORG}/file.txt`, "scanner", ctx.deps);
    assert.equal(scanned?.scanState, "clean");
    const url = await getStorageObjectDownloadUrl(ORG, `${ORG}/file.txt`, 60, ctx.deps);
    assert.match(url?.url ?? "", /^memory:\/\/org-1\/file.txt/);
    assert.equal(ctx.audit.events.at(-1)?.action, AuditAction.StorageObjectScanClean);
  });

  it("withholds rejected objects and audits the rejection", async () => {
    const ctx = deps();
    await createStorageObject(
      {
        organisationId: ORG,
        objectKey: `${ORG}/eicar.txt`,
        contentType: "text/plain",
        body: "EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
        actorId: "u1",
      },
      ctx.deps
    );
    const scanned = await scanStorageObject(ORG, `${ORG}/eicar.txt`, "scanner", ctx.deps);
    assert.equal(scanned?.scanState, "rejected");
    await assert.rejects(
      () => getStorageObjectDownloadUrl(ORG, `${ORG}/eicar.txt`, 60, ctx.deps),
      /api.error.objectNotClean/
    );
    assert.equal(ctx.audit.events.at(-1)?.action, AuditAction.StorageObjectRejected);
  });

  it("fails closed when the scanner is unavailable", async () => {
    const ctx = deps({
      antivirus: {
        scan: async () => {
          throw new Error("clamd unavailable");
        },
      },
    });
    await createStorageObject(
      {
        organisationId: ORG,
        objectKey: `${ORG}/held.txt`,
        contentType: "text/plain",
        body: "abc",
        actorId: "u1",
      },
      ctx.deps
    );
    await assert.rejects(
      () => scanStorageObject(ORG, `${ORG}/held.txt`, "scanner", ctx.deps),
      /api.error.objectScanUnavailable/
    );
    assert.equal((await ctx.deps.repository.get(ORG, `${ORG}/held.txt`))?.scanState, "quarantined");
  });

  it("honours legal hold before lifecycle deletion", async () => {
    const ctx = deps();
    await createStorageObject(
      {
        organisationId: ORG,
        objectKey: `${ORG}/legal.txt`,
        contentType: "text/plain",
        body: "abc",
        actorId: "u1",
      },
      ctx.deps
    );
    ctx.hold(`${ORG}/legal.txt`);
    await assert.rejects(
      () => deleteStorageObject(ORG, `${ORG}/legal.txt`, "u1", ctx.deps),
      ForbiddenError
    );
    assert.ok(await ctx.deps.repository.get(ORG, `${ORG}/legal.txt`));
  });
});
