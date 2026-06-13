import { useQuery } from "@tanstack/react-query";
import { getClickthroughServices } from "./admin-clickthrough-client";

export const clickthroughServicesQueryKey = ["admin", "clickthrough"] as const;

export function useClickthroughServices() {
  return useQuery({
    queryKey: clickthroughServicesQueryKey,
    queryFn: getClickthroughServices,
    retry: false,
  });
}
