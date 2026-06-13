// Typed REST client for the entitlement admin surface (ADR-0036 / ADR-ACT-0254).
// REST-over-BFF: goes through adminGet/adminSend; the SPA never bypasses the BFF
// and never infers entitlement state locally — the server is authoritative.

import type {
  EntitlementKey,
  EntitlementListResponse,
  EntitlementSummary,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { EntitlementListResponse, EntitlementSummary, EntitlementKey };

/** Tenant read of its own entitlements (FQDN/session, read-only). */
export function listMyEntitlements(): Promise<EntitlementListResponse> {
  return adminGet<EntitlementListResponse>("/api/org/entitlements");
}

/** System-operator read of a specific tenant's entitlements. */
export function listTenantEntitlements(tenantId: string): Promise<EntitlementListResponse> {
  return adminGet<EntitlementListResponse>(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/entitlements`
  );
}

/** System-operator grant/revoke (audited server-side; tenants can never self-grant). */
export function setTenantEntitlement(
  tenantId: string,
  input: { key: EntitlementKey; state: "granted" | "revoked"; note?: string }
): Promise<{ entitlement: EntitlementSummary }> {
  return adminSend<{ entitlement: EntitlementSummary }>(
    "PATCH",
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/entitlements`,
    input
  );
}
