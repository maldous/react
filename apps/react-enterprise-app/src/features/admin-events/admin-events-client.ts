// Typed REST client for the Phase-5 event-bus operator surface (ADR-0059 / ADR-ACT-0259).
// REST-over-BFF; operator-only. Reads + audited redrive; no secret payload fields.

import type {
  DeadLetterListResponse,
  EventListResponse,
  RedriveResponse,
  WorkerListResponse,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { EventListResponse, DeadLetterListResponse, WorkerListResponse, RedriveResponse };

export function listEvents(organisationId: string): Promise<EventListResponse> {
  return adminGet<EventListResponse>(
    `/api/admin/events?organisationId=${encodeURIComponent(organisationId)}`
  );
}
export function listDeadLetters(organisationId: string): Promise<DeadLetterListResponse> {
  return adminGet<DeadLetterListResponse>(
    `/api/admin/events/dead-letter?organisationId=${encodeURIComponent(organisationId)}`
  );
}
export function redriveEvent(deadLetterId: string): Promise<RedriveResponse> {
  return adminSend<RedriveResponse>(
    "POST",
    `/api/admin/events/${encodeURIComponent(deadLetterId)}/redrive`
  );
}
export function listWorkers(): Promise<WorkerListResponse> {
  return adminGet<WorkerListResponse>("/api/admin/workers");
}
