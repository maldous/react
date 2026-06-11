import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpdateTenantAuthProvidersRequest,
  SessionPolicyDto,
  MfaPolicyDto,
  CreateIdpRequest,
  UpdateIdpRequest,
  OidcDiscoverRequest,
  IdpMappingConfig,
} from "@platform/contracts-admin";
import {
  getAuthProviders,
  setAuthProviders,
  listIdps,
  createIdp,
  updateIdp,
  deleteIdp,
  getMfaPolicy,
  setMfaPolicy,
  getSessionPolicy,
  setSessionPolicy,
  getAuthReadiness,
  discoverOidc,
  getIdpCallbackUrl,
  testIdpConnection,
  getIdpMapping,
  updateIdpMapping,
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

export function useIdps(enabled = true) {
  return useQuery({ queryKey: authIdpsQueryKey, queryFn: listIdps, retry: false, enabled });
}

/** Shared invalidation after an IdP mutation: list + readiness + audit panels. */
function useIdpMutation<TArgs>(fn: (args: TArgs) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: authIdpsQueryKey });
      void queryClient.invalidateQueries({ queryKey: authReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useCreateIdp() {
  return useIdpMutation((input: CreateIdpRequest) => createIdp(input));
}

export function useUpdateIdp() {
  return useIdpMutation(({ alias, input }: { alias: string; input: UpdateIdpRequest }) =>
    updateIdp(alias, input)
  );
}

export function useDeleteIdp() {
  return useIdpMutation((alias: string) => deleteIdp(alias));
}

// --- OIDC enterprise hardening (ADR-0046) ---

export const idpMappingQueryKey = (alias: string) =>
  ["admin", "auth", "idp-mapping", alias] as const;
export const idpCallbackUrlQueryKey = (alias: string) =>
  ["admin", "auth", "idp-callback", alias] as const;

/** Discovery import is a preview/validation — it mutates nothing, so no invalidation. */
export function useDiscoverOidc() {
  return useMutation({ mutationFn: (input: OidcDiscoverRequest) => discoverOidc(input) });
}

export function useIdpCallbackUrl(alias: string | null) {
  return useQuery({
    queryKey: idpCallbackUrlQueryKey(alias ?? ""),
    queryFn: () => getIdpCallbackUrl(alias!),
    retry: false,
    enabled: !!alias,
  });
}

/** Test connection audits the result server-side; refresh the audit panel on success. */
export function useTestIdpConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alias: string) => testIdpConnection(alias),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useIdpMapping(alias: string | null) {
  return useQuery({
    queryKey: idpMappingQueryKey(alias ?? ""),
    queryFn: () => getIdpMapping(alias!),
    retry: false,
    enabled: !!alias,
  });
}

export function useUpdateIdpMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ alias, input }: { alias: string; input: IdpMappingConfig }) =>
      updateIdpMapping(alias, input),
    onSuccess: (_data, { alias }) => {
      void queryClient.invalidateQueries({ queryKey: idpMappingQueryKey(alias) });
      void queryClient.invalidateQueries({ queryKey: authReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
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
