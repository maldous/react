import { useQuery } from "@tanstack/react-query";
import { getPlatformServicesReadiness } from "./admin-platform-client";

export const platformServicesReadinessQueryKey = ["admin", "platform", "services"] as const;

export function usePlatformServicesReadiness() {
  return useQuery({
    queryKey: platformServicesReadinessQueryKey,
    queryFn: getPlatformServicesReadiness,
    retry: false,
  });
}
