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

export { PROOF_LADDER, type ProofLadderEntry } from "./proof-registry.ts";

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
    email: z.email("Enter a valid email address"),
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
  .object({ email: z.email("Enter a valid email address") })
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

// ---------------------------------------------------------------------------
// Tenant email sender configuration (ADR-0047 / ADR-ACT-0216)
// Strict + no-passthrough. The SMTP password / provider API key is write-only:
// it appears only in the update request, never in a response. Domain/DNS
// verification is NOT implemented (sender_unverified is reserved, never returned).
// ---------------------------------------------------------------------------

export const EMAIL_SENDER_PROVIDERS = ["disabled", "local", "smtp", "brevo"] as const;
export const EmailSenderProviderSchema = z.enum(EMAIL_SENDER_PROVIDERS);
export type EmailSenderProvider = z.infer<typeof EmailSenderProviderSchema>;

export const EMAIL_SENDER_READINESS_STATUSES = [
  "configured",
  "missing_sender",
  "missing_credential",
  "invalid_credential",
  "provider_unreachable",
  "sender_unverified",
  "unknown",
] as const;
export const EmailSenderReadinessStatusSchema = z.enum(EMAIL_SENDER_READINESS_STATUSES);
export type EmailSenderReadinessStatus = z.infer<typeof EmailSenderReadinessStatusSchema>;

const EmailZ = z.email().max(254);

/** `GET /api/org/email-sender` — redacted; never carries the secret. */
export const EmailSenderSettingsSchema = z
  .object({
    provider: EmailSenderProviderSchema,
    fromName: z.string(),
    fromEmail: z.string(),
    replyToEmail: z.string(),
    enabled: z.boolean(),
    smtpHost: z.string(),
    smtpPort: z.number().int().nonnegative(),
    smtpSecure: z.boolean(),
    smtpUsername: z.string(),
    hasCredential: z.boolean(),
    updatedAt: z.string().nullable(),
    readiness: EmailSenderReadinessStatusSchema,
  })
  .strict();
export type EmailSenderSettings = z.infer<typeof EmailSenderSettingsSchema>;

/** `PATCH /api/org/email-sender`. smtpPassword/apiKey are write-only; a blank/absent
 * secret preserves the stored one. */
export const UpdateEmailSenderSettingsSchema = z
  .object({
    provider: EmailSenderProviderSchema,
    fromName: z.string().max(120),
    fromEmail: z.string().max(254),
    replyToEmail: z.string().max(254),
    enabled: z.boolean(),
    smtpHost: z.string().max(255).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpUsername: z.string().max(255).optional(),
    smtpPassword: z.string().min(1).max(1024).optional(),
    apiKey: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine((b) => b.provider === "disabled" || EmailZ.safeParse(b.fromEmail).success, {
    message: "a valid fromEmail is required unless the provider is disabled",
    path: ["fromEmail"],
  })
  .refine((b) => b.replyToEmail === "" || EmailZ.safeParse(b.replyToEmail).success, {
    message: "replyToEmail must be a valid email or empty",
    path: ["replyToEmail"],
  })
  .refine((b) => b.provider !== "smtp" || !!(b.smtpHost && b.smtpHost.length > 0), {
    message: "smtpHost is required for the smtp provider",
    path: ["smtpHost"],
  });
export type UpdateEmailSenderSettings = z.infer<typeof UpdateEmailSenderSettingsSchema>;

/** `GET /api/org/email-sender/readiness`. */
export const EmailSenderReadinessResponseSchema = z
  .object({ status: EmailSenderReadinessStatusSchema })
  .strict();
export type EmailSenderReadinessResponse = z.infer<typeof EmailSenderReadinessResponseSchema>;

/** `POST /api/org/email-sender/test`. */
export const TestEmailRequestSchema = z.object({ to: EmailZ }).strict();
export type TestEmailRequest = z.infer<typeof TestEmailRequestSchema>;

export const EMAIL_TEST_RESULTS = [
  "sent",
  "invalid_recipient",
  "missing_sender",
  "missing_credential",
  "invalid_credential",
  "provider_unreachable",
  "disabled",
] as const;
export const EmailTestResultSchema = z.enum(EMAIL_TEST_RESULTS);
export type EmailTestResult = z.infer<typeof EmailTestResultSchema>;

export const TestEmailResponseSchema = z
  .object({ result: EmailTestResultSchema, messageId: z.string().nullable() })
  .strict();
export type TestEmailResponse = z.infer<typeof TestEmailResponseSchema>;

// ---------------------------------------------------------------------------
// Tenant custom domains + DNS/TLS readiness (ADR-0048 / ADR-ACT-0217)
// Read + readiness surface over the existing vanity-domain ownership-challenge
// plumbing (ADR-ACT-0162 add/remove + ADR-ACT-0188 DNS-TXT verification).
// Strict + no-passthrough. The verification `token` is a PUBLIC value the tenant
// publishes in a DNS TXT record — it is not a secret. TLS issuance and live
// end-to-end routing are NOT verified in this pass: `tls` is always `tls_unknown`
// and `routing` is `routing_active` only when the domain has been recorded as
// added to the tenant auth client (a real, persisted fact), else `routing_unknown`.
// Readiness is never faked.
// ---------------------------------------------------------------------------

/** Per-domain ownership/verification status (honest; DNS-TXT proven). */
export const TENANT_DOMAIN_STATUSES = [
  "pending_dns", // a challenge exists but DNS ownership is not yet proven
  "dns_mismatch", // a verify attempt found a TXT record that did not match (transient)
  "verified", // DNS-TXT ownership proven
  "degraded", // the domain store/DNS resolver could not be reached
] as const;
export const TenantDomainStatusSchema = z.enum(TENANT_DOMAIN_STATUSES);
export type TenantDomainStatus = z.infer<typeof TenantDomainStatusSchema>;

/**
 * TLS readiness (ADR-0048 / ADR-ACT-0225). `tls_local_ready` is set only when local
 * Caddy/internal-CA TLS is actually proven; the local web Caddy is HTTP-only (TLS is
 * terminated by Cloudflare in production), so it is NOT claimed in the local stack.
 * `tls_ready` is reserved for proven PUBLIC TLS issuance (deferred).
 */
export const TENANT_DOMAIN_TLS_STATUSES = ["tls_unknown", "tls_local_ready", "tls_ready"] as const;
export const TenantDomainTlsStatusSchema = z.enum(TENANT_DOMAIN_TLS_STATUSES);
export type TenantDomainTlsStatus = z.infer<typeof TenantDomainTlsStatusSchema>;

/**
 * Routing readiness (ADR-0048 / ADR-ACT-0225).
 * - `routing_local_active`: the tenant FQDN routes to the correct tenant context through
 *   the LOCAL reverse proxy (Caddy web profile) — proven by `proof:tenant-domains-routing`.
 * - `routing_active`: reserved for proven PUBLIC canonical routing/cutover (deferred).
 * - `routing_unknown`: not proven.
 */
export const TENANT_DOMAIN_ROUTING_STATUSES = [
  "routing_unknown",
  "routing_local_active",
  "routing_active",
] as const;
export const TenantDomainRoutingStatusSchema = z.enum(TENANT_DOMAIN_ROUTING_STATUSES);
export type TenantDomainRoutingStatus = z.infer<typeof TenantDomainRoutingStatusSchema>;

/** Aggregate domain capability readiness for the tenant. */
export const TENANT_DOMAIN_READINESS_STATUSES = [
  "no_domains", // no custom domain configured (the shared domain still works)
  "pending_verification", // ≥1 domain exists, none verified yet
  "verified", // ≥1 domain has proven DNS ownership
  "degraded", // the domain store could not be read
] as const;
export const TenantDomainReadinessStatusSchema = z.enum(TENANT_DOMAIN_READINESS_STATUSES);
export type TenantDomainReadinessStatus = z.infer<typeof TenantDomainReadinessStatusSchema>;

/** Whether the domain is registered on the tenant auth client (ADR-ACT-0232).
 * `active` means the Keycloak redirect URI + web origin were actually written. */
export const TENANT_DOMAIN_AUTH_CLIENT_STATUSES = ["inactive", "active"] as const;
export const TenantDomainAuthClientStatusSchema = z.enum(TENANT_DOMAIN_AUTH_CLIENT_STATUSES);
export type TenantDomainAuthClientStatus = z.infer<typeof TenantDomainAuthClientStatusSchema>;

/** How the domain came to exist: the built-in slug FQDN or a custom domain. */
export const TENANT_DOMAIN_SOURCES = ["slug", "custom"] as const;
export const TenantDomainSourceSchema = z.enum(TENANT_DOMAIN_SOURCES);
export type TenantDomainSource = z.infer<typeof TenantDomainSourceSchema>;

/** Canonical-domain redirect policy (ADR-ACT-0232). Defaults to no_redirect;
 * the redirect behaviours are future-safe vocabulary and are NOT implemented —
 * marking a domain canonical never forces a redirect until explicitly proven. */
export const TENANT_DOMAIN_REDIRECT_POLICIES = [
  "no_redirect",
  "redirect_slug_to_canonical",
  "redirect_all_to_canonical",
] as const;
export const TenantDomainRedirectPolicySchema = z.enum(TENANT_DOMAIN_REDIRECT_POLICIES);
export type TenantDomainRedirectPolicy = z.infer<typeof TenantDomainRedirectPolicySchema>;

/** `GET /api/org/domains` — one entry per configured domain (full lifecycle,
 * ADR-ACT-0232). Every timestamp is the moment the corresponding state was
 * PROVEN (probe/mutation time), never inferred. */
export const TenantDomainSummarySchema = z
  .object({
    domain: z.string(),
    source: TenantDomainSourceSchema,
    status: TenantDomainStatusSchema,
    authClient: TenantDomainAuthClientStatusSchema,
    tls: TenantDomainTlsStatusSchema,
    routing: TenantDomainRoutingStatusSchema,
    /** CANONICAL MARKER ONLY (ADR-ACT-0232/0236): a primary-display-domain
     * flag. It never executes a redirect and never implies public cutover. */
    canonical: z.boolean(),
    redirectPolicy: TenantDomainRedirectPolicySchema,
    /** Always false until a redirect implementation is explicitly proven —
     * canonical NEVER activates a redirect (ADR-ACT-0236). */
    redirectActive: z.boolean(),
    txtRecord: z.string(),
    createdAt: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    authClientActivatedAt: z.string().nullable(),
    routingLocalProvenAt: z.string().nullable(),
    routingPublicProvenAt: z.string().nullable(),
    tlsLocalProvenAt: z.string().nullable(),
    tlsPublicProvenAt: z.string().nullable(),
    canonicalAt: z.string().nullable(),
  })
  .strict();
export type TenantDomainSummary = z.infer<typeof TenantDomainSummarySchema>;

export const TenantDomainListResponseSchema = z
  .object({ domains: z.array(TenantDomainSummarySchema) })
  .strict();
export type TenantDomainListResponse = z.infer<typeof TenantDomainListResponseSchema>;

/** Hostname rule mirrors the BFF vanity-domain validator (lowercase, labelled, has a dot). */
const DomainZ = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?=.*\.)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/, {
    message: "domain must be a valid lowercase hostname with a TLD",
  });

