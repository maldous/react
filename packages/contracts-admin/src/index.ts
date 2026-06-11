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
// Enterprise control-plane capability map + tenant readiness (ADR-0045)
// GET /api/org/readiness — self-describing capability inventory + tenant status.
// ---------------------------------------------------------------------------

export const CAPABILITY_CATEGORIES = [
  "identity",
  "authentication",
  "configuration",
  "operations",
  "integrations",
] as const;
export const CapabilityCategorySchema = z.enum(CAPABILITY_CATEGORIES);
export type CapabilityCategory = z.infer<typeof CapabilityCategorySchema>;

/** How complete the platform's implementation of a capability is. */
export const CAPABILITY_IMPLEMENTATION_STATUSES = ["implemented", "partial", "deferred"] as const;
export const CapabilityImplementationStatusSchema = z.enum(CAPABILITY_IMPLEMENTATION_STATUSES);
export type CapabilityImplementationStatus = z.infer<typeof CapabilityImplementationStatusSchema>;

/** Per-capability readiness for a given tenant. `deferred` = not yet checkable;
 * `unknown` = check could not run. Neither is ever reported as `ready`. */
export const CAPABILITY_READINESS_STATUSES = [
  "ready",
  "incomplete",
  "blocked",
  "degraded",
  "unknown",
  "deferred",
] as const;
export const CapabilityReadinessSchema = z.enum(CAPABILITY_READINESS_STATUSES);
export type CapabilityReadiness = z.infer<typeof CapabilityReadinessSchema>;

/** Aggregated tenant readiness over the `required` capabilities. */
export const TENANT_READINESS_STATUSES = [
  "ready",
  "incomplete",
  "blocked",
  "degraded",
  "unknown",
] as const;
export const TenantReadinessStatusSchema = z.enum(TENANT_READINESS_STATUSES);
export type TenantReadinessStatus = z.infer<typeof TenantReadinessStatusSchema>;

export const CapabilitySummarySchema = z.object({
  key: z.string(),
  category: CapabilityCategorySchema,
  /** i18n keys; SPA translates. Keeps admin text out of the BFF (ADR-0026). */
  labelKey: z.string(),
  descriptionKey: z.string(),
  /** Admin route that manages this capability, or null (no UI / system-admin). */
  adminRoute: z.string().nullable(),
  implementationStatus: CapabilityImplementationStatusSchema,
  readiness: CapabilityReadinessSchema,
  /** Whether the tenant is unusable without this capability (drives `overall`). */
  required: z.boolean(),
  /** Optional i18n key for a missing-action hint when not ready. */
  detailKey: z.string().nullable(),
});
export type CapabilitySummary = z.infer<typeof CapabilitySummarySchema>;

export const TenantReadinessResponseSchema = z.object({
  overall: TenantReadinessStatusSchema,
  capabilities: z.array(CapabilitySummarySchema),
});
export type TenantReadinessResponse = z.infer<typeof TenantReadinessResponseSchema>;

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

// ---------------------------------------------------------------------------
// Identity Provider management (ADR-0043) — realm IdP definitions.
// SEPARATE from the product login allowlist (ADR-0037, TenantAuthProviders*).
// Secrets are write-only: requests may carry clientSecret; responses never do.
// ---------------------------------------------------------------------------

/** Allowlisted realm IdP provider types. SAML/others deferred (ADR-0043). */
export const IDP_PROVIDER_IDS = ["oidc", "google", "microsoft", "apple"] as const;
export const IdpProviderIdSchema = z.enum(IDP_PROVIDER_IDS);
export type IdpProviderId = z.infer<typeof IdpProviderIdSchema>;

/** Aliases reserved for platform/system IdPs — a tenant admin may not use them. */
export const RESERVED_IDP_ALIASES = [
  "platform",
  "platform-realm",
  "master",
  "admin",
  "account",
  "security-admin-console",
  "broker",
] as const;

const IdpAliasSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{1,62}$/,
    "alias must be 2-63 chars: lowercase letters, digits, - or _"
  )
  .refine((a) => !(RESERVED_IDP_ALIASES as readonly string[]).includes(a), {
    message: "alias is reserved",
  });

