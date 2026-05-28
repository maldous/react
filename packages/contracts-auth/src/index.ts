import { z } from "zod";

export const packageName = "@platform/contracts-auth";

// --- Role types ---

export type TenantScopedRole = "tenant-admin" | "manager" | "member" | "viewer";
export type GlobalRole = "system-admin";
export type BaseRole = TenantScopedRole | GlobalRole;

// --- Permission types ---

export type Permission =
  | "organisation.read"
  | "organisation.update"
  | "member.read"
  | "member.invite"
  | "member.update_role"
  | "profile.read_self"
  | "profile.update_self"
  | "admin.access"
  | "audit.read";

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
