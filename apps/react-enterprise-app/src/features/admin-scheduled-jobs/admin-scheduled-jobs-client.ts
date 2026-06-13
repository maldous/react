// Typed REST client for the Phase-5.5 scheduled-jobs surface (ADR-0059 / ADR-ACT-0262).
// REST-over-BFF; operator-only. Schedules enqueue events onto the Phase-5 outbox.

import type {
  CreateScheduledJobRequest,
  RunScheduledJobResponse,
  ScheduledJobListResponse,
  UpdateScheduledJobRequest,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  CreateScheduledJobRequest,
  RunScheduledJobResponse,
  ScheduledJobListResponse,
  UpdateScheduledJobRequest,
};

export function listScheduledJobs(organisationId: string): Promise<ScheduledJobListResponse> {
  return adminGet<ScheduledJobListResponse>(
    `/api/admin/scheduled-jobs?organisationId=${encodeURIComponent(organisationId)}`
  );
}
export function createScheduledJob(input: CreateScheduledJobRequest): Promise<unknown> {
  return adminSend("POST", "/api/admin/scheduled-jobs", input);
}
export function runScheduledJob(jobId: string): Promise<RunScheduledJobResponse> {
  return adminSend<RunScheduledJobResponse>(
    "POST",
    `/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}/run`
  );
}
export function setScheduledJobEnabled(jobId: string, enabled: boolean): Promise<unknown> {
  return adminSend("PATCH", `/api/admin/scheduled-jobs/${encodeURIComponent(jobId)}`, { enabled });
}