/** Only http/https URLs — rejects javascript:, data:, file:, etc. */
const SafeUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: "URL must use http or https" });

/**
 * One row of `GET /api/auth/settings/idps` — explicitly mapped + redacted.
 * `hasClientSecret` indicates a secret is configured; the value is never returned.
 * `.strict()` so no raw Keycloak field can leak through.
 */
export const IdpSummarySchema = z
  .object({
    alias: z.string(),
    displayName: z.string(),
    providerId: z.string(),
    enabled: z.boolean(),
    hasClientSecret: z.boolean(),
    trustEmail: z.boolean(),
    clientId: z.string().nullable(),
    scopes: z.string().nullable(),
  })
  .strict();
export type IdpSummary = z.infer<typeof IdpSummarySchema>;

export const IdpListResponseSchema = z.object({ idps: z.array(IdpSummarySchema) });
export type IdpListResponse = z.infer<typeof IdpListResponseSchema>;

/** `POST /api/auth/settings/idps`. clientSecret is write-only. oidc needs URLs. */
export const CreateIdpRequestSchema = z
  .object({
    alias: IdpAliasSchema,
    displayName: z.string().min(1).max(120),
    providerId: IdpProviderIdSchema,
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().min(1).max(4096),
    authorizationUrl: SafeUrlSchema.optional(),
    tokenUrl: SafeUrlSchema.optional(),
    userInfoUrl: SafeUrlSchema.optional(),
    issuer: SafeUrlSchema.optional(),
    scopes: z.string().max(255).optional(),
    trustEmail: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((b) => b.providerId !== "oidc" || (!!b.authorizationUrl && !!b.tokenUrl), {
    message: "oidc providers require authorizationUrl and tokenUrl",
    path: ["authorizationUrl"],
  });
export type CreateIdpRequest = z.infer<typeof CreateIdpRequestSchema>;

/** `PATCH /api/auth/settings/idps/:alias`. A blank/absent clientSecret PRESERVES
 * the existing secret (handled server-side via Keycloak's secret-mask round-trip). */
export const UpdateIdpRequestSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    clientId: z.string().min(1).max(255).optional(),
    clientSecret: z.string().max(4096).optional(),
    authorizationUrl: SafeUrlSchema.optional(),
    tokenUrl: SafeUrlSchema.optional(),
    userInfoUrl: SafeUrlSchema.optional(),
    issuer: SafeUrlSchema.optional(),
    scopes: z.string().max(255).optional(),
    trustEmail: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type UpdateIdpRequest = z.infer<typeof UpdateIdpRequestSchema>;

// ---------------------------------------------------------------------------
// OIDC enterprise hardening (ADR-0046 / ADR-ACT-0215)
// Discovery import, issuer/JWKS validation, callback display, test connection,
// and bounded claim/group-role mapping. Strict + no-passthrough: responses carry
// a MINIMAL redacted view only — never the raw discovery/JWKS document and never
// a client secret. SAML and login simulation are out of scope.
// ---------------------------------------------------------------------------

/** `POST /api/auth/settings/idps/oidc/discover` — at least one of issuer/discoveryUrl. */
export const OidcDiscoverRequestSchema = z
  .object({
    issuer: SafeUrlSchema.optional(),
    discoveryUrl: SafeUrlSchema.optional(),
  })
  .strict()
  .refine((b) => !!b.issuer || !!b.discoveryUrl, {
    message: "issuer or discoveryUrl is required",
    path: ["issuer"],
  });
export type OidcDiscoverRequest = z.infer<typeof OidcDiscoverRequestSchema>;

/** Minimal redacted projection of the discovery document — never the raw doc. */
export const OidcDiscoveryMetadataSchema = z
  .object({
    issuer: z.string(),
    authorizationEndpoint: z.string(),
    tokenEndpoint: z.string(),
    userInfoEndpoint: z.string().nullable(),
    jwksUri: z.string(),
  })
  .strict();
export type OidcDiscoveryMetadata = z.infer<typeof OidcDiscoveryMetadataSchema>;

/** Classified result of a discovery/test probe — booleans + counts only. */
export const OIDC_CONNECTION_RESULTS = [
  "ok",
  "issuer_mismatch",
  "jwks_invalid",
  "unreachable",
  "invalid_document",
  "not_configured",
] as const;
export const OidcConnectionResultSchema = z.enum(OIDC_CONNECTION_RESULTS);
export type OidcConnectionResult = z.infer<typeof OidcConnectionResultSchema>;

export const OidcValidationResultSchema = z
  .object({
    result: OidcConnectionResultSchema,
    issuerValid: z.boolean(),
    jwksValid: z.boolean(),
    jwksKeyCount: z.number().int().nonnegative(),
  })
  .strict();
export type OidcValidationResult = z.infer<typeof OidcValidationResultSchema>;

/** `POST /api/auth/settings/idps/oidc/discover` response. */
export const OidcDiscoverResponseSchema = z
  .object({
    metadata: OidcDiscoveryMetadataSchema.nullable(),
    validation: OidcValidationResultSchema,
  })
  .strict();
export type OidcDiscoverResponse = z.infer<typeof OidcDiscoverResponseSchema>;

/** `GET /api/auth/settings/idps/:alias/callback-url` — derived from tenant context. */
export const IdpCallbackUrlResponseSchema = z
  .object({
    alias: z.string(),
    callbackUrl: z.string(),
  })
  .strict();
export type IdpCallbackUrlResponse = z.infer<typeof IdpCallbackUrlResponseSchema>;

/** `POST /api/auth/settings/idps/:alias/test-connection` response. */
export const OidcTestConnectionResponseSchema = OidcValidationResultSchema;
export type OidcTestConnectionResponse = z.infer<typeof OidcTestConnectionResponseSchema>;

// --- Claim / group-role mapping (bounded + typed; reject dangerous/empty) ---

const OidcClaimNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,64}$/, "claim must be 1-64 chars: letters, digits, . _ : -");
const OidcAttributeNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,64}$/, "attribute must be 1-64 chars: letters, digits, . _ -");

