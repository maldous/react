import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EntitlementKey } from "@platform/contracts-admin";
import {
  listMyEntitlements,
  listTenantEntitlements,
  lookupTenants,
  setTenantEntitlement,
} from "./admin-entitlements-client";

export const myEntitlementsKey = ["admin", "entitlements", "self"] as const;
export const tenantEntitlementsKey = (tenantId: string) =>
  ["admin", "entitlements", "tenant", tenantId] as const;

/** System-operator tenant lookup for the console picker. */
export function useTenantLookup() {
  return useQuery({
    queryKey: ["admin", "tenant-lookup"] as const,
    queryFn: () => lookupTenants(),
    retry: false,
  });
}

/** Tenant self-read of own entitlements (read-only view). */
export function useMyEntitlements() {
  return useQuery({
    queryKey: myEntitlementsKey,
    queryFn: listMyEntitlements,
    retry: false,
  });
}

/** Operator read of a specific tenant's entitlements (enabled once a tenant id is set). */
export function useTenantEntitlements(tenantId: string) {
  return useQuery({
    queryKey: tenantEntitlementsKey(tenantId),
    queryFn: () => listTenantEntitlements(tenantId),
    enabled: tenantId.length > 0,
    retry: false,
  });
}

/** Operator grant/revoke. Invalidates the tenant list + any open audit panel (ADR-0040). */
export function useSetEntitlement(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: EntitlementKey; state: "granted" | "revoked"; note?: string }) =>
      setTenantEntitlement(tenantId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantEntitlementsKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
