// Typed REST client for the Phase-3 developer platform (ADR-0065 / ADR-ACT-0257).
// REST-over-BFF; server-authoritative. API keys are server-generated — React never
// generates a secret. The plaintext secret crosses this boundary exactly once (on
// create); list/read responses never carry it.

import type {
  ApiKeyListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DeveloperPortalResponse,
  RateLimitListResponse,
  SetRateLimitRequest,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  ApiKeyListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DeveloperPortalResponse,
  RateLimitListResponse,
  SetRateLimitRequest,
};

// --- tenant self-service ----------------------------------------------------
export function getDeveloperPortal(): Promise<DeveloperPortalResponse> {
  return adminGet<DeveloperPortalResponse>("/api/org/developer");
}
export function listMyApiKeys(): Promise<ApiKeyListResponse> {
  return adminGet<ApiKeyListResponse>("/api/org/api-keys");
}
export function createMyApiKey(input: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  return adminSend<CreateApiKeyResponse>("POST", "/api/org/api-keys", input);
}
export function revokeMyApiKey(keyId: string): Promise<unknown> {
  return adminSend("DELETE", `/api/org/api-keys/${encodeURIComponent(keyId)}`);
}
export function listMyRateLimits(): Promise<RateLimitListResponse> {
  return adminGet<RateLimitListResponse>("/api/org/rate-limits");
}

// --- operator ---------------------------------------------------------------
export function listTenantApiKeys(tenantId: string): Promise<ApiKeyListResponse> {
  return adminGet<ApiKeyListResponse>(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/api-keys`
  );
}
export function listTenantRateLimits(tenantId: string): Promise<RateLimitListResponse> {
  return adminGet<RateLimitListResponse>(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/rate-limits`
  );
}
export function setTenantRateLimit(tenantId: string, input: SetRateLimitRequest): Promise<unknown> {
  return adminSend(
    "PATCH",
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/rate-limits`,
    input
  );
}