/** `POST /api/org/domains` — body never carries a tenant id (authority is FQDN/session). */
export const CreateTenantDomainRequestSchema = z.object({ domain: DomainZ }).strict();
export type CreateTenantDomainRequest = z.infer<typeof CreateTenantDomainRequestSchema>;

/** `POST /api/org/domains` (201) and `POST /api/org/domains/:domain/verify`. */
export const TenantDomainVerificationResponseSchema = z
  .object({
    domain: z.string(),
    status: TenantDomainStatusSchema,
    txtRecord: z.string(),
    /** The PUBLIC DNS-TXT token to publish. Present on create; null after verify. */
    token: z.string().nullable(),
  })
  .strict();
export type TenantDomainVerificationResponse = z.infer<
  typeof TenantDomainVerificationResponseSchema
>;

/** `GET /api/org/domains/readiness`. */
export const TenantDomainReadinessResponseSchema = z
  .object({
    status: TenantDomainReadinessStatusSchema,
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  })
  .strict();
export type TenantDomainReadinessResponse = z.infer<typeof TenantDomainReadinessResponseSchema>;

/** `POST /api/org/domains/:domain/activate` — auth-client activation result.
 * Requires DNS-verified ownership; performed under tenant.domains.write. */
export const TenantDomainActivationResponseSchema = z
  .object({
    domain: z.string(),
    authClient: TenantDomainAuthClientStatusSchema,
    authClientActivatedAt: z.string().nullable(),
  })
  .strict();
export type TenantDomainActivationResponse = z.infer<typeof TenantDomainActivationResponseSchema>;

/** `POST /api/org/domains/:domain/probe-routing-local` — LOCAL routing probe.
 * `routing` upgrades to routing_local_active ONLY when the local proxy was
 * reachable AND the response proved the expected tenant context. Never claims
 * public routing. */
export const TenantDomainRoutingProbeResponseSchema = z
  .object({
    domain: z.string(),
    reachable: z.boolean(),
    tenantContextMatched: z.boolean(),
    routing: TenantDomainRoutingStatusSchema,
    routingLocalProvenAt: z.string().nullable(),
  })
  .strict();
export type TenantDomainRoutingProbeResponse = z.infer<
  typeof TenantDomainRoutingProbeResponseSchema
>;

/** `POST` / `DELETE /api/org/domains/:domain/canonical`. Canonical is a
 * MARKER (primary display domain) — `redirectActive` is always false until a
 * redirect implementation is explicitly proven; no public cutover is implied. */
export const TenantDomainCanonicalResponseSchema = z
  .object({
    domain: z.string(),
    canonical: z.boolean(),
    canonicalAt: z.string().nullable(),
    redirectPolicy: TenantDomainRedirectPolicySchema,
    redirectActive: z.boolean(),
  })
  .strict();
export type TenantDomainCanonicalResponse = z.infer<typeof TenantDomainCanonicalResponseSchema>;

/** `GET /api/host-identity` — public, host-keyed (ADR-ACT-0231/0232).
 * Returns the host classification + the resolved tenant slug (public values
 * only — the slug is already visible in the tenant URL; no ids, no secrets). */
