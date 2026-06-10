import type { FeatureListResponse, FeatureSummary } from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { FeatureSummary };

export function listFeatures(): Promise<FeatureListResponse> {
  return adminGet<FeatureListResponse>("/api/org/features");
}

export function toggleFeature(key: string, enabled: boolean): Promise<FeatureSummary> {
  return adminSend<FeatureSummary>("PATCH", `/api/org/features/${encodeURIComponent(key)}`, {
    enabled,
  });
}
