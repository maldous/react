import crypto from "node:crypto";
import type { ObjectStoragePort } from "@platform/storage-runtime";
import type {
  TenantStorageProbeResult,
  TenantStorageReadinessResponse,
  TenantStorageReadinessStatus,
} from "@platform/contracts-admin";

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
  try {
    await deps.port.put({
      key: probeKey,
      body: payload,
      contentType: "text/plain",
      metadata: { probe: "readiness" },
    });
    wrote = true;
    const got = await deps.port.get(probeKey);
    read = !!got && got.size === expectedSize;
    await deps.port.delete(probeKey);
    deleted = true;
  } catch {
    // Leave the flags reflecting how far the round-trip got; best-effort cleanup.
    await deps.port.delete(probeKey).catch(() => {});
  }

  let foreignKeyRejected = false;
  try {
    foreignKeyRejected = await deps.assertIsolation();
  } catch {
    // The adapter threw on the foreign key — that IS the rejection we want.
    foreignKeyRejected = true;
  }

  return {
    status: classifyStorageProbe({ wrote, read, deleted, foreignKeyRejected }),
    wrote,
    read,
    deleted,
    foreignKeyRejected,
  };
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
