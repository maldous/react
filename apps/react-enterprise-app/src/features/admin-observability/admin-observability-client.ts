import type {
  TenantObservabilityReadinessResponse,
  TenantObservabilityReadinessStatus,
  ObservabilitySignalStatus,
} from "@platform/contracts-admin";
import { adminGet } from "../admin/admin-fetch";

export type {
  TenantObservabilityReadinessResponse,
  TenantObservabilityReadinessStatus,
  ObservabilitySignalStatus,
};

export function getObservabilityReadiness(): Promise<TenantObservabilityReadinessResponse> {
  return adminGet<TenantObservabilityReadinessResponse>("/api/org/observability/readiness");
}
