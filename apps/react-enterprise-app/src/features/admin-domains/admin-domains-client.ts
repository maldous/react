import type {
  TenantDomainListResponse,
  TenantDomainVerificationResponse,
  TenantDomainReadinessResponse,
  TenantDomainActivationResponse,
  TenantDomainRoutingProbeResponse,
  TenantDomainCanonicalResponse,
  CreateTenantDomainRequest,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  TenantDomainListResponse,
  TenantDomainVerificationResponse,
  TenantDomainReadinessResponse,
  TenantDomainActivationResponse,
  TenantDomainRoutingProbeResponse,
  TenantDomainCanonicalResponse,
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

export function activateDomain(domain: string): Promise<TenantDomainActivationResponse> {
  return adminSend<TenantDomainActivationResponse>(
    "POST",
    `/api/org/domains/${encodeURIComponent(domain)}/activate`
  );
}

export function deactivateDomain(domain: string): Promise<TenantDomainActivationResponse> {
  return adminSend<TenantDomainActivationResponse>(
    "POST",
    `/api/org/domains/${encodeURIComponent(domain)}/deactivate`
  );
}

export function probeDomainRoutingLocal(domain: string): Promise<TenantDomainRoutingProbeResponse> {
  return adminSend<TenantDomainRoutingProbeResponse>(
    "POST",
    `/api/org/domains/${encodeURIComponent(domain)}/probe-routing-local`
  );
}

export function setCanonicalDomain(domain: string): Promise<TenantDomainCanonicalResponse> {
  return adminSend<TenantDomainCanonicalResponse>(
    "POST",
    `/api/org/domains/${encodeURIComponent(domain)}/canonical`
  );
}

export function unsetCanonicalDomain(domain: string): Promise<TenantDomainCanonicalResponse> {
  return adminSend<TenantDomainCanonicalResponse>(
    "DELETE",
    `/api/org/domains/${encodeURIComponent(domain)}/canonical`
  );
}
