import type { AuditListResponse, AuditResource } from "@platform/contracts-admin";
import { adminGet } from "./admin-fetch";

export type { AuditListResponse, AuditResource };

export function listAudit(params: {
  resource: AuditResource;
  resourceId?: string;
  action?: string;
  limit?: number;
}): Promise<AuditListResponse> {
  const q = new URLSearchParams({ resource: params.resource });
  if (params.resourceId) q.set("resourceId", params.resourceId);
  if (params.action) q.set("action", params.action);
  if (params.limit) q.set("limit", String(params.limit));
  return adminGet<AuditListResponse>(`/api/org/audit?${q.toString()}`);
}
