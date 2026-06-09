import { useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlRequest } from "@platform/graphql-browser-client";
import { UpdateOrganisationProfileDocument } from "@platform/contracts-graphql";
import type { UpdateOrganisationProfileRequest } from "@platform/contracts-organisation";
import { organisationProfileQueryKey } from "./organisation.queries";

// Feature-owned mutation hooks (ADR-ACT-0203). Invalidate-on-success keeps the
// cached profile consistent after an update. The variables type is inferred from
// the generated mutation document, so a schema change is a compile error here.

export function useUpdateOrganisationProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganisationProfileRequest) =>
      graphqlRequest(UpdateOrganisationProfileDocument, { displayName: input.displayName }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organisationProfileQueryKey });
    },
  });
}