export const HostIdentityResponseSchema = z
  .object({
    kind: z.enum([
      "apex",
      "tenant_slug",
      "reserved_subdomain",
      "invalid_subdomain",
      "custom_domain_candidate",
      "malformed",
    ]),
    tenant: z
      .object({
        slug: z.string(),
        hostSource: z.enum(["slug", "custom_domain"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type HostIdentityResponse = z.infer<typeof HostIdentityResponseSchema>;

// ---------------------------------------------------------------------------
// Tenant storage readiness + isolation proof (ADR-0049 / ADR-ACT-0218)
// Read + probe surface over the existing ObjectStoragePort (@platform/storage-runtime)
// and the prefix-per-tenant S3/MinIO adapter (@platform/adapters-object-storage,
// ADR-0029 §6 / ADR-0031). Strict + no-passthrough. No storage credential is ever
// returned — only whether the platform is configured + the tenant key prefix.
// Readiness is `configured` only after a real write/read/delete probe round-trip;
// `not_configured` when no S3 endpoint/credentials are wired (honest, never faked).
// ---------------------------------------------------------------------------

export const TENANT_STORAGE_READINESS_STATUSES = [
  "configured", // probe round-trip succeeded (write → read → delete)
  "not_configured", // no S3 endpoint / admin credentials wired for the platform
  "provider_unreachable", // the object store could not be reached
  "isolation_failed", // the tenant prefix guard did not reject a foreign key
  "unknown",
] as const;
export const TenantStorageReadinessStatusSchema = z.enum(TENANT_STORAGE_READINESS_STATUSES);
export type TenantStorageReadinessStatus = z.infer<typeof TenantStorageReadinessStatusSchema>;

/** `GET /api/org/storage/readiness` — never carries a credential. */
export const TenantStorageReadinessResponseSchema = z
  .object({
    status: TenantStorageReadinessStatusSchema,
    /** The tenant's object-key prefix (`{organisationId}/`) — ADR-0029 §6. */
    prefix: z.string(),
    /** Whether an S3/MinIO endpoint + admin credentials are wired for the platform. */
    endpointConfigured: z.boolean(),
    /** Whether the adapter enforces the tenant prefix (defence-in-depth before IAM). */
    isolationEnforced: z.boolean(),
  })
  .strict();
export type TenantStorageReadinessResponse = z.infer<typeof TenantStorageReadinessResponseSchema>;

/** `POST /api/org/storage/probe` — operator-triggered live write/read/delete probe. */
export const TenantStorageProbeResultSchema = z
  .object({
    status: TenantStorageReadinessStatusSchema,
    wrote: z.boolean(),
    read: z.boolean(),
    deleted: z.boolean(),
    /** The tenant adapter rejected a deliberately foreign (cross-prefix) key. */
    foreignKeyRejected: z.boolean(),
  })
  .strict();
export type TenantStorageProbeResult = z.infer<typeof TenantStorageProbeResultSchema>;

// ---------------------------------------------------------------------------
// Tenant observability readiness (ADR-0050 / ADR-ACT-0219)
// Read-only readiness over the existing Loki log-search plumbing
// (@platform/adapters-loki + searchLogs). Strict + no-passthrough. A bounded,
// tenant-scoped log query is the live check; the high-cardinality-label guard
// (low-cardinality service/level → Loki labels; tenant/trace/request ids →
// `| json` field filters) is asserted structurally so it cannot regress.
// No log line or label value is ever returned — only signal statuses.
// ---------------------------------------------------------------------------

export const OBSERVABILITY_SIGNAL_STATUSES = [
  "ok", // the signal was exercised successfully
  "unreachable", // the backend is configured but could not be reached
  "not_configured", // no endpoint/DSN wired for this signal
  "not_applicable", // intentionally not part of this pass (e.g. no backend exists)
  "unknown",
] as const;
export const ObservabilitySignalStatusSchema = z.enum(OBSERVABILITY_SIGNAL_STATUSES);
export type ObservabilitySignalStatus = z.infer<typeof ObservabilitySignalStatusSchema>;

export const TENANT_OBSERVABILITY_READINESS_STATUSES = [
  "configured", // log ingestion reachable + tenant-scoped query ok + guard intact
  "not_configured", // no log backend wired
  "provider_unreachable", // the log backend could not be reached
  "degraded", // reachable but a signal is not healthy
  "unknown",
] as const;
export const TenantObservabilityReadinessStatusSchema = z.enum(
  TENANT_OBSERVABILITY_READINESS_STATUSES
);
export type TenantObservabilityReadinessStatus = z.infer<
  typeof TenantObservabilityReadinessStatusSchema
>;

/** `GET /api/org/observability/readiness`. Each signal is probed honestly; a service
 * that is not wired is `not_configured` and one with no local backend is `not_applicable`
 * — never `ok`. No log line, trace payload, label value, tenant data, or secret/DSN is
 * returned. */
export const TenantObservabilityReadinessResponseSchema = z
  .object({
    status: TenantObservabilityReadinessStatusSchema,
    /** Whether a bounded log query against the backend succeeded (Loki). */
    logIngestion: ObservabilitySignalStatusSchema,
    /** Whether a bounded tenant-scoped log query succeeded. */
    tenantScopedQuery: ObservabilitySignalStatusSchema,
    /** Whether the metrics backend is reachable (`not_applicable` if none locally). */
    metrics: ObservabilitySignalStatusSchema,
    /** Trace/log correlation readiness (`not_applicable` until a trace backend exists). */
    traceCorrelation: ObservabilitySignalStatusSchema,
    /** Whether the OTel collector health endpoint is reachable. */
    otelCollector: ObservabilitySignalStatusSchema,
    /** Whether Grafana (dashboards) is reachable. */
    dashboards: ObservabilitySignalStatusSchema,
    /** Whether error-capture (Sentry) is configured + reachable. */
    errorCapture: ObservabilitySignalStatusSchema,
    /** True when high-cardinality fields stay `| json` filters, not Loki labels. */
    highCardinalityGuard: z.boolean(),
  })
  .strict();
export type TenantObservabilityReadinessResponse = z.infer<
  typeof TenantObservabilityReadinessResponseSchema
>;

// ---------------------------------------------------------------------------
// Integrations / webhooks (ADR-0051 / ADR-ACT-0221)
// Per-tenant outbound webhook subscriptions. Strict + no-passthrough. The signing
// secret is reveal-once: it is returned ONLY by create + rotate, stored AES-256-GCM
// encrypted, and never returned by any read (only `hasSecret`). Payloads are signed
// HMAC-SHA-256 over `<timestamp>.<body>` (replay-protected). The request body never
// carries a tenant id (authority is FQDN/session). The async retry worker is NOT
// implemented this pass: a test dispatch is a single immediate attempt, recorded in
// the delivery log; the retry policy is documented config only.
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENT_TYPES = [
  "platform.test",
  "tenant.member.invited",
  "tenant.config.changed",
] as const;
export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WEBHOOK_DELIVERY_STATUSES = ["delivered", "failed", "pending", "dead"] as const;
export const WebhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

export const WEBHOOK_READINESS_STATUSES = [
  "no_subscriptions", // none configured (optional capability)
  "configured", // ≥1 enabled subscription, no dead deliveries
  "has_dead_deliveries", // ≥1 dead (exhausted) delivery awaiting redrive (ADR-ACT-0226)
  "degraded", // store unreachable
  "unknown",
] as const;
export const WebhookReadinessStatusSchema = z.enum(WEBHOOK_READINESS_STATUSES);
export type WebhookReadinessStatus = z.infer<typeof WebhookReadinessStatusSchema>;

/**
 * Endpoint URL: https only, except http is allowed for localhost/127.0.0.1 (local
 * receiver/proof). Any non-http(s) scheme (file:, gopher:, ftp:, …) is rejected.
 */
const WebhookUrlZ = z
  .url()
  .max(2048)
  .refine(
    (raw) => {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        return false;
      }
      if (u.protocol === "https:") return true;
      if (u.protocol === "http:") {
        return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
      }
      return false;
    },
    { message: "url must be https (http allowed only for localhost)" }
  );

/** `GET /api/org/webhooks` — never carries the secret (only `hasSecret`). */
export const WebhookSubscriptionSummarySchema = z
  .object({
    id: z.string(),
    url: z.string(),
    enabled: z.boolean(),
    eventTypes: z.array(WebhookEventTypeSchema),
    hasSecret: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();
export type WebhookSubscriptionSummary = z.infer<typeof WebhookSubscriptionSummarySchema>;

export const WebhookSubscriptionListResponseSchema = z
  .object({ subscriptions: z.array(WebhookSubscriptionSummarySchema) })
  .strict();
export type WebhookSubscriptionListResponse = z.infer<typeof WebhookSubscriptionListResponseSchema>;

/** `POST /api/org/webhooks` — body never carries a tenant id. */
export const CreateWebhookSubscriptionRequestSchema = z
  .object({
    url: WebhookUrlZ,
    eventTypes: z.array(WebhookEventTypeSchema).min(1).max(20),
    enabled: z.boolean().optional(),
  })
  .strict();
export type CreateWebhookSubscriptionRequest = z.infer<
  typeof CreateWebhookSubscriptionRequestSchema
>;

/** `PATCH /api/org/webhooks/:id`. */
export const UpdateWebhookSubscriptionRequestSchema = z
  .object({
    url: WebhookUrlZ.optional(),
    eventTypes: z.array(WebhookEventTypeSchema).min(1).max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type UpdateWebhookSubscriptionRequest = z.infer<
  typeof UpdateWebhookSubscriptionRequestSchema
>;

/** `POST /api/org/webhooks` (201) — the secret is revealed ONCE here. */
export const CreateWebhookSubscriptionResponseSchema = z
  .object({ subscription: WebhookSubscriptionSummarySchema, secret: z.string() })
  .strict();
export type CreateWebhookSubscriptionResponse = z.infer<
  typeof CreateWebhookSubscriptionResponseSchema
>;

/** `POST /api/org/webhooks/:id/rotate-secret` — reveals the new secret ONCE. */
export const WebhookSecretRotationResponseSchema = z
  .object({ id: z.string(), secret: z.string() })
  .strict();
export type WebhookSecretRotationResponse = z.infer<typeof WebhookSecretRotationResponseSchema>;

export const WebhookDeliverySummarySchema = z
  .object({
    id: z.string(),
    event: WebhookEventTypeSchema,
    status: WebhookDeliveryStatusSchema,
    responseStatus: z.number().int().nullable(),
    attempt: z.number().int().nonnegative(),
    error: z.string().nullable(),
    createdAt: z.string().nullable(),
  })
  .strict();
export type WebhookDeliverySummary = z.infer<typeof WebhookDeliverySummarySchema>;

export const WebhookDeliveryListResponseSchema = z
  .object({ deliveries: z.array(WebhookDeliverySummarySchema) })
  .strict();
export type WebhookDeliveryListResponse = z.infer<typeof WebhookDeliveryListResponseSchema>;

/** `POST /api/org/webhooks/:id/test`. */
export const WebhookTestResultSchema = z
  .object({
    status: WebhookDeliveryStatusSchema,
    responseStatus: z.number().int().nullable(),
  })
  .strict();
export type WebhookTestResult = z.infer<typeof WebhookTestResultSchema>;

/** `GET /api/org/webhooks/readiness`. */
export const WebhookReadinessResponseSchema = z
  .object({
    status: WebhookReadinessStatusSchema,
    total: z.number().int().nonnegative(),
    enabled: z.number().int().nonnegative(),
    /** Count of dead (exhausted) deliveries across the tenant's subscriptions. */
    deadDeliveries: z.number().int().nonnegative(),
  })
  .strict();
export type WebhookReadinessResponse = z.infer<typeof WebhookReadinessResponseSchema>;

// --- Per-subscription delivery metrics + dead-letter redrive (ADR-ACT-0226) ---
// Safe metadata only: counts + status/timestamps. NEVER the payload body, headers,
// signing secret, or any tenant data.

/** `GET /api/org/webhooks/:id/metrics`. */
export const WebhookSubscriptionMetricsSchema = z
  .object({
    subscriptionId: z.string(),
    total: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    lastStatus: WebhookDeliveryStatusSchema.nullable(),
    lastDeliveryAt: z.string().nullable(),
    lastSuccessAt: z.string().nullable(),
    lastFailureAt: z.string().nullable(),
  })
  .strict();
export type WebhookSubscriptionMetrics = z.infer<typeof WebhookSubscriptionMetricsSchema>;

/** `POST /api/org/webhooks/:id/deliveries/:deliveryId/redrive` and the bulk variant. */
export const WebhookRedriveResponseSchema = z
  .object({
    /** Number of dead deliveries requeued as pending (1 for single, n for bulk). */
    redriven: z.number().int().nonnegative(),
  })
  .strict();
export type WebhookRedriveResponse = z.infer<typeof WebhookRedriveResponseSchema>;

// ---------------------------------------------------------------------------
// Platform operations cockpit — service readiness + workers (ADR-ACT-0228)
// A safe, read-only operator view: local-service health + background-worker status.
// Strict + no-passthrough. NEVER carries secrets, credentials, DSNs, or raw env —
// only known-safe LOCAL console URLs (localhost), statuses, and timestamps.
// ---------------------------------------------------------------------------

export const PLATFORM_SERVICE_STATUSES = [
  "healthy", // probed and responding
  "configured", // wired + connected at startup (no per-call probe)
  "degraded", // reachable but unhealthy
  "unreachable", // configured but not responding (e.g. profile not running)
  "not_configured", // no endpoint wired for this environment
  "not_applicable", // no local backend for this signal
  "blocked", // requires an external dependency not available locally
  "unknown",
] as const;
export const PlatformServiceStatusSchema = z.enum(PLATFORM_SERVICE_STATUSES);
export type PlatformServiceStatus = z.infer<typeof PlatformServiceStatusSchema>;

export const PLATFORM_SERVICE_CATEGORIES = [
  "data",
  "storage",
  "mail",
  "observability",
  "auth",
  "mocks",
  "web",
  "quality",
] as const;
export const PlatformServiceCategorySchema = z.enum(PLATFORM_SERVICE_CATEGORIES);
export type PlatformServiceCategory = z.infer<typeof PlatformServiceCategorySchema>;

// Console-link exposure classification (ADR-ACT-0233 clickthrough policy projected
// onto the cockpit). tenant_safe = link may be shown to tenant-admin (a REAL isolation
// invariant exists); global_only = system operator only; not_exposed = never linked.
export const PLATFORM_CONSOLE_ACCESS = ["tenant_safe", "global_only", "not_exposed"] as const;
export const PlatformConsoleAccessSchema = z.enum(PLATFORM_CONSOLE_ACCESS);
export type PlatformConsoleAccess = z.infer<typeof PlatformConsoleAccessSchema>;

/** How a console URL reaches the service (ADR-ACT-0236): `routed` = through the
 * Caddy/forward-auth path on the viewer's host; `direct_local` = a direct
 * localhost service port (operator-labelled, never implied tenant-safe). */
export const PLATFORM_CONSOLE_URL_KINDS = ["routed", "direct_local"] as const;
export const PlatformConsoleUrlKindSchema = z.enum(PLATFORM_CONSOLE_URL_KINDS);
export type PlatformConsoleUrlKind = z.infer<typeof PlatformConsoleUrlKindSchema>;

/** Who the readiness payload was rendered for (ADR-ACT-0236 host authority):
 * tenant_operator = tenant-resolved FQDN viewer (tenant-safe view, even for a
 * system-admin without support escalation); system_operator = system-admin on
 * the apex host (global-only console links present). */
export const PLATFORM_VIEWER_MODES = ["tenant_operator", "system_operator"] as const;
export const PlatformViewerModeSchema = z.enum(PLATFORM_VIEWER_MODES);
export type PlatformViewerMode = z.infer<typeof PlatformViewerModeSchema>;

export const PlatformServiceSummarySchema = z
  .object({
    key: z.string(),
    labelKey: z.string(),
    category: PlatformServiceCategorySchema,
    status: PlatformServiceStatusSchema,
    /** True for local-only dev services (never implies production readiness). */
    localOnly: z.boolean(),
    /**
     * A known-safe LOCAL operator console URL (localhost), or null. Never a secret.
     * The BFF nulls this for global-only consoles unless the viewer is system-admin.
     */
    consoleUrl: z.string().nullable(),
    /** Who may see this service's console link (server-enforced, UI-informative). */
    consoleAccess: PlatformConsoleAccessSchema,
    /** Routed-vs-direct labelling for the console URL; null when no URL. */
    consoleUrlKind: PlatformConsoleUrlKindSchema.nullable(),
    checkedAt: z.string(),
    detailKey: z.string().nullable(),
  })
  .strict();
export type PlatformServiceSummary = z.infer<typeof PlatformServiceSummarySchema>;

export const PLATFORM_WORKER_STATUSES = ["running", "idle", "stopped", "error", "unknown"] as const;
export const PlatformWorkerStatusSchema = z.enum(PLATFORM_WORKER_STATUSES);
export type PlatformWorkerStatus = z.infer<typeof PlatformWorkerStatusSchema>;

export const PlatformWorkerSummarySchema = z
  .object({
    key: z.string(),
    labelKey: z.string(),
    enabled: z.boolean(),
    intervalMs: z.number().int().nonnegative(),
    lastTickAt: z.string().nullable(),
    /** A safe, non-secret error summary from the last tick, or null. */
    lastError: z.string().nullable(),
    status: PlatformWorkerStatusSchema,
    /** Heartbeat is in-memory and resets on process restart. */
    inMemory: z.boolean(),
  })
  .strict();
export type PlatformWorkerSummary = z.infer<typeof PlatformWorkerSummarySchema>;

/** `GET /api/org/platform/services/readiness`. */
export const PlatformServicesReadinessResponseSchema = z
  .object({
    environment: z.string(),
    appVersion: z.string().nullable(),
    /** Host-authority-derived view the payload was rendered for (ADR-ACT-0236). */
    viewerMode: PlatformViewerModeSchema,
    services: z.array(PlatformServiceSummarySchema),
    workers: z.array(PlatformWorkerSummarySchema),
  })
  .strict();
export type PlatformServicesReadinessResponse = z.infer<
  typeof PlatformServicesReadinessResponseSchema
>;

export const MfaRequirementSchema = z.enum(["none", "optional", "required"]);
export const MfaTypeSchema = z.enum(["totp", "webauthn"]);

/** `GET/PATCH /api/auth/settings/mfa`. */
export const MfaPolicySchema = z.object({
  required: MfaRequirementSchema,
  type: MfaTypeSchema,
  gracePeriodSeconds: z.number().int().nonnegative().optional(),
});
export type MfaPolicyDto = z.infer<typeof MfaPolicySchema>;

export const LockoutPolicySchema = z.object({
  enabled: z.boolean(),
  maxFailureWaitSeconds: z.number().int().positive(),
  failureFactor: z.number().int().positive(),
  waitIncrementSeconds: z.number().int().positive(),
  quickLoginCheckMilliSeconds: z.number().int().positive(),
  minimumQuickLoginWaitSeconds: z.number().int().positive(),
  maxDeltaTimeSeconds: z.number().int().positive(),
  failureResetTimeSeconds: z.number().int().positive(),
  permanentLockout: z.boolean(),
});
export type LockoutPolicyDto = z.infer<typeof LockoutPolicySchema>;

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
    organisationId: z.uuid(),
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
export const AUDIT_RESOURCES = [
  "member",
  "config",
  "feature",
  "auth_settings",
  "entitlement",
  "quota",
] as const;
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
      if (typeof value !== "string" || !allowedValues?.includes(value)) {
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

// ---------------------------------------------------------------------------
// Entitlements (ADR-0057 / ADR-0058 / ADR-ACT-0254) — REST surface
//
// Entitlements answer "what is this tenant allowed to use?" — tenant-scoped,
// system-operator assigned, audited. They are NOT feature flags and NOT
// permissions. Absence of a granted entitlement means the capability is
// unavailable (deny-by-default, ADR-0058). Quota metadata may appear but quota
// ENFORCEMENT is Phase 2 (ADR-0057, not delivered): `quota.status` is always
// "not_enforced" / "not_applicable" in Phase 1.
// ---------------------------------------------------------------------------

export const ENTITLEMENT_KEYS = [
  "webhooks",
  "custom_domains",
  "advanced_observability",
  "storage",
  "api_access",
] as const;
export const EntitlementKeySchema = z.enum(ENTITLEMENT_KEYS);
export type EntitlementKey = z.infer<typeof EntitlementKeySchema>;

export const ENTITLEMENT_STATES = ["granted", "revoked", "not_granted"] as const;
export const EntitlementStateSchema = z.enum(ENTITLEMENT_STATES);
export type EntitlementState = z.infer<typeof EntitlementStateSchema>;

export const ENTITLEMENT_QUOTA_STATUSES = ["not_enforced", "not_applicable"] as const;
export const EntitlementQuotaStatusSchema = z.enum(ENTITLEMENT_QUOTA_STATUSES);
export type EntitlementQuotaStatus = z.infer<typeof EntitlementQuotaStatusSchema>;

/** A single entitlement as seen by admin + tenant read views. Server-authoritative;
 * `state` is "not_granted" when the tenant has no row for the key (deny-by-default). */
export const EntitlementSummarySchema = z.object({
  key: EntitlementKeySchema,
  displayName: z.string(),
  description: z.string(),
  category: z.string(),
  state: EntitlementStateSchema,
  source: z.enum(["system", "migration", "seed"]).nullable(),
  requiresProvider: z.boolean(),
  providerKey: z.string().nullable(),
  // Phase-1 quota is a hook only — it never claims enforcement.
  quota: z.object({ status: EntitlementQuotaStatusSchema }),
  note: z.string().nullable(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type EntitlementSummary = z.infer<typeof EntitlementSummarySchema>;

export const EntitlementListResponseSchema = z.object({
  entitlements: z.array(EntitlementSummarySchema),
});
export type EntitlementListResponse = z.infer<typeof EntitlementListResponseSchema>;

/** `PATCH /api/admin/tenants/:tenantId/entitlements` — system-operator only, audited.
 * No tenant id in the body (taken from the path); a tenant can never self-grant. */
export const SetEntitlementRequestSchema = z
  .object({
    key: EntitlementKeySchema,
    state: z.enum(["granted", "revoked"]),
    note: z.string().max(500).optional(),
  })
  .strict();
export type SetEntitlementRequest = z.infer<typeof SetEntitlementRequestSchema>;

// ---------------------------------------------------------------------------
// Service catalog v2 (ADR-0055 / ADR-ACT-0254) — GET /api/platform/service-catalog
//
// Operator-facing catalog of backing services + providers. Carries NO secrets
// and NO provider credentials. `visibility` mirrors the clickthrough policy
// (ADR-ACT-0233): `not_exposed` is never listed to tenants; `global_only` is
// system-admin only; `tenant_scoped_safe` may be shown to tenants.
// ---------------------------------------------------------------------------

export const SERVICE_VISIBILITIES = ["tenant_scoped_safe", "global_only", "not_exposed"] as const;
export const ServiceVisibilitySchema = z.enum(SERVICE_VISIBILITIES);
export type ServiceVisibility = z.infer<typeof ServiceVisibilitySchema>;

export const ServiceCatalogEntrySchema = z.object({
  serviceKey: z.string(),
  serviceName: z.string(),
  category: z.string(),
  environmentModel: z.string(),
  visibility: ServiceVisibilitySchema,
  decision: z.enum(["build", "compose", "adapter", "defer", "reject"]),
  requiresEntitlement: z.boolean(),
  entitlementKey: z.string().nullable(),
  localProvider: z.string(),
  productionProvider: z.string().nullable(),
  mockProvider: z.string().nullable(),
  forbiddenInProduction: z.boolean(),
  isolationNotes: z.string(),
  proofRefs: z.array(z.string()),
});
export type ServiceCatalogEntry = z.infer<typeof ServiceCatalogEntrySchema>;

export const ServiceCatalogResponseSchema = z.object({
  services: z.array(ServiceCatalogEntrySchema),
  generatedFrom: z.string(),
});
export type ServiceCatalogResponse = z.infer<typeof ServiceCatalogResponseSchema>;

// ---------------------------------------------------------------------------
// Tenant lookup (ADR-ACT-0255) — GET /api/admin/tenants
//
// A small, read-only, system-operator lookup so the entitlement console can pick
// a tenant by slug/name instead of pasting a raw UUID. NOT a tenant-management
// product: id + slug + display name only, capped, no secrets.
// ---------------------------------------------------------------------------

export const TenantLookupItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});
export type TenantLookupItem = z.infer<typeof TenantLookupItemSchema>;

export const TenantLookupResponseSchema = z.object({
  tenants: z.array(TenantLookupItemSchema),
  truncated: z.boolean(),
});
export type TenantLookupResponse = z.infer<typeof TenantLookupResponseSchema>;

// ---------------------------------------------------------------------------
// Metering + quota (ADR-0067 / ADR-ACT-0256) — Phase 2 usage/quota surface.
//
// Metering answers "how much usage was recorded?"; quota answers "is the next
// action allowed under the tenant's entitlement/limit?". Server-authoritative;
// React only displays state returned by the BFF. No secrets. Billing (what to
// charge) is NOT delivered — that is Phase 9.
// ---------------------------------------------------------------------------

export const METER_KEYS = [
  "webhooks.deliveries",
  "storage.bytes",
  "custom_domains.count",
  "observability.log_queries",
] as const;
export const MeterKeySchema = z.enum(METER_KEYS);
export type MeterKey = z.infer<typeof MeterKeySchema>;

export const QUOTA_WINDOWS = ["daily", "monthly", "rolling_30d", "lifetime"] as const;
export const QuotaWindowSchema = z.enum(QUOTA_WINDOWS);
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;

export const QUOTA_ACTIONS = ["allow", "deny"] as const;
export const QuotaActionSchema = z.enum(QUOTA_ACTIONS);
export type QuotaAction = z.infer<typeof QuotaActionSchema>;

/** `POST /api/admin/tenants/:tenantId/meter-events` — operator/internal ingestion.
 * Idempotent by tenant + meterKey + idempotencyKey. quantity must be > 0 unless the
 * event is an explicit adjustment (metadata.adjustment === true). */
export const RecordMeterEventRequestSchema = z
  .object({
    meterKey: MeterKeySchema,
    quantity: z.number(),
    idempotencyKey: z.string().min(1).max(200),
    subjectId: z.string().max(200).optional(),
    occurredAt: z.string().optional(),
    source: z.string().max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RecordMeterEventRequest = z.infer<typeof RecordMeterEventRequestSchema>;

export const MeterEventResultSchema = z.object({
  recorded: z.boolean(),
  deduplicated: z.boolean(),
});
export type MeterEventResult = z.infer<typeof MeterEventResultSchema>;

export const UsageItemSchema = z.object({
  meterKey: MeterKeySchema,
  displayName: z.string(),
  window: QuotaWindowSchema,
  usage: z.number(),
});
export type UsageItem = z.infer<typeof UsageItemSchema>;

export const UsageResponseSchema = z.object({ usage: z.array(UsageItemSchema) });
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export const QUOTA_STATES = ["within", "exceeded", "no_entitlement", "no_quota"] as const;
export const QuotaStateSchema = z.enum(QUOTA_STATES);
export type QuotaState = z.infer<typeof QuotaStateSchema>;

export const QuotaSummarySchema = z.object({
  quotaKey: z.string(),
  entitlementKey: z.string(),
  meterKey: MeterKeySchema,
  limit: z.number(),
  window: QuotaWindowSchema,
  action: QuotaActionSchema,
  usage: z.number(),
  allowed: z.boolean(),
  state: QuotaStateSchema,
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type QuotaSummary = z.infer<typeof QuotaSummarySchema>;

export const QuotaListResponseSchema = z.object({ quotas: z.array(QuotaSummarySchema) });
export type QuotaListResponse = z.infer<typeof QuotaListResponseSchema>;

/** `PATCH /api/admin/tenants/:tenantId/quotas` — system-operator only, audited. */
export const SetQuotaRequestSchema = z
  .object({
    quotaKey: z.string().min(1).max(100),
    entitlementKey: EntitlementKeySchema,
    meterKey: MeterKeySchema,
    limit: z.number().int().nonnegative(),
    window: QuotaWindowSchema,
    action: QuotaActionSchema.optional(),
  })
  .strict();
export type SetQuotaRequest = z.infer<typeof SetQuotaRequestSchema>;

// ---------------------------------------------------------------------------
// Developer platform — API keys / PATs + rate limits (Phase 3, ADR-0065 /
// ADR-ACT-0257). API keys are SERVER-generated: only a salted+peppered hash is
// stored, the plaintext secret is shown EXACTLY ONCE on creation and never again.
// Keys are tenant-scoped, revocable, and entitlement-gated (`api_access`). No
// list/read route ever returns the secret or the hash. Rate limits reuse the
// entitlement gate (bridge to the quota substrate) and a durable fixed-window
// counter; React only renders the state the BFF returns.
// ---------------------------------------------------------------------------

/** Coarse scopes an API key may carry. Read-only foundation — write/admin scopes
 * exist for forward-compatibility but the gateway enforcement is Phase 3.5. */
export const API_KEY_SCOPES = ["read", "write", "admin"] as const;
export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const API_KEY_STATES = ["active", "revoked", "expired"] as const;
export const ApiKeyStateSchema = z.enum(API_KEY_STATES);
export type ApiKeyState = z.infer<typeof ApiKeyStateSchema>;

/** Non-secret API-key summary. NEVER carries the secret or the stored hash. */
export const ApiKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  // Non-secret display handle (e.g. "pk_a1b2c3"); safe to show in lists.
  keyPrefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  state: ApiKeyStateSchema,
  createdAt: z.string(),
  createdBy: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummarySchema>;

export const ApiKeyListResponseSchema = z.object({ apiKeys: z.array(ApiKeySummarySchema) });
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;

/** `POST /api/org/api-keys` — tenant self-service mint. */
export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    scopes: z.array(ApiKeyScopeSchema).max(8).optional(),
    expiresAt: z.string().optional(),
  })
  .strict();
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/** Creation response — the ONLY time `secret` is ever returned. */
export const CreateApiKeyResponseSchema = z.object({
  apiKey: ApiKeySummarySchema,
  // Plaintext, shown once. The server stores only a hash; this is never recoverable.
  secret: z.string(),
  secretShownOnce: z.literal(true),
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;

// --- Rate limits ----------------------------------------------------------

export const RATE_LIMIT_ACTIONS = ["allow", "deny"] as const;
export const RateLimitActionSchema = z.enum(RATE_LIMIT_ACTIONS);
export type RateLimitAction = z.infer<typeof RateLimitActionSchema>;

export const RATE_LIMIT_STATES = ["within", "exceeded", "no_entitlement", "no_policy"] as const;
export const RateLimitStateSchema = z.enum(RATE_LIMIT_STATES);
export type RateLimitState = z.infer<typeof RateLimitStateSchema>;

export const RateLimitPolicySummarySchema = z.object({
  policyKey: z.string(),
  entitlementKey: EntitlementKeySchema,
  limit: z.number(),
  windowSeconds: z.number(),
  action: RateLimitActionSchema,
  // Current count in the live window + derived state (BFF-computed; not authoritative client-side).
  used: z.number(),
  state: RateLimitStateSchema,
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type RateLimitPolicySummary = z.infer<typeof RateLimitPolicySummarySchema>;

export const RateLimitListResponseSchema = z.object({
  policies: z.array(RateLimitPolicySummarySchema),
});
export type RateLimitListResponse = z.infer<typeof RateLimitListResponseSchema>;

/** `PATCH /api/admin/tenants/:tenantId/rate-limits` — operator-only, audited. */
export const SetRateLimitRequestSchema = z
  .object({
    policyKey: z.string().min(1).max(100),
    entitlementKey: EntitlementKeySchema,
    limit: z.number().int().nonnegative(),
    windowSeconds: z.number().int().positive().max(86400),
    action: RateLimitActionSchema.optional(),
  })
  .strict();
export type SetRateLimitRequest = z.infer<typeof SetRateLimitRequestSchema>;

// --- Developer portal foundation (read-only) ------------------------------

/** `GET /api/org/developer` — read-only developer foundation: where to find the
 * API surface + a non-secret summary of the tenant's programmatic access. */
export const DeveloperPortalResponseSchema = z.object({
  apiAccessEntitled: z.boolean(),
  activeKeyCount: z.number(),
  // Primary client boundary (ADR-0013) + the supplementary REST baseline (read-only links).
  graphqlEndpoint: z.string(),
  restBaselinePath: z.string(),
  openapiPath: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  rateLimitPolicyCount: z.number(),
});
export type DeveloperPortalResponse = z.infer<typeof DeveloperPortalResponseSchema>;

// ---------------------------------------------------------------------------
// Tenant-isolated product search (Phase 4, ADR-0060 / ADR-ACT-0258).
// Built-in Postgres full-text search; tenant-scoped (RLS) + permission-aware.
// Meilisearch/Typesense/OpenSearch remain Phase-4.5 provider adapters behind the
// same ports. Search runs server-side (BFF only); no secret fields are indexed or
// returned. React renders BFF results only.
// ---------------------------------------------------------------------------

/** `POST /api/org/search` — tenant full-text query. `q` is plain text (parsed
 * server-side via plainto_tsquery); never raw tsquery from the client. */
export const SearchRequestSchema = z
  .object({
    q: z.string().min(1).max(200),
    documentType: z.string().min(1).max(60).optional(),
    page: z.number().int().positive().max(1000).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

/** A single search hit. Carries no body and no secret/metadata fields. */
export const SearchHitSchema = z.object({
  documentId: z.string(),
  documentType: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema),
  total: z.number(),
  tookMs: z.number(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SEARCH_READINESS_STATES = ["ready", "degraded", "blocked"] as const;
export const SearchReadinessStateSchema = z.enum(SEARCH_READINESS_STATES);
export type SearchReadinessState = z.infer<typeof SearchReadinessStateSchema>;

/** `GET /api/admin/search/readiness` — operator view. Never faked: `blocked` if the
 * search store is unreachable, `degraded` if reachable but empty/partial. */
export const SearchReadinessResponseSchema = z.object({
  engine: z.string(),
  status: SearchReadinessStateSchema,
  documentCount: z.number(),
  detail: z.string(),
});
export type SearchReadinessResponse = z.infer<typeof SearchReadinessResponseSchema>;

/** `POST /api/admin/search/reindex` — operator-only, audited. Rebuilds the
 * tsvector for a tenant's documents. */
export const ReindexRequestSchema = z.object({ tenantId: z.uuid() }).strict();
export type ReindexRequest = z.infer<typeof ReindexRequestSchema>;

export const ReindexResponseSchema = z.object({
  reindexed: z.number(),
});
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;

// ---------------------------------------------------------------------------
// Event bus + durable workers + DLQ/redrive (Phase 5, ADR-0059 / ADR-ACT-0259).
// Built-in Postgres outbox; tenant-scoped (RLS) + idempotent. Operator-facing read
// surfaces + redrive. No secret payload fields (rejected at publish). Redis Streams /
// NATS remain Phase-5.5 providers behind the EventBusPort.
// ---------------------------------------------------------------------------

export const EVENT_STATUSES = ["pending", "processing", "processed", "failed"] as const;
export const EventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof EventStatusSchema>;

/** Operator view of an event in the outbox. Carries no secret fields. */
export const EventSummarySchema = z.object({
  id: z.string(),
  organisationId: z.string(),
  eventType: z.string(),
  status: EventStatusSchema,
  attempts: z.number(),
  maxAttempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type EventSummary = z.infer<typeof EventSummarySchema>;

export const EventListResponseSchema = z.object({ events: z.array(EventSummarySchema) });
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const DeadLetterSummarySchema = z.object({
  id: z.string(),
  eventId: z.string(),
  organisationId: z.string(),
  eventType: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  deadAt: z.string(),
  redrivenAt: z.string().nullable(),
});
export type DeadLetterSummary = z.infer<typeof DeadLetterSummarySchema>;

export const DeadLetterListResponseSchema = z.object({
  deadLetters: z.array(DeadLetterSummarySchema),
});
export type DeadLetterListResponse = z.infer<typeof DeadLetterListResponseSchema>;

export const WORKER_STATUSES = ["alive", "stale", "stopped"] as const;
export const WorkerStatusSchema = z.enum(WORKER_STATUSES);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const WorkerSummarySchema = z.object({
  workerId: z.string(),
  workerKind: z.string(),
  status: WorkerStatusSchema,
  lastHeartbeatAt: z.string(),
  // Derived: seconds since the last heartbeat (server-computed).
  secondsSinceHeartbeat: z.number(),
});
export type WorkerSummary = z.infer<typeof WorkerSummarySchema>;

export const WorkerListResponseSchema = z.object({ workers: z.array(WorkerSummarySchema) });
export type WorkerListResponse = z.infer<typeof WorkerListResponseSchema>;

export const RedriveResponseSchema = z.object({
  redriven: z.boolean(),
  eventId: z.string(),
});
export type RedriveResponse = z.infer<typeof RedriveResponseSchema>;

// ---------------------------------------------------------------------------
// End-user profile self-service + notification preferences + substrate
// (Phase 6, ADR-0068 / ADR-ACT-0260). Tenant + user scoped (RLS). A user reads/
// updates only their OWN profile (user_id is the session subject, never a param).
// Disabled channels suppress dispatch; no secret fields in payloads. Local channels
// only (no paid provider). React renders BFF state only.
// ---------------------------------------------------------------------------

/** `GET /api/me/profile` — the calling user's own profile. */
export const UserProfileSchema = z.object({
  displayName: z.string(),
  locale: z.string(),
  timezone: z.string(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** `PATCH /api/me/profile` — own profile only. */
export const UpdateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    locale: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[a-zA-Z]{2}(-[a-zA-Z0-9]{2,8})?$/, "locale must look like 'en' or 'en-GB'"),
    timezone: z.string().min(1).max(60),
  })
  .strict();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const NOTIFICATION_CHANNELS = ["email", "webhook", "in_app"] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NOTIFICATION_CATEGORIES = ["security", "billing", "product", "system"] as const;
export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationPreferenceSchema = z.object({
  channel: NotificationChannelSchema,
  category: NotificationCategorySchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const NotificationPreferencesResponseSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema),
});
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;

/** `PATCH /api/me/notification-preferences` — own preferences only. */
export const UpdateNotificationPreferencesRequestSchema = z
  .object({
    preferences: z.array(NotificationPreferenceSchema).min(1).max(64),
  })
  .strict();
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const NotificationChannelReadinessSchema = z.object({
  channel: NotificationChannelSchema,
  available: z.boolean(),
  transport: z.string(),
  detail: z.string(),
});
export type NotificationChannelReadiness = z.infer<typeof NotificationChannelReadinessSchema>;

export const NotificationReadinessResponseSchema = z.object({
  channels: z.array(NotificationChannelReadinessSchema),
});
export type NotificationReadinessResponse = z.infer<typeof NotificationReadinessResponseSchema>;

/** `POST /api/admin/tenants/:tenantId/notifications/test` — operator test send. */
export const TestNotificationRequestSchema = z
  .object({
    userId: z.string().min(1).max(200),
    category: NotificationCategorySchema,
  })
  .strict();
export type TestNotificationRequest = z.infer<typeof TestNotificationRequestSchema>;

export const NOTIFICATION_DISPATCH_STATUSES = ["sent", "suppressed", "failed"] as const;
export const NotificationDispatchStatusSchema = z.enum(NOTIFICATION_DISPATCH_STATUSES);
export type NotificationDispatchStatus = z.infer<typeof NotificationDispatchStatusSchema>;

export const NotificationDispatchResultSchema = z.object({
  channel: NotificationChannelSchema,
  status: NotificationDispatchStatusSchema,
});
export type NotificationDispatchResult = z.infer<typeof NotificationDispatchResultSchema>;

export const TestNotificationResponseSchema = z.object({
  dispatched: z.array(NotificationDispatchResultSchema),
});
export type TestNotificationResponse = z.infer<typeof TestNotificationResponseSchema>;

// ---------------------------------------------------------------------------
// Observability — metric signals + alert rules + incidents (Phase 7, ADR-0062 /
// ADR-ACT-0261). Built-in foundation: a signal registry, threshold alert rules
// that evaluate against samples, an incident lifecycle, and an alert→notification
// bridge over the Phase-6 substrate. Tenant-scoped (RLS), operator-managed. No
// secret fields. Prometheus/Tempo/Alertmanager/Grafana-IRM remain Phase-7.5 providers.
// ---------------------------------------------------------------------------

export const METRIC_KINDS = ["gauge", "counter"] as const;
export const MetricKindSchema = z.enum(METRIC_KINDS);
export type MetricKind = z.infer<typeof MetricKindSchema>;

export const MetricSignalSummarySchema = z.object({
  signalKey: z.string(),
  displayName: z.string(),
  unit: z.string(),
  kind: MetricKindSchema,
  description: z.string(),
  latestValue: z.number().nullable(),
});
export type MetricSignalSummary = z.infer<typeof MetricSignalSummarySchema>;

export const MetricSignalListResponseSchema = z.object({
  signals: z.array(MetricSignalSummarySchema),
});
export type MetricSignalListResponse = z.infer<typeof MetricSignalListResponseSchema>;

export const ALERT_COMPARATORS = ["gt", "gte", "lt", "lte"] as const;
export const AlertComparatorSchema = z.enum(ALERT_COMPARATORS);
export type AlertComparator = z.infer<typeof AlertComparatorSchema>;

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export const AlertSeveritySchema = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertRuleSummarySchema = z.object({
  id: z.string(),
  ruleKey: z.string(),
  signalKey: z.string(),
  comparator: AlertComparatorSchema,
  threshold: z.number(),
  severity: AlertSeveritySchema,
  enabled: z.boolean(),
  notifyUserId: z.string().nullable(),
  notifyCategory: NotificationCategorySchema,
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type AlertRuleSummary = z.infer<typeof AlertRuleSummarySchema>;

export const AlertListResponseSchema = z.object({ rules: z.array(AlertRuleSummarySchema) });
export type AlertListResponse = z.infer<typeof AlertListResponseSchema>;

/** `POST /api/admin/alerts` — operator-only, audited. */
export const CreateAlertRuleRequestSchema = z
  .object({
    organisationId: z.uuid(),
    ruleKey: z.string().min(1).max(100),
    signalKey: z.string().min(1).max(100),
    comparator: AlertComparatorSchema,
    threshold: z.number(),
    severity: AlertSeveritySchema.optional(),
    enabled: z.boolean().optional(),
    notifyUserId: z.string().max(200).optional(),
    notifyCategory: NotificationCategorySchema.optional(),
  })
  .strict();
export type CreateAlertRuleRequest = z.infer<typeof CreateAlertRuleRequestSchema>;

export const ALERT_EVAL_STATES = ["within", "fired", "no_data", "disabled"] as const;
export const AlertEvalStateSchema = z.enum(ALERT_EVAL_STATES);
export type AlertEvalState = z.infer<typeof AlertEvalStateSchema>;

export const EvaluateAlertResponseSchema = z.object({
  ruleKey: z.string(),
  state: AlertEvalStateSchema,
  value: z.number().nullable(),
  threshold: z.number(),
  incidentId: z.string().nullable(),
  notified: z.array(NotificationDispatchResultSchema),
});
export type EvaluateAlertResponse = z.infer<typeof EvaluateAlertResponseSchema>;

export const INCIDENT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSummarySchema = z.object({
  id: z.string(),
  ruleKey: z.string(),
  title: z.string(),
  severity: AlertSeveritySchema,
  status: IncidentStatusSchema,
  observedValue: z.number().nullable(),
  threshold: z.number().nullable(),
  openedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

export const IncidentListResponseSchema = z.object({ incidents: z.array(IncidentSummarySchema) });
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;

/** `PATCH /api/admin/incidents/:incidentId` — operator lifecycle transition. */
export const UpdateIncidentRequestSchema = z.object({ status: IncidentStatusSchema }).strict();
export type UpdateIncidentRequest = z.infer<typeof UpdateIncidentRequestSchema>;

export const OBSERVABILITY_READINESS_STATES = ["ready", "degraded", "blocked"] as const;
export const ObservabilityReadinessStateSchema = z.enum(OBSERVABILITY_READINESS_STATES);
export type ObservabilityReadinessState = z.infer<typeof ObservabilityReadinessStateSchema>;

export const ObservabilityReadinessResponseSchema = z.object({
  backend: z.string(),
  status: ObservabilityReadinessStateSchema,
  signalCount: z.number(),
  openIncidentCount: z.number(),
  detail: z.string(),
});
export type ObservabilityReadinessResponse = z.infer<typeof ObservabilityReadinessResponseSchema>;

// ---------------------------------------------------------------------------
// Scheduled jobs (Phase 5.5, ADR-0059 / ADR-ACT-0262). Built-in scheduler that
// enqueues events onto the Phase-5 outbox; idempotent per due window. Operator-
// managed, tenant-scoped (RLS). No secret payload fields. Windmill/Temporal remain
// a later workflow-engine decision (not delivered).
// ---------------------------------------------------------------------------

export const ScheduledJobSummarySchema = z.object({
  id: z.string(),
  jobKey: z.string(),
  eventType: z.string(),
  intervalSeconds: z.number(),
  enabled: z.boolean(),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type ScheduledJobSummary = z.infer<typeof ScheduledJobSummarySchema>;

export const ScheduledJobListResponseSchema = z.object({
  jobs: z.array(ScheduledJobSummarySchema),
});
export type ScheduledJobListResponse = z.infer<typeof ScheduledJobListResponseSchema>;

/** `POST /api/admin/scheduled-jobs` — operator-only, audited. */
export const CreateScheduledJobRequestSchema = z
  .object({
    organisationId: z.uuid(),
    jobKey: z.string().min(1).max(100),
    eventType: z.string().min(1).max(100),
    intervalSeconds: z.number().int().positive().max(2592000),
    enabled: z.boolean().optional(),
  })
  .strict();
export type CreateScheduledJobRequest = z.infer<typeof CreateScheduledJobRequestSchema>;

/** `PATCH /api/admin/scheduled-jobs/:jobId` — pause/resume. */
export const UpdateScheduledJobRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type UpdateScheduledJobRequest = z.infer<typeof UpdateScheduledJobRequestSchema>;

export const RunScheduledJobResponseSchema = z.object({
  jobKey: z.string(),
  enqueued: z.boolean(),
  deduplicated: z.boolean(),
});
export type RunScheduledJobResponse = z.infer<typeof RunScheduledJobResponseSchema>;

// ---------------------------------------------------------------------------
// Runtime secrets — central secret store (ADR-0069 / ADR-ACT-0265). Tier-1 kernel.
// Operator-only. Strict + no-passthrough. The read/list surface carries ONLY value-
// free metadata: the opaque `secret:<uuid>` ref, the logical name, the backend
// provider, version + lifecycle timestamps. The plaintext value is write-only (it
// appears only in the PUT request, never in any response) and is resolved exclusively
// server-internally. Readiness is honest — OpenBao unreachable ⇒ degraded.
// ---------------------------------------------------------------------------

export const SECRET_PROVIDERS = ["builtin", "openbao"] as const;
export const SecretProviderSchema = z.enum(SECRET_PROVIDERS);
export type SecretProviderValue = z.infer<typeof SecretProviderSchema>;

/** `GET /api/admin/secrets` row — value-free metadata only. */
export const SecretRefSummarySchema = z
  .object({
    ref: z.string(),
    name: z.string(),
    provider: SecretProviderSchema,
    version: z.number().int().positive(),
    revoked: z.boolean(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .strict();
export type SecretRefSummary = z.infer<typeof SecretRefSummarySchema>;

export const SecretRefListResponseSchema = z
  .object({ secrets: z.array(SecretRefSummarySchema) })
  .strict();
export type SecretRefListResponse = z.infer<typeof SecretRefListResponseSchema>;

/** `POST /api/admin/secrets` — create/rotate. `value` is write-only (never returned).
 * Body never carries a tenant id (operator passes organisationId explicitly). */
export const PutSecretRequestSchema = z
  .object({
    organisationId: z.uuid(),
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(
        /^[a-z0-9][a-z0-9/_.-]*$/i,
        "name: letters, digits, / _ . - (must start alphanumeric)"
      ),
    value: z.string().min(1).max(8192),
  })
  .strict();
export type PutSecretRequest = z.infer<typeof PutSecretRequestSchema>;

/** `POST /api/admin/secrets/revoke` and `/delete` — opaque ref + tenant. */
export const SecretRefActionRequestSchema = z
  .object({ organisationId: z.uuid(), ref: z.string().min(1).max(128) })
  .strict();
export type SecretRefActionRequest = z.infer<typeof SecretRefActionRequestSchema>;

export const SECRET_STORE_READINESS_STATUSES = ["ready", "degraded"] as const;
export const SecretStoreReadinessStatusSchema = z.enum(SECRET_STORE_READINESS_STATUSES);
export type SecretStoreReadinessStatus = z.infer<typeof SecretStoreReadinessStatusSchema>;

/** `GET /api/admin/secrets/readiness` — never carries a secret value. */
export const SecretStoreReadinessResponseSchema = z
  .object({
    provider: SecretProviderSchema,
    status: SecretStoreReadinessStatusSchema,
    detail: z.string(),
  })
  .strict();
export type SecretStoreReadinessResponse = z.infer<typeof SecretStoreReadinessResponseSchema>;

// ---------------------------------------------------------------------------
// Provider configuration plane (ADR-0070 / ADR-ACT-0266). Tier-1 kernel. Operator-only.
// Binds a USF capability to a concrete provider instance per environment, with its
// environment classification, lifecycle state, non-secret endpoint/config, and
// credentials BY REFERENCE (an opaque secret:<uuid> into the ADR-0069 secret store).
// Strict + no-passthrough. The plaintext credential is never carried here; `config`
// rejects secret-bearing keys server-side. Lifecycle `ready` is adapter-confirmed.
// ---------------------------------------------------------------------------

export const PROVIDER_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export const ProviderEnvironmentSchema = z.enum(PROVIDER_ENVIRONMENTS);
export type ProviderEnvironment = z.infer<typeof ProviderEnvironmentSchema>;

export const PROVIDER_LIFECYCLE_STATES = [
  "candidate",
  "configured",
  "degraded",
  "ready",
  "disabled",
] as const;
export const ProviderLifecycleStateSchema = z.enum(PROVIDER_LIFECYCLE_STATES);
export type ProviderLifecycleStateValue = z.infer<typeof ProviderLifecycleStateSchema>;

/** Environment-service classification vocabulary (ADR-0056). */
export const PROVIDER_CLASSIFICATIONS = [
  "per-environment",
  "shared-cross-environment",
  "local-only",
  "test-only",
  "mock-only",
  "production-external",
  "production-internal",
  "forbidden-in-production",
  "not-applicable",
] as const;
export const ProviderClassificationSchema = z.enum(PROVIDER_CLASSIFICATIONS);
export type ProviderClassification = z.infer<typeof ProviderClassificationSchema>;

/** `GET /api/admin/provider-configs` row — never carries a plaintext credential. */
export const ProviderConfigSummarySchema = z
  .object({
    id: z.string(),
    providerKey: z.string(),
    capability: z.string(),
    environment: ProviderEnvironmentSchema,
    instanceLabel: z.string(),
    classification: ProviderClassificationSchema,
    lifecycleState: ProviderLifecycleStateSchema,
    endpoint: z.string().nullable(),
    /** Opaque secret-store ref (secret:<uuid>) or null — never a plaintext secret. */
    credentialRef: z.string().nullable(),
    hasCredential: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
  })
  .strict();
export type ProviderConfigSummary = z.infer<typeof ProviderConfigSummarySchema>;

export const ProviderConfigListResponseSchema = z
  .object({ providers: z.array(ProviderConfigSummarySchema) })
  .strict();
export type ProviderConfigListResponse = z.infer<typeof ProviderConfigListResponseSchema>;

const ProviderKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "providerKey: lowercase letters, digits, - or _");

/** `POST /api/admin/provider-configs` — operator-only. `credentialRef` is a secret-store
 * ref; `config` must not contain secret-bearing keys (enforced server-side). */
export const PutProviderConfigRequestSchema = z
  .object({
    providerKey: ProviderKeySchema,
    capability: z.string().min(1).max(64),
    environment: ProviderEnvironmentSchema,
    instanceLabel: z.string().min(1).max(64).optional(),
    classification: ProviderClassificationSchema,
    lifecycleState: ProviderLifecycleStateSchema,
    endpoint: z.string().max(2048).nullable().optional(),
    credentialRef: z
      .string()
      .max(128)
      .regex(/^secret:/, "credentialRef must be an opaque secret-store ref (secret:<uuid>)")
      .nullable()
      .optional(),
    /** Whether this provider requires a credential — drives the degraded derivation. */
    requiresCredential: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PutProviderConfigRequest = z.infer<typeof PutProviderConfigRequestSchema>;

/** `POST /api/admin/provider-configs/:id/lifecycle` — operator transition. */
export const SetProviderLifecycleRequestSchema = z
  .object({ lifecycleState: ProviderLifecycleStateSchema })
  .strict();
export type SetProviderLifecycleRequest = z.infer<typeof SetProviderLifecycleRequestSchema>;

// ---------------------------------------------------------------------------
// Composed provider readiness (ADR-0071 / ADR-ACT-0271). Operator-only. A live
// readiness probe per composed provider (Meilisearch/Prometheus/Tempo/Alertmanager/
// Windmill/Temporal) feeding the provider-config adapter-confirmed lifecycle. Never
// carries a secret (master key/token); `not_configured` when no endpoint is wired.
// ---------------------------------------------------------------------------

export const COMPOSED_PROVIDER_READINESS_STATUSES = [
  "ready",
  "degraded",
  "not_configured",
] as const;
export const ComposedProviderReadinessStatusSchema = z.enum(COMPOSED_PROVIDER_READINESS_STATUSES);
export type ComposedProviderReadinessStatus = z.infer<typeof ComposedProviderReadinessStatusSchema>;

export const ComposedProviderReadinessRowSchema = z
  .object({
    provider: z.string(),
    capability: z.string(),
    status: ComposedProviderReadinessStatusSchema,
    lifecycleState: ProviderLifecycleStateSchema,
    detail: z.string(),
  })
  .strict();
export type ComposedProviderReadinessRow = z.infer<typeof ComposedProviderReadinessRowSchema>;

/** `GET /api/admin/providers/readiness` — never carries a secret. */
export const ComposedProviderReadinessResponseSchema = z
  .object({ providers: z.array(ComposedProviderReadinessRowSchema) })
  .strict();
export type ComposedProviderReadinessResponse = z.infer<
  typeof ComposedProviderReadinessResponseSchema
>;

// ---------------------------------------------------------------------------
// Click-through services (ADR-ACT-0233 / ADR-0072). The operator's view of the
// composed Compose GUI services: each service's click-through URL, access gating,
// isolation invariant, and adapter-confirmed readiness. Credentials are validated
// server-side via the composed-provider readiness probe (OpenBao-backed); no secret
// is ever returned. `GET /api/admin/clickthrough`.
// ---------------------------------------------------------------------------

export const CLICKTHROUGH_CLASSIFICATIONS = [
  "global_only",
  "tenant_scoped_safe",
  "not_exposed",
] as const;
export const ClickthroughClassificationSchema = z.enum(CLICKTHROUGH_CLASSIFICATIONS);
export type ClickthroughClassification = z.infer<typeof ClickthroughClassificationSchema>;

export const CLICKTHROUGH_READINESS_STATUSES = [
  "ready",
  "degraded",
  "not_configured",
  "unknown",
] as const;
export const ClickthroughReadinessSchema = z.enum(CLICKTHROUGH_READINESS_STATUSES);
export type ClickthroughReadiness = z.infer<typeof ClickthroughReadinessSchema>;

export const ClickthroughServiceRowSchema = z
  .object({
    id: z.string(),
    resource: z.string(),
    classification: ClickthroughClassificationSchema,
    /** Apex click-through URL path (e.g. /kc), or null when not path-proxied. */
    url: z.string().nullable(),
    /** Whether the current actor may click through to this service on the apex host. */
    accessible: z.boolean(),
    /** Adapter-confirmed readiness (credential-validated where a probe exists). */
    readiness: ClickthroughReadinessSchema,
    isolationInvariant: z.string(),
  })
  .strict();
export type ClickthroughServiceRow = z.infer<typeof ClickthroughServiceRowSchema>;

/** `GET /api/admin/clickthrough` — never carries a secret. */
export const ClickthroughServicesResponseSchema = z
  .object({
    services: z.array(ClickthroughServiceRowSchema),
    /** Composed-provider readiness (OpenBao-credential-validated, adapter-confirmed). */
    providers: z.array(ComposedProviderReadinessRowSchema),
  })
  .strict();
export type ClickthroughServicesResponse = z.infer<typeof ClickthroughServicesResponseSchema>;

// ---------------------------------------------------------------------------
// History read-model (ADR-0063 / ADR-ACT-0272). A read-only UNION projection over the
// existing audited/event/notification/incident/meter sources — no new store, no
// duplicated data. Tenant-scoped; operators may query a selected tenant; pagination
// required; secret-bearing columns (metadata/payload) are never projected.
// ---------------------------------------------------------------------------

export const HISTORY_SOURCE_TYPES = [
  "audit",
  "event",
  "notification",
  "incident",
  "meter",
] as const;
export const HistorySourceTypeSchema = z.enum(HISTORY_SOURCE_TYPES);
export type HistorySourceType = z.infer<typeof HistorySourceTypeSchema>;

export const HistoryEntrySchema = z
  .object({
    id: z.string(),
    source: HistorySourceTypeSchema,
    type: z.string(),
    title: z.string(),
    occurredAt: z.string().nullable(),
    actorId: z.string().nullable(),
  })
  .strict();
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/** `GET /api/org/history` and `GET /api/admin/tenants/:tenantId/history`. */
export const HistoryPageResponseSchema = z
  .object({
    entries: z.array(HistoryEntrySchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export type HistoryPageResponse = z.infer<typeof HistoryPageResponseSchema>;
