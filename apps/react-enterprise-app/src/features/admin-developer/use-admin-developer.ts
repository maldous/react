import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateApiKeyRequest, SetRateLimitRequest } from "@platform/contracts-admin";
import {
  createMyApiKey,
  getDeveloperPortal,
  listMyApiKeys,
  listMyRateLimits,
  listTenantApiKeys,
  listTenantRateLimits,
  revokeMyApiKey,
  setTenantRateLimit,
} from "./admin-developer-client";

export const developerPortalKey = ["admin", "developer", "portal"] as const;
export const myApiKeysKey = ["admin", "api-keys", "self"] as const;
export const myRateLimitsKey = ["admin", "rate-limits", "self"] as const;
export const tenantApiKeysKey = (id: string) => ["admin", "api-keys", "tenant", id] as const;
export const tenantRateLimitsKey = (id: string) => ["admin", "rate-limits", "tenant", id] as const;

export function useDeveloperPortal() {
  return useQuery({ queryKey: developerPortalKey, queryFn: getDeveloperPortal, retry: false });
}
export function useMyApiKeys() {
  return useQuery({ queryKey: myApiKeysKey, queryFn: listMyApiKeys, retry: false });
}
export function useMyRateLimits() {
  return useQuery({ queryKey: myRateLimitsKey, queryFn: listMyRateLimits, retry: false });
}
export function useTenantApiKeys(tenantId: string) {
  return useQuery({
    queryKey: tenantApiKeysKey(tenantId),
    queryFn: () => listTenantApiKeys(tenantId),
    enabled: tenantId.length > 0,
    retry: false,
  });
}
export function useTenantRateLimits(tenantId: string) {
  return useQuery({
    queryKey: tenantRateLimitsKey(tenantId),
    queryFn: () => listTenantRateLimits(tenantId),
    enabled: tenantId.length > 0,
    retry: false,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyRequest) => createMyApiKey(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myApiKeysKey });
      void queryClient.invalidateQueries({ queryKey: developerPortalKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => revokeMyApiKey(keyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myApiKeysKey });
      void queryClient.invalidateQueries({ queryKey: developerPortalKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useSetRateLimit(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetRateLimitRequest) => setTenantRateLimit(tenantId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantRateLimitsKey(tenantId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
