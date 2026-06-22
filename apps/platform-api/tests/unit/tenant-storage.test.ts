/**
 * Unit tests for ADR-0049 / ADR-ACT-0218 — tenant storage readiness + isolation.
 * The classifier is pure; the probe is exercised against the in-memory port double
 * with an injected isolation assertion (the real prefix guard lives in the adapter).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryObjectStoragePort, StorageError } from "@platform/storage-runtime";
import {
  classifyStorageProbe,
  getTenantStorageMetric,
  getTenantStorageReadiness,
  probeTenantStorage,
  tenantStoragePrefix,
} from "../../src/usecases/tenant-storage.ts";

describe("classifyStorageProbe (ADR-0049)", () => {
  it("configured only when round-trip succeeds AND foreign key is rejected", () => {
    assert.equal(
      classifyStorageProbe({ wrote: true, read: true, deleted: true, foreignKeyRejected: true }),
      "configured"
    );
  });
  it("isolation_failed when the foreign key is NOT rejected", () => {
    assert.equal(
      classifyStorageProbe({ wrote: true, read: true, deleted: true, foreignKeyRejected: false }),
      "isolation_failed"
    );
  });
  it("provider_unreachable when the round-trip cannot complete", () => {
    assert.equal(
      classifyStorageProbe({ wrote: false, read: false, deleted: false, foreignKeyRejected: true }),
      "provider_unreachable"
    );
    assert.equal(
      classifyStorageProbe({ wrote: true, read: false, deleted: false, foreignKeyRejected: true }),
      "provider_unreachable"
    );
  });
});

describe("tenantStoragePrefix", () => {
  it("is the organisation id with a trailing slash (ADR-0029 §6)", () => {
    assert.equal(tenantStoragePrefix("org-123"), "org-123/");
  });
});

describe("probeTenantStorage (ADR-0049)", () => {
  it("writes, reads back (size-verified), deletes, and confirms isolation → configured", async () => {
    const port = createInMemoryObjectStoragePort();
    const before = getTenantStorageMetric("tenant_storage_probe_total", { status: "configured" });
    const audit: string[] = [];
    let quotaChecked = false;
    let avScanned = false;
    let legalHoldChecked = false;
    const result = await probeTenantStorage({
      prefix: "org-1/",
      port,
      assertIsolation: async () => true,
      controls: {
        quotaBeforeWrite: async () => {
          quotaChecked = true;
        },
        antivirusScan: async () => {
          avScanned = true;
          return "clean";
        },
        legalHoldDeletionBlock: async () => {
          legalHoldChecked = true;
        },
        auditEvent: async (event) => {
          audit.push(event.action);
        },
      },
    });
    assert.equal(result.status, "configured");
    assert.ok(result.wrote && result.read && result.deleted && result.foreignKeyRejected);
    assert.equal(quotaChecked, true);
    assert.equal(avScanned, true);
    assert.equal(legalHoldChecked, true);
    assert.deepEqual(audit, [
      "tenant-storage.probe.uploaded",
      "tenant-storage.probe.clean",
      "tenant-storage.probe.download",
      "tenant-storage.probe.signedUrl",
      "tenant-storage.probe.deleted",
    ]);
    assert.equal(
      getTenantStorageMetric("tenant_storage_probe_total", { status: "configured" }),
      before + 1
    );
    // self-cleaning: nothing left behind under the prefix.
    assert.equal((await port.list("org-1/")).length, 0);
  });

  it("reports provider_unreachable when AV rejects so download remains blocked until clean", async () => {
    const result = await probeTenantStorage({
      prefix: "org-1/",
      port: createInMemoryObjectStoragePort(),
      assertIsolation: async () => true,
      controls: {
        antivirusScan: async () => "rejected",
      },
    });
    assert.equal(result.status, "provider_unreachable");
    assert.equal(result.wrote, true);
    assert.equal(result.read, false);
    assert.equal(result.deleted, false);
  });

  it("reports isolation_failed when the adapter does not reject a foreign key", async () => {
    const result = await probeTenantStorage({
      prefix: "org-1/",
      port: createInMemoryObjectStoragePort(),
      assertIsolation: async () => false,
    });
    assert.equal(result.status, "isolation_failed");
    assert.equal(result.foreignKeyRejected, false);
  });

  it("reports provider_unreachable when the store throws on write", async () => {
    const failing = createInMemoryObjectStoragePort();
    failing.put = async () => {
      throw new StorageError("connect ECONNREFUSED");
    };
    const result = await probeTenantStorage({
      prefix: "org-1/",
      port: failing,
      assertIsolation: async () => true,
    });
    assert.equal(result.status, "provider_unreachable");
    assert.equal(result.wrote, false);
  });

  it("treats a throwing isolation assertion as a rejection (the guard fired)", async () => {
    const result = await probeTenantStorage({
      prefix: "org-1/",
      port: createInMemoryObjectStoragePort(),
      assertIsolation: async () => {
        throw new StorageError("Cross-tenant storage access rejected");
      },
    });
    assert.equal(result.foreignKeyRejected, true);
    assert.equal(result.status, "configured");
  });
});

describe("getTenantStorageReadiness (ADR-0049)", () => {
  it("not_configured when no S3 endpoint/credentials are wired — never faked", async () => {
    const r = await getTenantStorageReadiness({
      organisationId: "org-9",
      endpointConfigured: false,
    });
    assert.equal(r.status, "not_configured");
    assert.equal(r.endpointConfigured, false);
    assert.equal(r.prefix, "org-9/");
    assert.equal(r.isolationEnforced, true);
  });

  it("runs the live probe when configured → configured + isolation enforced", async () => {
    const r = await getTenantStorageReadiness({
      organisationId: "org-9",
      endpointConfigured: true,
      makeProbe: () => ({
        prefix: "org-9/",
        port: createInMemoryObjectStoragePort(),
        assertIsolation: async () => true,
      }),
    });
    assert.equal(r.status, "configured");
    assert.equal(r.endpointConfigured, true);
    assert.equal(r.isolationEnforced, true);
  });
});
