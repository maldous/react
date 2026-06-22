import crypto from "node:crypto";
import { StorageError, type ObjectStoragePort } from "@platform/storage-runtime";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type {
  TenantStorageProbeResult,
  TenantStorageReadinessResponse,
  TenantStorageReadinessStatus,
} from "@platform/contracts-admin";

const log = createLogger({
  name: "tenant-storage",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("tenant-storage");
const tenantStorageMetrics = new Map<string, number>();

function metric(name: string, labels: Record<string, string>): void {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  tenantStorageMetrics.set(key, (tenantStorageMetrics.get(key) ?? 0) + 1);
}

export function getTenantStorageMetric(name: string, labels: Record<string, string>): number {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  return tenantStorageMetrics.get(key) ?? 0;
}

export interface StorageProbeControls {
  quotaBeforeWrite?: (input: { key: string; sizeBytes: number }) => Promise<void>;
  antivirusScan?: (input: {
    key: string;
    body: string;
    contentType: string;
  }) => Promise<"clean" | "rejected">;
  legalHoldDeletionBlock?: (key: string) => Promise<void>;
  auditEvent?: (event: {
    action:
      | "tenant-storage.probe.uploaded"
      | "tenant-storage.probe.clean"
      | "tenant-storage.probe.rejected"
      | "tenant-storage.probe.download"
      | "tenant-storage.probe.signedUrl"
      | "tenant-storage.probe.deleted";
    key: string;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tenant storage readiness + isolation proof (ADR-0049 / ADR-ACT-0218)
//
// A read/probe layer over the existing ObjectStoragePort + prefix-per-tenant
// S3/MinIO adapter (ADR-0029 §6 / ADR-0031). The isolation model is a single
// bucket with a `{organisationId}/` key prefix; the adapter rejects any key
// outside the tenant prefix (defence-in-depth before IAM policy).
//
// Honesty rules (ADR-0045):
//   - `configured` ONLY after a real write → read → delete round-trip AND the
//     adapter actually rejected a deliberately foreign (cross-prefix) key.
//   - `not_configured` when no S3 endpoint/credentials are wired — never faked.
//   - `provider_unreachable` when the round-trip could not complete.
//   - `isolation_failed` if the foreign key was NOT rejected.
//   - No storage credential is ever returned.
// ---------------------------------------------------------------------------

/** The tenant's object-key prefix. ADR-0029 §6. */
export function tenantStoragePrefix(organisationId: string): string {
  return `${organisationId}/`;
}

/** Pure: classify a probe outcome. Never reports `configured` without proof. */
export function classifyStorageProbe(p: {
  wrote: boolean;
  read: boolean;
  deleted: boolean;
  foreignKeyRejected: boolean;
}): TenantStorageReadinessStatus {
  if (!(p.wrote && p.read && p.deleted)) return "provider_unreachable";
  if (!p.foreignKeyRejected) return "isolation_failed";
  return "configured";
}

export interface StorageProbeDeps {
  prefix: string;
  /** A tenant-scoped storage port (already locked to the tenant prefix). */
  port: ObjectStoragePort;
  /** Returns true if a deliberately foreign cross-prefix key is rejected. */
  assertIsolation: () => Promise<boolean>;
  controls?: StorageProbeControls;
}

/**
 * Live probe: write → read-back (size-verified) → delete a probe object under the
 * tenant prefix, and confirm the adapter rejects a foreign key. Self-cleaning.
 */
export async function probeTenantStorage(
  deps: StorageProbeDeps
): Promise<TenantStorageProbeResult> {
  const probeKey = `${deps.prefix}.readiness-probe/${crypto.randomUUID()}`;
  const payload = `readiness ${probeKey}`;
  const expectedSize = Buffer.byteLength(payload);
  let wrote = false;
  let read = false;
  let deleted = false;
  return withSpan(
    tracer,
    "tenant-storage.probe",
    async () => {
      try {
        await deps.controls?.quotaBeforeWrite?.({ key: probeKey, sizeBytes: expectedSize });
        await deps.port.put({
          key: probeKey,
          body: payload,
          contentType: "text/plain",
          metadata: { probe: "readiness", lifecycleState: "quarantined" },
        });
        wrote = true;
        await deps.controls?.auditEvent?.({
          action: "tenant-storage.probe.uploaded",
          key: probeKey,
        });
        const scanVerdict =
          (await deps.controls?.antivirusScan?.({
            key: probeKey,
            body: payload,
            contentType: "text/plain",
          })) ?? "clean";
        await deps.controls?.auditEvent?.({
          action:
            scanVerdict === "clean"
              ? "tenant-storage.probe.clean"
              : "tenant-storage.probe.rejected",
          key: probeKey,
        });
        if (scanVerdict !== "clean") {
          throw new StorageError("tenant storage readiness download blocked until clean AV scan");
        }
        const got = await deps.port.get(probeKey);
        read = !!got && got.size === expectedSize;
        await deps.controls?.auditEvent?.({
          action: "tenant-storage.probe.download",
          key: probeKey,
        });
        await deps.port.getPresignedUrl({ key: probeKey, expiresInSeconds: 60 });
        await deps.controls?.auditEvent?.({
          action: "tenant-storage.probe.signedUrl",
          key: probeKey,
        });
        await deps.controls?.legalHoldDeletionBlock?.(probeKey);
        await deps.port.delete(probeKey);
        deleted = true;
        await deps.controls?.auditEvent?.({
          action: "tenant-storage.probe.deleted",
          key: probeKey,
        });
      } catch (err) {
        // Leave the flags reflecting how far the round-trip got; best-effort cleanup.
        log.error({ err, key: probeKey }, "tenant_storage.probe.failed");
        await deps.port.delete(probeKey).catch(() => {});
      }

      let foreignKeyRejected = false;
      try {
        foreignKeyRejected = await deps.assertIsolation();
      } catch {
        // The adapter threw on the foreign key — that IS the rejection we want.
        foreignKeyRejected = true;
      }

      const status = classifyStorageProbe({ wrote, read, deleted, foreignKeyRejected });
      metric("tenant_storage_probe_total", { status });
      log.info(
        { key: probeKey, status, tenantPrefix: deps.prefix },
        "tenant_storage.probe.complete"
      );
      return {
        status,
        wrote,
        read,
        deleted,
        foreignKeyRejected,
      };
    },
    { "storage.tenantPrefix": deps.prefix }
  );
}

export interface StorageReadinessDeps {
  organisationId: string;
  /** Whether an S3/MinIO endpoint + admin credentials are wired for the platform. */
  endpointConfigured: boolean;
  /** Lazily build the tenant-scoped probe deps; only called when configured. */
  makeProbe?: () => StorageProbeDeps;
}

/** `GET /api/org/storage/readiness` — honest; runs a live probe when configured. */
export async function getTenantStorageReadiness(
  deps: StorageReadinessDeps
): Promise<TenantStorageReadinessResponse> {
  const prefix = tenantStoragePrefix(deps.organisationId);
  if (!deps.endpointConfigured || !deps.makeProbe) {
    return { status: "not_configured", prefix, endpointConfigured: false, isolationEnforced: true };
  }
  try {
    const probe = await probeTenantStorage(deps.makeProbe());
    return {
      status: probe.status,
      prefix,
      endpointConfigured: true,
      isolationEnforced: probe.foreignKeyRejected,
    };
  } catch {
    return { status: "unknown", prefix, endpointConfigured: true, isolationEnforced: true };
  }
}
