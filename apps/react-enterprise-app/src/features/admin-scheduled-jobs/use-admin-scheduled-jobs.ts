import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateScheduledJobRequest } from "@platform/contracts-admin";
import {
  createScheduledJob,
  listScheduledJobs,
  runScheduledJob,
  setScheduledJobEnabled,
} from "./admin-scheduled-jobs-client";

export const jobsKey = (id: string) => ["admin", "scheduled-jobs", id] as const;

export function useScheduledJobs(organisationId: string) {
  return useQuery({
    queryKey: jobsKey(organisationId),
    queryFn: () => listScheduledJobs(organisationId),
    enabled: organisationId.length > 0,
    retry: false,
  });
}

export function useCreateScheduledJob(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduledJobRequest) => createScheduledJob(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useRunScheduledJob(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => runScheduledJob(jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useSetScheduledJobEnabled(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { jobId: string; enabled: boolean }) =>
      setScheduledJobEnabled(args.jobId, args.enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(organisationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}
