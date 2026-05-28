import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateOrganisationProfile } from "./organisation-client";
import { organisationProfileQueryKey } from "./use-organisation-profile";

export function useUpdateOrganisationProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateOrganisationProfile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: organisationProfileQueryKey });
    },
  });
}
