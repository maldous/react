import { useQuery } from "@tanstack/react-query";
import { getTenantReadiness } from "./admin-readiness-client";

export const readinessQueryKey = ["admin", "readiness"] as const;

export function useTenantReadiness() {
  return useQuery({ queryKey: readinessQueryKey, queryFn: getTenantReadiness, retry: false });
}
