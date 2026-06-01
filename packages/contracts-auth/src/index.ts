import { z } from "zod";

export const packageName = "@platform/contracts-auth";

// --- Role types ---

export type TenantScopedRole = "tenant-admin" | "manager" | "member" | "viewer";
export type GlobalRole = "system-admin";
export type BaseRole = TenantScopedRole | GlobalRole;

// --- Permission types ---

export type Permission =
  // Shared non-admin permissions
  | "organisation.read"
  | "organisation.update"
  | "member.read"
  | "member.invite"
  | "member.update_role"
  | "profile.read_self"
  | "profile.update_self"
  | "audit.read"
  // Global/platform permissions (system-admin only)
  | "platform.admin.access"
  | "platform.tenants.create"
  | "platform.tenants.read"
  | "platform.tenants.update"
  | "platform.tenants.delete"
  | "platform.clickthrough.pgadmin"
  | "platform.clickthrough.keycloak"
  | "platform.clickthrough.minio"
  | "platform.clickthrough.mailpit"
  | "platform.clickthrough.sonarqube"
  | "platform.clickthrough.sentry"
  | "platform.clickthrough.wiremock"
  | "platform.clickthrough.clickhouse"
  | "platform.audit.read_all"
  // Tenant-scoped permissions (tenant-admin only)
  | "tenant.admin.access"
  | "tenant.members.read"
  | "tenant.members.invite"
  | "tenant.members.update_role"
  | "tenant.members.delete"
  | "tenant.groups.read"
  | "tenant.groups.create"
  | "tenant.groups.update"
  | "tenant.groups.delete"
  | "tenant.suborgs.read"
  | "tenant.suborgs.create"
  | "tenant.suborgs.update"
  | "tenant.suborgs.delete"
  | "tenant.features.read"
  | "tenant.features.update"
  | "tenant.auth.settings.read"
  | "tenant.auth.settings.write"
  | "tenant.audit.read"
  | "tenant.clickthrough.keycloak"
  | "tenant.clickthrough.mailpit"
  | "tenant.clickthrough.sentry";

// --- AuthErrorCode ---

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "SESSION_EXPIRED" | "PROVIDER_ERROR";

/** Const object for use as values (alongside the AuthErrorCode type). */
export const AUTH_ERROR_CODE = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
} as const satisfies Record<AuthErrorCode, AuthErrorCode>;

// --- SessionActor schema ---

export const SessionActorSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  organisationId: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  displayName: z.string(),
  // Support-mode fields (ADR-ACT-0187). Only present on explicit support sessions.
  // When present: actor is a system-admin operating on effectiveOrganisationId's tenant
  // under explicit audited support access. The pipeline allows FQDN access only to
  // that specific tenant — other tenant FQDNs still return 403.
  supportMode: z.literal(true).optional(),
  effectiveOrganisationId: z.string().optional(),
  supportAccessReason: z.string().optional(),
  // UMA token field (ADR-ACT-0145 / ADR-ACT-0153) — pipeline-internal, never in API responses.
  // Populated from SessionRecord.accessTokenEnc when a real session is resolved.
  // Absent for fixture sessions and legacy sessions created before token storage landed.
  accessTokenEnc: z.string().optional(),
});

export type SessionActor = z.infer<typeof SessionActorSchema>;

// --- Auth request/response schemas ---

export const LoginRequestSchema = z.object({
  returnTo: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LogoutRequestSchema = z.object({
  everywhere: z.boolean().optional(),
});

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const SessionResponseSchema = z.object({
  status: z.enum(["authenticated", "unauthenticated", "expired"]),
  actor: SessionActorSchema.optional(),
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;
