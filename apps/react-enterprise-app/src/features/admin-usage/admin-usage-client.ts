// Typed REST client for the Phase-2 usage/quota surface (ADR-0067 / ADR-ACT-0256).
// REST-over-BFF; server-authoritative. React never decides quota — it renders the
// allow/deny state the BFF returns. No secrets cross this boundary.

import type { QuotaListResponse, SetQuotaRequest, UsageResponse } from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { QuotaListResponse, UsageResponse, SetQuotaRequest };

export function listMyUsage(): Promise<UsageResponse> {
  return adminGet<UsageResponse>("/api/org/usage");
}
export function listTenantUsage(tenantId: string): Promise<UsageResponse> {
  return adminGet<UsageResponse>(`/api/admin/tenants/${encodeURIComponent(tenantId)}/usage`);
}
export function listMyQuotas(): Promise<QuotaListResponse> {
  return adminGet<QuotaListResponse>("/api/org/quotas");
}
export function listTenantQuotas(tenantId: string): Promise<QuotaListResponse> {
  return adminGet<QuotaListResponse>(`/api/admin/tenants/${encodeURIComponent(tenantId)}/quotas`);
}
export function setTenantQuota(tenantId: string, input: SetQuotaRequest): Promise<unknown> {
  return adminSend("PATCH", `/api/admin/tenants/${encodeURIComponent(tenantId)}/quotas`, input);
}
