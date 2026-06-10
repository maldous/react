import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listFeatures, toggleFeature, type FeatureSummary } from "./admin-features-client";

export const adminFeaturesQueryKey = ["admin", "features"] as const;

export function useFeatures() {
  return useQuery({
    queryKey: adminFeaturesQueryKey,
    queryFn: listFeatures,
    retry: false,
  });
}

export function useToggleFeature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: FeatureSummary["key"]; enabled: boolean }) =>
      toggleFeature(key, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminFeaturesQueryKey });
    },
  });
}
