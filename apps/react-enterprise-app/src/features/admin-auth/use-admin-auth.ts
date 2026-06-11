import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpdateTenantAuthProvidersRequest,
  SessionPolicyDto,
  MfaPolicyDto,
} from "@platform/contracts-admin";
import {
  getAuthProviders,
  setAuthProviders,
  listIdps,
  getMfaPolicy,
  setMfaPolicy,
  getSessionPolicy,
  setSessionPolicy,
  getAuthReadiness,
} from "./admin-auth-client";

export const authProvidersQueryKey = ["admin", "auth", "providers"] as const;
export const authIdpsQueryKey = ["admin", "auth", "idps"] as const;
export const authMfaQueryKey = ["admin", "auth", "mfa"] as const;
export const authSessionQueryKey = ["admin", "auth", "session"] as const;
export const authReadinessQueryKey = ["admin", "auth", "readiness"] as const;

export function useAuthProviders() {
  return useQuery({ queryKey: authProvidersQueryKey, queryFn: getAuthProviders, retry: false });
}

export function useSetAuthProviders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantAuthProvidersRequest) => setAuthProviders(input),
    onSuccess: (data) => {
      queryClient.setQueryData(authProvidersQueryKey, data);
      // Refresh the provider-config audit panel (ADR-0040).
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useIdps() {
  return useQuery({ queryKey: authIdpsQueryKey, queryFn: listIdps, retry: false });
}

export function useMfaPolicy(enabled = true) {
  return useQuery({ queryKey: authMfaQueryKey, queryFn: getMfaPolicy, retry: false, enabled });
}

export function useSetMfaPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MfaPolicyDto) => setMfaPolicy(input),
    onSuccess: (_void, input) => {
      queryClient.setQueryData(authMfaQueryKey, input);
      void queryClient.invalidateQueries({ queryKey: authReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useSessionPolicy(enabled = true) {
  return useQuery({
    queryKey: authSessionQueryKey,
    queryFn: getSessionPolicy,
    retry: false,
    enabled,
  });
}

export function useAuthReadiness() {
  return useQuery({ queryKey: authReadinessQueryKey, queryFn: getAuthReadiness, retry: false });
}

export function useSetSessionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionPolicyDto) => setSessionPolicy(input),
    onSuccess: (_void, input) => {
      // Reflect the saved values immediately, then refresh readiness + the audit
      // panel (ADR-0040): a successful write proves the credential still works.
      queryClient.setQueryData(authSessionQueryKey, input);
      void queryClient.invalidateQueries({ queryKey: authReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
