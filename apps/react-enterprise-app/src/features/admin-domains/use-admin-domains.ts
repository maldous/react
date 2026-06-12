import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTenantDomainRequest } from "@platform/contracts-admin";
import {
  listDomains,
  createDomain,
  verifyDomain,
  removeDomain,
  getDomainsReadiness,
  activateDomain,
  deactivateDomain,
  probeDomainRoutingLocal,
  setCanonicalDomain,
  unsetCanonicalDomain,
} from "./admin-domains-client";

export const domainsQueryKey = ["admin", "domains"] as const;
export const domainsReadinessQueryKey = ["admin", "domains", "readiness"] as const;

export function useDomains() {
  return useQuery({ queryKey: domainsQueryKey, queryFn: listDomains, retry: false });
}

export function useDomainsReadiness() {
  return useQuery({
    queryKey: domainsReadinessQueryKey,
    queryFn: getDomainsReadiness,
    retry: false,
  });
}

export function useAddDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantDomainRequest) => createDomain(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsQueryKey });
      void queryClient.invalidateQueries({ queryKey: domainsReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useVerifyDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => verifyDomain(domain),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsQueryKey });
      void queryClient.invalidateQueries({ queryKey: domainsReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useRemoveDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => removeDomain(domain),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsQueryKey });
      void queryClient.invalidateQueries({ queryKey: domainsReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

function useDomainLifecycleMutation<TResult>(fn: (domain: string) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsQueryKey });
      void queryClient.invalidateQueries({ queryKey: domainsReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useActivateDomain() {
  return useDomainLifecycleMutation(activateDomain);
}

export function useDeactivateDomain() {
  return useDomainLifecycleMutation(deactivateDomain);
}

export function useProbeDomainRoutingLocal() {
  return useDomainLifecycleMutation(probeDomainRoutingLocal);
}

export function useSetCanonicalDomain() {
  return useDomainLifecycleMutation(setCanonicalDomain);
}

export function useUnsetCanonicalDomain() {
  return useDomainLifecycleMutation(unsetCanonicalDomain);
}
