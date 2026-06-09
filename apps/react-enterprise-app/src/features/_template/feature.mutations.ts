import { useMutation, useQueryClient } from "@tanstack/react-query";
import { graphqlRequest } from "@platform/graphql-browser-client";
import { CreateWidgetDocument } from "@platform/contracts-graphql";
import { widgetListQueryKey } from "./feature.queries";
import type { WidgetFormValues } from "./feature.schema";

/**
 * Write hook with invalidate-on-success (the canonical mutation pattern). For
 * optimistic UI, add onMutate/onError rollback here — never in the component.
 * Variables type is inferred from the generated document, so a schema change is
 * a compile error in this file.
 */
export function useCreateWidget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WidgetFormValues) =>
      graphqlRequest(CreateWidgetDocument, { name: input.name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: widgetListQueryKey });
    },
  });
}
