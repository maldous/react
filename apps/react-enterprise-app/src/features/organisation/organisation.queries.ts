import { useQuery } from "@tanstack/react-query";
import { graphqlRequest } from "@platform/graphql-browser-client";
import { OrganisationProfileDocument } from "@platform/contracts-graphql";

// Feature-owned read hooks (ADR-ACT-0203). The hook layer is the only place that
// talks to the GraphQL client: it passes a generated TypedDocumentNode to the
// approved browser client and returns plain data. Components consume this hook
// and never see GraphQL — keeping them dumb and testable.

export const organisationProfileQueryKey = ["organisation", "profile"] as const;

export function useOrganisationProfile() {
  return useQuery({
    queryKey: organisationProfileQueryKey,
    queryFn: async () => {
      const data = await graphqlRequest(OrganisationProfileDocument);
      return data.organisationProfile;
    },
    staleTime: 30_000,
    retry: false,
  });
}
