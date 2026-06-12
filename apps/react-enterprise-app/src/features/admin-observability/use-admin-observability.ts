import { useQuery } from "@tanstack/react-query";
import { getObservabilityReadiness } from "./admin-observability-client";

export const observabilityReadinessQueryKey = ["admin", "observability", "readiness"] as const;

export function useObservabilityReadiness() {
  return useQuery({
    queryKey: observabilityReadinessQueryKey,
    queryFn: getObservabilityReadiness,
    retry: false,
  });
}
