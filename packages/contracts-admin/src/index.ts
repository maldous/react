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

/** Tenant-scoped membership lifecycle. Mirrors domain-identity MEMBERSHIP_STATUSES
 * (kept literal here to stay dependency-free; guarded by a drift test). */
export const MEMBERSHIP_STATUSES = ["invited", "active", "disabled"] as const;
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatusValue = z.infer<typeof MembershipStatusSchema>;

// ---------------------------------------------------------------------------
// Members — GET/POST/PATCH/DELETE /api/org/members* (ADR-0036, ADR-ACT-0206)
// ---------------------------------------------------------------------------

export const MemberSummarySchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  /** Tenant-scoped username; null when unset. */
  username: z.string().nullable(),
  role: TenantRoleSchema,
  status: MembershipStatusSchema,
  joinedAt: z.string(),
  lastLoginAt: z.string().nullable(),
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

/** PATCH /api/org/members/:userId/username — tenant-scoped username. Bounds mirror
 * domain-identity validateTenantUsername; keep in lock-step. */
export const EditUsernameRequestSchema = z
  .object({
    username: z
      .string()
      .min(3, "Username must be between 3 and 32 characters")
      .max(32, "Username must be between 3 and 32 characters")
      .regex(
        /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i,
        "Letters, digits, dot, underscore and hyphen only; must start and end with a letter or digit"
      ),
  })
  .strict();
export type EditUsernameRequest = z.infer<typeof EditUsernameRequestSchema>;

/** PATCH /api/org/members/:userId/status — enable/disable a member. Only the
 * admin-settable states are accepted here ('invited' is set by the invite flow). */
export const SetMemberStatusRequestSchema = z
  .object({ status: z.enum(["active", "disabled"]) })
  .strict();
export type SetMemberStatusRequest = z.infer<typeof SetMemberStatusRequestSchema>;

/** POST /api/org/members/resend-invite — re-issue a pending invitation by email. */
export const ResendInviteRequestSchema = z
  .object({ email: z.string().email("Enter a valid email address") })
  .strict();
export type ResendInviteRequest = z.infer<typeof ResendInviteRequestSchema>;

/** One row of GET /api/org/members/:userId/external-identities. */
export const ExternalIdentitySummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  subject: z.string(),
  email: z.string().nullable(),
  linkedAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type ExternalIdentitySummary = z.infer<typeof ExternalIdentitySummarySchema>;

export const ExternalIdentityListResponseSchema = z.object({
  identities: z.array(ExternalIdentitySummarySchema),
});
export type ExternalIdentityListResponse = z.infer<typeof ExternalIdentityListResponseSchema>;

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
// Auth settings credential readiness (ADR-0041)
// GET /api/auth/settings/readiness — tells the SPA whether the per-tenant
// realm-admin credential is present and working, so editing can be offered only
// when safe. Never carries the credential itself.
// ---------------------------------------------------------------------------

export const AUTH_READINESS_STATUSES = [
  "configured",
  "missing_credential",
  "invalid_credential",
  "forbidden_realm_operation",
  "realm_unreachable",
] as const;
export const AuthReadinessStatusSchema = z.enum(AUTH_READINESS_STATUSES);
export type AuthReadinessStatusValue = z.infer<typeof AuthReadinessStatusSchema>;

export const AuthSettingsReadinessSchema = z.object({ status: AuthReadinessStatusSchema });
export type AuthSettingsReadiness = z.infer<typeof AuthSettingsReadinessSchema>;

/**
 * Operator-seeded credential attach (system-admin, global scope).
 * The secret is write-only: it is validated then stored encrypted, and never
 * returned, logged, or audited. organisationId identifies the target tenant.
 */
export const AttachAuthCredentialRequestSchema = z
  .object({
    organisationId: z.string().uuid(),
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().min(1).max(4096),
  })
  .strict();
export type AttachAuthCredentialRequest = z.infer<typeof AttachAuthCredentialRequestSchema>;

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

// ---------------------------------------------------------------------------
// Platform Configuration Registry (ADR-0039) — GET/PATCH/DELETE /api/org/config
// Definitions live server-side; these are the serialised shapes the SPA consumes.
// ---------------------------------------------------------------------------

