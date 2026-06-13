import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listDeadLetters, listEvents, listWorkers, redriveEvent } from "./admin-events-client";

export const eventsKey = (id: string) => ["admin", "events", id] as const;
export const deadLettersKey = (id: string) => ["admin", "events", "dlq", id] as const;
export const workersKey = ["admin", "workers"] as const;

export function useEvents(organisationId: string) {
  return useQuery({
    queryKey: eventsKey(organisationId),
    queryFn: () => listEvents(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}
export function useDeadLetters(organisationId: string) {
  return useQuery({
    queryKey: deadLettersKey(organisationId),
    queryFn: () => listDeadLetters(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}
export function useWorkers() {
  return useQuery({ queryKey: workersKey, queryFn: listWorkers, retry: false });
}

export function useRedriveEvent(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deadLetterId: string) => redriveEvent(deadLetterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deadLettersKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: eventsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
