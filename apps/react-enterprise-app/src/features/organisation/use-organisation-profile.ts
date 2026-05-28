import { useQuery } from "@tanstack/react-query";
import { fetchOrganisationProfile } from "./organisation-client";

export const organisationProfileQueryKey = ["organisation", "profile"] as const;

export function useOrganisationProfile() {
  return useQuery({
    queryKey: organisationProfileQueryKey,
    queryFn: fetchOrganisationProfile,
    staleTime: 30_000,
    retry: false,
  });
}
