import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SetQuotaRequest } from "@platform/contracts-admin";
import {
  listMyQuotas,
  listMyUsage,
  listTenantQuotas,
  listTenantUsage,
  setTenantQuota,
} from "./admin-usage-client";

export const myUsageKey = ["admin", "usage", "self"] as const;
export const myQuotasKey = ["admin", "quotas", "self"] as const;
export const tenantUsageKey = (id: string) => ["admin", "usage", "tenant", id] as const;
export const tenantQuotasKey = (id: string) => ["admin", "quotas", "tenant", id] as const;

export function useMyUsage() {
  return useQuery({ queryKey: myUsageKey, queryFn: listMyUsage, retry: false });
}
export function useMyQuotas() {
  return useQuery({ queryKey: myQuotasKey, queryFn: listMyQuotas, retry: false });
}
export function useTenantUsage(tenantId: string) {
  return useQuery({
    queryKey: tenantUsageKey(tenantId),
    queryFn: () => listTenantUsage(tenantId),
    enabled: tenantId.length > 0,
    retry: false,
  });
}
export function useTenantQuotas(tenantId: string) {
  return useQuery({
    queryKey: tenantQuotasKey(tenantId),
    queryFn: () => listTenantQuotas(tenantId),
    enabled: tenantId.length > 0,
    retry: false,
  });
}

export function useSetQuota(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetQuotaRequest) => setTenantQuota(tenantId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantQuotasKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: tenantUsageKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
