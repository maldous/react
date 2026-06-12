import type {
  PlatformServicesReadinessResponse,
  PlatformServiceSummary,
  PlatformWorkerSummary,
} from "@platform/contracts-admin";
import { adminGet } from "../admin/admin-fetch";

export type { PlatformServicesReadinessResponse, PlatformServiceSummary, PlatformWorkerSummary };

export function getPlatformServicesReadiness(): Promise<PlatformServicesReadinessResponse> {
  return adminGet<PlatformServicesReadinessResponse>("/api/org/platform/services/readiness");
}