/** Map an upstream OIDC claim into a Keycloak user attribute. */
export const OidcClaimMappingSchema = z
  .object({
    upstreamClaim: OidcClaimNameSchema,
    userAttribute: OidcAttributeNameSchema,
  })
  .strict();
export type OidcClaimMapping = z.infer<typeof OidcClaimMappingSchema>;

/** Map an upstream claim value to a realm role — role allowlisted to tenant roles. */
export const OidcRoleMappingSchema = z
  .object({
    upstreamClaim: OidcClaimNameSchema,
    claimValue: z.string().min(1).max(128),
    realmRole: TenantRoleSchema,
  })
  .strict();
export type OidcRoleMapping = z.infer<typeof OidcRoleMappingSchema>;

/** `GET/PATCH /api/auth/settings/idps/:alias/mapping` — full-replace semantics. */
export const IdpMappingConfigSchema = z
  .object({
    claimMappings: z.array(OidcClaimMappingSchema).max(20),
    roleMappings: z.array(OidcRoleMappingSchema).max(20),
  })
  .strict();
export type IdpMappingConfig = z.infer<typeof IdpMappingConfigSchema>;

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

/**
 * Rotate/repair body for the path-scoped lifecycle routes (ADR-0044). The target
 * tenant comes from the URL path (system-admin, global scope) — NOT the body —
 * so the body carries only the write-only credential. The secret is never echoed.
 */
export const CredentialSecretRequestSchema = z
  .object({
    clientId: z.string().min(1).max(255),
    clientSecret: z.string().min(1).max(4096),
  })
  .strict();
export type CredentialSecretRequest = z.infer<typeof CredentialSecretRequestSchema>;

/** Secret-free credential lifecycle metadata (ADR-0044). */
export const CredentialMetadataSchema = z.object({
  clientId: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  lastRotatedAt: z.string().nullable(),
  rotatedBy: z.string().nullable(),
});
export type CredentialMetadataDto = z.infer<typeof CredentialMetadataSchema>;

/** `GET /api/admin/tenants/:tenantId/auth-settings-credential/readiness`. */
export const CredentialReadinessResponseSchema = z.object({
  status: AuthReadinessStatusSchema,
  metadata: CredentialMetadataSchema.nullable(),
});
export type CredentialReadinessResponse = z.infer<typeof CredentialReadinessResponseSchema>;

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