export const CONFIG_VALUE_TYPES = ["boolean", "string", "number", "json", "enum"] as const;
export const ConfigValueTypeSchema = z.enum(CONFIG_VALUE_TYPES);
export type ConfigValueType = z.infer<typeof ConfigValueTypeSchema>;

export const CONFIG_CATEGORIES = [
  "auth",
  "features",
  "integrations",
  "security",
  "branding",
  "system",
] as const;
export const ConfigCategorySchema = z.enum(CONFIG_CATEGORIES);
export type ConfigCategory = z.infer<typeof ConfigCategorySchema>;

export const ConfigLifecycleSchema = z.enum(["active", "deprecated", "internal"]);
export type ConfigLifecycle = z.infer<typeof ConfigLifecycleSchema>;

/** Serialised config definition (the registry entry the SPA renders from). */
export const ConfigDefinitionDtoSchema = z.object({
  key: z.string(),
  category: ConfigCategorySchema,
  labelKey: z.string(),
  descriptionKey: z.string(),
  valueType: ConfigValueTypeSchema,
  defaultValue: z.unknown(),
  allowedValues: z.array(z.string()).nullable(),
  tenantOverridable: z.boolean(),
  requiredPermissionRead: z.string(),
  requiredPermissionWrite: z.string(),
  lifecycle: ConfigLifecycleSchema,
});
export type ConfigDefinitionDto = z.infer<typeof ConfigDefinitionDtoSchema>;

export const ConfigSourceSchema = z.enum(["default", "tenant_override"]);
export type ConfigSource = z.infer<typeof ConfigSourceSchema>;

export const EffectiveConfigItemSchema = z.object({
  definition: ConfigDefinitionDtoSchema,
  value: z.unknown(),
  source: ConfigSourceSchema,
});
export type EffectiveConfigItem = z.infer<typeof EffectiveConfigItemSchema>;

export const ConfigListResponseSchema = z.object({ items: z.array(EffectiveConfigItemSchema) });
export type ConfigListResponse = z.infer<typeof ConfigListResponseSchema>;

/** `PATCH /api/org/config/:key` — set a tenant override. The value is validated against
 * the definition server-side via validateConfigValue. */
export const UpdateConfigValueRequestSchema = z.object({ value: z.unknown() }).strict();
export type UpdateConfigValueRequest = z.infer<typeof UpdateConfigValueRequestSchema>;

// ---------------------------------------------------------------------------
// Administrative audit trail (ADR-0040) — GET /api/org/audit
// ---------------------------------------------------------------------------

/** Logical audit resources the SPA may query; mapped server-side to stored resource
 * strings + the context read permission (the SPA never passes internal strings). */
export const AUDIT_RESOURCES = ["member", "config", "feature", "auth_settings"] as const;
export const AuditResourceSchema = z.enum(AUDIT_RESOURCES);
export type AuditResource = z.infer<typeof AuditResourceSchema>;

/** Safe, read-only audit event shape (no ipAddress/userAgent; secret-ish metadata redacted). */
export const AuditEventDtoSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  resource: z.string(),
  resourceId: z.string(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEventDto = z.infer<typeof AuditEventDtoSchema>;

export const AuditListResponseSchema = z.object({ events: z.array(AuditEventDtoSchema) });
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

/** Validate a value against a definition's type + allowed values. Pure; returns error
 * messages (empty ⇒ valid). Shared by the BFF (write) and available to the SPA. */
export function validateConfigValue(input: {
  valueType: ConfigValueType;
  allowedValues?: readonly string[] | null;
  value: unknown;
}): string[] {
  const { valueType, allowedValues, value } = input;
  const errors: string[] = [];
  switch (valueType) {
    case "boolean":
      if (typeof value !== "boolean") errors.push("value must be a boolean");
      break;
    case "string":
      if (typeof value !== "string") errors.push("value must be a string");
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) errors.push("value must be a number");
      break;
    case "enum":
      if (typeof value !== "string" || !allowedValues || !allowedValues.includes(value)) {
        errors.push("value must be one of the allowed values");
      }
      break;
    case "json":
      if (value === undefined) {
        errors.push("value is required");
      } else {
        try {
          JSON.stringify(value);
        } catch {
          errors.push("value must be JSON-serialisable");
        }
      }
      break;
  }
  return errors;
}
