import type {
  TenantDomainListResponse,
  TenantDomainVerificationResponse,
  TenantDomainReadinessResponse,
  CreateTenantDomainRequest,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  TenantDomainListResponse,
  TenantDomainVerificationResponse,
  TenantDomainReadinessResponse,
};

export function listDomains(): Promise<TenantDomainListResponse> {
  return adminGet<TenantDomainListResponse>("/api/org/domains");
}

export function createDomain(
  input: CreateTenantDomainRequest
): Promise<TenantDomainVerificationResponse> {
  return adminSend<TenantDomainVerificationResponse>("POST", "/api/org/domains", input);
}

export function verifyDomain(domain: string): Promise<TenantDomainVerificationResponse> {
  return adminSend<TenantDomainVerificationResponse>(
    "POST",
    `/api/org/domains/${encodeURIComponent(domain)}/verify`
  );
}

export function removeDomain(domain: string): Promise<void> {
  return adminSend<void>("DELETE", `/api/org/domains/${encodeURIComponent(domain)}`);
}

export function getDomainsReadiness(): Promise<TenantDomainReadinessResponse> {
  return adminGet<TenantDomainReadinessResponse>("/api/org/domains/readiness");
}
