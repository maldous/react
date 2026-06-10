import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateTenantAuthProvidersRequest } from "@platform/contracts-admin";
import {
  getAuthProviders,
  setAuthProviders,
  listIdps,
  getMfaPolicy,
  getSessionPolicy,
} from "./admin-auth-client";

export const authProvidersQueryKey = ["admin", "auth", "providers"] as const;
export const authIdpsQueryKey = ["admin", "auth", "idps"] as const;
export const authMfaQueryKey = ["admin", "auth", "mfa"] as const;
export const authSessionQueryKey = ["admin", "auth", "session"] as const;

export function useAuthProviders() {
  return useQuery({ queryKey: authProvidersQueryKey, queryFn: getAuthProviders, retry: false });
}

export function useSetAuthProviders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantAuthProvidersRequest) => setAuthProviders(input),
    onSuccess: (data) => {
      queryClient.setQueryData(authProvidersQueryKey, data);
    },
  });
}

export function useIdps() {
  return useQuery({ queryKey: authIdpsQueryKey, queryFn: listIdps, retry: false });
}

export function useMfaPolicy() {
  return useQuery({ queryKey: authMfaQueryKey, queryFn: getMfaPolicy, retry: false });
}

export function useSessionPolicy() {
  return useQuery({ queryKey: authSessionQueryKey, queryFn: getSessionPolicy, retry: false });
}
