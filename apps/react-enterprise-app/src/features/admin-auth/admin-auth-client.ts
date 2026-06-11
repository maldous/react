import type {
  TenantAuthProvidersResponse,
  UpdateTenantAuthProvidersRequest,
  IdpSummary,
  CreateIdpRequest,
  UpdateIdpRequest,
  MfaPolicyDto,
  SessionPolicyDto,
  AuthSettingsReadiness,
  OidcDiscoverRequest,
  OidcDiscoverResponse,
  OidcTestConnectionResponse,
  IdpCallbackUrlResponse,
  IdpMappingConfig,
} from "@platform/contracts-admin";
import { adminGet, adminSend } from "../admin/admin-fetch";

export type {
  TenantAuthProvidersResponse,
  IdpSummary,
  CreateIdpRequest,
  UpdateIdpRequest,
  MfaPolicyDto,
  SessionPolicyDto,
  AuthSettingsReadiness,
  OidcDiscoverRequest,
  OidcDiscoverResponse,
  OidcTestConnectionResponse,
  IdpCallbackUrlResponse,
  IdpMappingConfig,
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

export function createIdp(input: CreateIdpRequest): Promise<void> {
  return adminSend<void>("POST", "/api/auth/settings/idps", input);
}

export function updateIdp(alias: string, input: UpdateIdpRequest): Promise<void> {
  return adminSend<void>("PATCH", `/api/auth/settings/idps/${encodeURIComponent(alias)}`, input);
}

export function deleteIdp(alias: string): Promise<void> {
  return adminSend<void>("DELETE", `/api/auth/settings/idps/${encodeURIComponent(alias)}`);
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

// --- OIDC enterprise hardening (ADR-0046) ---

export function discoverOidc(input: OidcDiscoverRequest): Promise<OidcDiscoverResponse> {
  return adminSend<OidcDiscoverResponse>("POST", "/api/auth/settings/idps/oidc/discover", input);
}

export function getIdpCallbackUrl(alias: string): Promise<IdpCallbackUrlResponse> {
  return adminGet<IdpCallbackUrlResponse>(
    `/api/auth/settings/idps/${encodeURIComponent(alias)}/callback-url`
  );
}

export function testIdpConnection(alias: string): Promise<OidcTestConnectionResponse> {
  return adminSend<OidcTestConnectionResponse>(
    "POST",
    `/api/auth/settings/idps/${encodeURIComponent(alias)}/test-connection`
  );
}

export function getIdpMapping(alias: string): Promise<IdpMappingConfig> {
  return adminGet<IdpMappingConfig>(`/api/auth/settings/idps/${encodeURIComponent(alias)}/mapping`);
}

export function updateIdpMapping(
  alias: string,
  input: IdpMappingConfig
): Promise<IdpMappingConfig> {
  return adminSend<IdpMappingConfig>(
    "PATCH",
    `/api/auth/settings/idps/${encodeURIComponent(alias)}/mapping`,
    input
  );
}
