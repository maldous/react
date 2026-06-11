import type {
  TenantAuthProvidersResponse,
  UpdateTenantAuthProvidersRequest,
  IdpSummary,
  MfaPolicyDto,
  SessionPolicyDto,
  AuthSettingsReadiness,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  TenantAuthProvidersResponse,
  IdpSummary,
  MfaPolicyDto,
  SessionPolicyDto,
  AuthSettingsReadiness,
};

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

export function setMfaPolicy(input: MfaPolicyDto): Promise<void> {
  return adminSend<void>("PATCH", "/api/auth/settings/mfa", input);
}

export function getSessionPolicy(): Promise<SessionPolicyDto> {
  return adminGet<SessionPolicyDto>("/api/auth/settings/session");
}

export function setSessionPolicy(input: SessionPolicyDto): Promise<void> {
  return adminSend<void>("PATCH", "/api/auth/settings/session", input);
}

/** Auth-settings credential readiness (ADR-0041) — tells the UI whether editing is safe. */
export function getAuthReadiness(): Promise<AuthSettingsReadiness> {
  return adminGet<AuthSettingsReadiness>("/api/auth/settings/readiness");
}
