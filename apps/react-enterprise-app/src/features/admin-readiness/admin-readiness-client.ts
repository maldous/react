import type { TenantReadinessResponse } from "@platform/contracts-admin";
import { adminGet } from "../admin/admin-fetch";

export type { TenantReadinessResponse };

/** Enterprise control-plane capability map + tenant readiness (ADR-0045). */
export function getTenantReadiness(): Promise<TenantReadinessResponse> {
  return adminGet<TenantReadinessResponse>("/api/org/readiness");
}
