import type {
  TenantStorageReadinessResponse,
  TenantStorageProbeResult,
  TenantStorageReadinessStatus,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  TenantStorageReadinessResponse,
  TenantStorageProbeResult,
  TenantStorageReadinessStatus,
};

export function getStorageReadiness(): Promise<TenantStorageReadinessResponse> {
  return adminGet<TenantStorageReadinessResponse>("/api/org/storage/readiness");
}

export function runStorageProbe(): Promise<TenantStorageProbeResult> {
  return adminSend<TenantStorageProbeResult>("POST", "/api/org/storage/probe", {});
}
