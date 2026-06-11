import { useQuery } from "@tanstack/react-query";
import type { AuditResource } from "@platform/contracts-admin";
import { listAudit } from "./audit-client";

/** Contextual audit query. Key is prefixed ["admin","audit"] so any admin mutation can
 * invalidate every open audit panel by that prefix. */
export function useAudit(
  params: { resource: AuditResource; resourceId?: string; action?: string },
  enabled = true
) {
  return useQuery({
    queryKey: [
      "admin",
      "audit",
      params.resource,
      params.resourceId ?? null,
      params.action ?? null,
    ] as const,
    queryFn: () => listAudit({ ...params, limit: 20 }),
    enabled,
    retry: false,
  });
}
