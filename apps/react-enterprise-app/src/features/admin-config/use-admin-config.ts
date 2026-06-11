import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listConfig, setConfigValue, clearConfigValue } from "./admin-config-client";

export const adminConfigQueryKey = ["admin", "config"] as const;

export function useConfig() {
  return useQuery({ queryKey: adminConfigQueryKey, queryFn: () => listConfig(), retry: false });
}

function useInvalidateConfig() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminConfigQueryKey });
}

export function useSetConfigValue() {
  const invalidate = useInvalidateConfig();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => setConfigValue(key, value),
    onSuccess: () => void invalidate(),
  });
}

export function useClearConfigValue() {
  const invalidate = useInvalidateConfig();
  return useMutation({
    mutationFn: (key: string) => clearConfigValue(key),
    onSuccess: () => void invalidate(),
  });
}
