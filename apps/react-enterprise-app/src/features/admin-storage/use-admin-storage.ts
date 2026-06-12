import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorageReadiness, runStorageProbe } from "./admin-storage-client";

export const storageReadinessQueryKey = ["admin", "storage", "readiness"] as const;

export function useStorageReadiness() {
  return useQuery({
    queryKey: storageReadinessQueryKey,
    queryFn: getStorageReadiness,
    retry: false,
  });
}

export function useRunStorageProbe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runStorageProbe,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: storageReadinessQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
