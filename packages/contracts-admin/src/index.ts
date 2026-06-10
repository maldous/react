import { z } from "zod";

/**
 * Tenant-administration contract package (ADR-0036 / ADR-0037).
 *
 * Zod schemas + inferred types for the admin REST surface shared between the BFF
 * (`apps/platform-api`) and the React control plane. Request schemas validate
 * mutation bodies; response types mirror exactly what the existing endpoints
 * return so the SPA can type its REST clients without bypassing the BFF.
 *
 * Pure contract package: zod only, zero `@platform/*` dependencies.
 */
export const packageName = "@platform/contracts-admin";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Tenant roles. Mirrors `TenantRole` in `@platform/domain-identity`; kept as a
 * literal here so this contract stays dependency-free. MUST stay in lock-step
 * with domain-identity.
 */
export const TENANT_ROLES = ["tenant-admin", "manager", "member", "viewer"] as const;
export const TenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRoleValue = z.infer<typeof TenantRoleSchema>;

// ---------------------------------------------------------------------------
// Members — GET/POST/PATCH/DELETE /api/org/members*
// ---------------------------------------------------------------------------

export const MemberSummarySchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: TenantRoleSchema,
  joinedAt: z.string(),
});
export type MemberSummary = z.infer<typeof MemberSummarySchema>;

export const PendingInvitationSchema = z.object({
  email: z.string(),
  role: TenantRoleSchema,
  invitedAt: z.string(),
  expiresAt: z.string(),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

/** Shape returned by `GET /api/org/members`. */
export const MemberListResponseSchema = z.object({
  members: z.array(MemberSummarySchema),
  pendingInvitations: z.array(PendingInvitationSchema),
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const InviteMemberRequestSchema = z
  .object({
    email: z.string().email("Enter a valid email address"),
    role: TenantRoleSchema,
  })
  .strict();
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const UpdateMemberRoleRequestSchema = z.object({ role: TenantRoleSchema }).strict();
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;

// ---------------------------------------------------------------------------
// Features — GET /api/org/features, PATCH /api/org/features/:key
// ---------------------------------------------------------------------------

export const FEATURE_KEYS = ["analytics", "advanced_auth", "audit_export", "webhooks"] as const;
export const FeatureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKeyValue = z.infer<typeof FeatureKeySchema>;

export const FeatureSummarySchema = z.object({
  key: FeatureKeySchema,
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type FeatureSummary = z.infer<typeof FeatureSummarySchema>;

/** Shape returned by `GET /api/org/features`. */
export const FeatureListResponseSchema = z.object({ features: z.array(FeatureSummarySchema) });
export type FeatureListResponse = z.infer<typeof FeatureListResponseSchema>;

export const ToggleFeatureRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type ToggleFeatureRequest = z.infer<typeof ToggleFeatureRequestSchema>;

// ---------------------------------------------------------------------------
// Auth settings (read shapes the admin UI consumes)
// ---------------------------------------------------------------------------

/** One row of `GET /api/auth/settings/idps`. Tolerant of extra realm fields
 * (e.g. `config`, `trustEmail`) the UI does not display. */
export const IdpSummarySchema = z
  .object({
    alias: z.string(),
    displayName: z.string(),
    providerId: z.string(),
    enabled: z.boolean(),
  })
  .passthrough();
export type IdpSummary = z.infer<typeof IdpSummarySchema>;

export const MfaRequirementSchema = z.enum(["none", "optional", "required"]);
export const MfaTypeSchema = z.enum(["totp", "webauthn"]);

/** `GET/PATCH /api/auth/settings/mfa`. */
export const MfaPolicySchema = z.object({
  required: MfaRequirementSchema,
  type: MfaTypeSchema,
  gracePeriodSeconds: z.number().int().nonnegative().optional(),
});
export type MfaPolicyDto = z.infer<typeof MfaPolicySchema>;

/** `GET/PATCH /api/auth/settings/session`. */
export const SessionPolicySchema = z.object({
  accessTokenLifespanSeconds: z.number().int().positive(),
  ssoSessionIdleTimeoutSeconds: z.number().int().positive(),
  ssoSessionMaxLifespanSeconds: z.number().int().positive(),
  rememberMe: z.boolean(),
});
export type SessionPolicyDto = z.infer<typeof SessionPolicySchema>;

// ---------------------------------------------------------------------------
// Per-tenant authentication provider config (ADR-0037) — greenfield
// GET/PATCH /api/auth/settings/providers
// ---------------------------------------------------------------------------

/** Product provider ids. Mirrors `ProductProviderId` in the BFF auth-providers
 * module; literal here to keep this package dependency-free. */
export const PRODUCT_PROVIDER_IDS = ["google", "azure", "apple", "platform"] as const;
export const ProductProviderIdSchema = z.enum(PRODUCT_PROVIDER_IDS);
export type ProductProviderId = z.infer<typeof ProductProviderIdSchema>;

/** "default" inherits the environment default mode; explicit values override it. */
export const ProviderModeSchema = z.enum(["mock", "real", "disabled", "default"]);
export type ProviderModeSetting = z.infer<typeof ProviderModeSchema>;

export const TenantAuthProvidersConfigSchema = z.object({
  mode: ProviderModeSchema,
  enabledProviders: z.array(ProductProviderIdSchema),
});
export type TenantAuthProvidersConfig = z.infer<typeof TenantAuthProvidersConfigSchema>;

/** `PATCH /api/auth/settings/providers` body — partial update of the config. */
export const UpdateTenantAuthProvidersRequestSchema = z
  .object({
    mode: ProviderModeSchema.optional(),
    enabledProviders: z.array(ProductProviderIdSchema).optional(),
  })
  .strict()
  .refine((b) => b.mode !== undefined || b.enabledProviders !== undefined, {
    message: "Provide at least one of mode or enabledProviders",
  });
export type UpdateTenantAuthProvidersRequest = z.infer<
  typeof UpdateTenantAuthProvidersRequestSchema
>;

/** `GET /api/auth/settings/providers` response: the effective config plus the
 * environment default mode (so the UI can label what "default" resolves to). */
export const TenantAuthProvidersResponseSchema = z.object({
  config: TenantAuthProvidersConfigSchema,
  environmentDefaultMode: z.enum(["mock", "real", "disabled"]),
  availableProviders: z.array(ProductProviderIdSchema),
});
export type TenantAuthProvidersResponse = z.infer<typeof TenantAuthProvidersResponseSchema>;
