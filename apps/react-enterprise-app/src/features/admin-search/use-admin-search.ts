import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SearchRequest } from "@platform/contracts-admin";
import { getSearchReadiness, reindexTenantSearch, runSearch } from "./admin-search-client";

export const searchReadinessKey = ["admin", "search", "readiness"] as const;

export function useSearchReadiness(enabled: boolean) {
  return useQuery({
    queryKey: searchReadinessKey,
    queryFn: getSearchReadiness,
    enabled,
    retry: false,
  });
}

export function useRunSearch() {
  return useMutation({ mutationFn: (input: SearchRequest) => runSearch(input) });
}

export function useReindexSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => reindexTenantSearch(tenantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: searchReadinessKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
