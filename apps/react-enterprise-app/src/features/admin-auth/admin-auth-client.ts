import type {
  TenantAuthProvidersResponse,
  UpdateTenantAuthProvidersRequest,
  IdpSummary,
  MfaPolicyDto,
  SessionPolicyDto,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type { TenantAuthProvidersResponse, IdpSummary, MfaPolicyDto, SessionPolicyDto };

export function getAuthProviders(): Promise<TenantAuthProvidersResponse> {
  return adminGet<TenantAuthProvidersResponse>("/api/auth/settings/providers");
}

export function setAuthProviders(
  input: UpdateTenantAuthProvidersRequest
): Promise<TenantAuthProvidersResponse> {
  return adminSend<TenantAuthProvidersResponse>("PATCH", "/api/auth/settings/providers", input);
}

export function listIdps(): Promise<IdpSummary[]> {
  return adminGet<IdpSummary[]>("/api/auth/settings/idps");
}

export function getMfaPolicy(): Promise<MfaPolicyDto> {
  return adminGet<MfaPolicyDto>("/api/auth/settings/mfa");
}

export function getSessionPolicy(): Promise<SessionPolicyDto> {
  return adminGet<SessionPolicyDto>("/api/auth/settings/session");
}
