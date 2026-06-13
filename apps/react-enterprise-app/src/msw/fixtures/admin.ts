import type {
  MemberListResponse,
  FeatureListResponse,
  TenantAuthProvidersResponse,
  IdpSummary,
  MfaPolicyDto,
  SessionPolicyDto,
  AuthSettingsReadiness,
  ExternalIdentityListResponse,
  ConfigListResponse,
  AuditListResponse,
  TenantReadinessResponse,
  EntitlementListResponse,
  CapabilitySummary,
  CapabilityCategory,
  CapabilityImplementationStatus,
  CapabilityReadiness,
} from "@platform/contracts-admin";

// Canonical admin control-plane fixtures for frontend tests (ADR-0036). Pure data;
// MSW handlers in ../handlers.ts serve them and tests assert against them.

export const membersFixture: MemberListResponse = {
  members: [
    {
      userId: "00000000-0000-0000-0000-0000000000a1",
      email: "admin@example.com",
      displayName: "Tenant Admin",
      username: "admin",
      role: "tenant-admin",
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      lastLoginAt: "2026-06-01T09:00:00.000Z",
    },
    {
      userId: "00000000-0000-0000-0000-0000000000b2",
      email: "member@example.com",
      displayName: "Regular Member",
      username: null,
      role: "member",
      status: "disabled",
      joinedAt: "2026-02-01T00:00:00.000Z",
      lastLoginAt: null,
    },
  ],
  pendingInvitations: [
    {
      email: "invited@example.com",
      role: "viewer",
      invitedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-03-08T00:00:00.000Z",
    },
  ],
};

export const featuresFixture: FeatureListResponse = {
  features: [
    { key: "analytics", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z" },
    { key: "advanced_auth", enabled: false, updatedAt: null },
    { key: "audit_export", enabled: false, updatedAt: null },
    { key: "webhooks", enabled: true, updatedAt: "2026-02-01T00:00:00.000Z" },
  ],
};

export const authProvidersFixture: TenantAuthProvidersResponse = {
  config: { mode: "default", enabledProviders: ["google", "azure", "apple"] },
  environmentDefaultMode: "mock",
  availableProviders: ["google", "azure", "apple"],
};

export const idpsFixture: IdpSummary[] = [
  {
    alias: "mock-google",
    displayName: "Mock Google",
    providerId: "google",
    enabled: true,
    hasClientSecret: true,
    trustEmail: true,
    clientId: "mock-google-client",
    scopes: "openid email profile",
  },
  {
    alias: "mock-azure",
    displayName: "Mock Microsoft",
    providerId: "oidc",
    enabled: false,
    hasClientSecret: false,
    trustEmail: false,
    clientId: null,
    scopes: null,
  },
];

export const externalIdentitiesFixture: ExternalIdentityListResponse = {
  identities: [
    {
      id: "ei-1",
      provider: "mock-google",
      subject: "google-sub-1",
      email: "admin@example.com",
      linkedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-06-01T09:00:00.000Z",
    },
  ],
};

export const configFixture: ConfigListResponse = {
  items: [
    {
      definition: {
        key: "features.analytics",
        category: "features",
        labelKey: "feature.admin.features.key.analytics",
        descriptionKey: "feature.admin.features.keyDescription.analytics",
        valueType: "boolean",
        defaultValue: false,
        allowedValues: null,
        tenantOverridable: true,
        requiredPermissionRead: "tenant.features.read",
        requiredPermissionWrite: "tenant.features.update",
        lifecycle: "active",
      },
      value: true,
      source: "tenant_override",
    },
    {
      definition: {
        key: "branding.app_name",
        category: "branding",
        labelKey: "feature.admin.config.def.branding.appName.label",
        descriptionKey: "feature.admin.config.def.branding.appName.description",
        valueType: "string",
        defaultValue: "Enterprise Platform",
        allowedValues: null,
        tenantOverridable: true,
        requiredPermissionRead: "tenant.config.read",
        requiredPermissionWrite: "tenant.config.write",
        lifecycle: "active",
      },
      value: "Enterprise Platform",
      source: "default",
    },
    {
      definition: {
        key: "branding.theme",
        category: "branding",
        labelKey: "feature.admin.config.def.branding.theme.label",
        descriptionKey: "feature.admin.config.def.branding.theme.description",
        valueType: "enum",
        defaultValue: "system",
        allowedValues: ["system", "light", "dark"],
        tenantOverridable: true,
        requiredPermissionRead: "tenant.config.read",
        requiredPermissionWrite: "tenant.config.write",
        lifecycle: "active",
      },
      value: "system",
      source: "default",
    },
  ],
};

export const auditFixture: AuditListResponse = {
  events: [
    {
      id: "ae-1",
      action: "member.status_changed",
      actorId: "00000000-0000-0000-0000-0000000000a1",
      resource: "organisation:members",
      resourceId: "00000000-0000-0000-0000-0000000000b2",
      timestamp: "2026-06-01T10:00:00.000Z",
      metadata: { status: "disabled" },
    },
    {
      id: "ae-2",
      action: "config.value_changed",
      actorId: "00000000-0000-0000-0000-0000000000a1",
      resource: "organisation:config",
      resourceId: "branding.app_name",
      timestamp: "2026-06-01T11:00:00.000Z",
      metadata: { key: "branding.app_name", value: "Acme" },
    },
  ],
};

export const mfaFixture: MfaPolicyDto = { required: "optional", type: "totp" };

export const sessionPolicyFixture: SessionPolicyDto = {
  accessTokenLifespanSeconds: 300,
  ssoSessionIdleTimeoutSeconds: 1800,
  ssoSessionMaxLifespanSeconds: 36000,
  rememberMe: true,
};

export const authReadinessFixture: AuthSettingsReadiness = { status: "configured" };

// --- tenant readiness / capability map (ADR-0045) ---------------------------
function makeCap(
  key: string,
  category: CapabilityCategory,
  readiness: CapabilityReadiness,
  opts: {
    adminRoute?: string | null;
    implementationStatus?: CapabilityImplementationStatus;
    required?: boolean;
    detailKey?: string | null;
  } = {}
): CapabilitySummary {
  return {
    key,
    category,
    labelKey: `feature.admin.readiness.cap.${key}.label`,
    descriptionKey: `feature.admin.readiness.cap.${key}.description`,
    adminRoute: opts.adminRoute ?? null,
    implementationStatus: opts.implementationStatus ?? "implemented",
    readiness,
    required: opts.required ?? false,
    detailKey: opts.detailKey ?? null,
  };
}

/** A representative, healthy capability map spanning every category + status. */
export const tenantReadinessFixture: TenantReadinessResponse = {
  overall: "ready",
  capabilities: [
    makeCap("tenant_admin", "identity", "ready", {
      adminRoute: "/admin/members",
      required: true,
      detailKey: "feature.admin.readiness.cap.tenant_admin.action",
    }),
    makeCap("auth_credential", "authentication", "ready", { required: true }),
    makeCap("auth_providers", "authentication", "ready", {
      adminRoute: "/admin/auth",
      required: true,
    }),
    makeCap("idp_configuration", "authentication", "ready", {
      adminRoute: "/admin/auth",
      detailKey: "feature.admin.readiness.cap.idp_configuration.action",
    }),
    makeCap("oidc_discovery", "authentication", "deferred", {
      implementationStatus: "deferred",
    }),
    makeCap("feature_config", "configuration", "ready", { adminRoute: "/admin/config" }),
    makeCap("branding", "configuration", "ready", {
      adminRoute: "/admin/config",
      implementationStatus: "partial",
    }),
    makeCap("audit", "operations", "ready", { adminRoute: "/admin/logs" }),
    makeCap("storage", "operations", "deferred", { implementationStatus: "deferred" }),
    makeCap("integrations_webhooks", "integrations", "deferred", {
      implementationStatus: "deferred",
    }),
  ],
};

/** A blocked tenant (missing credential + no admin) for negative-path tests. */
export const tenantReadinessBlockedFixture: TenantReadinessResponse = {
  overall: "blocked",
  capabilities: [
    makeCap("tenant_admin", "identity", "blocked", {
      adminRoute: "/admin/members",
      required: true,
      detailKey: "feature.admin.readiness.cap.tenant_admin.action",
    }),
    makeCap("auth_credential", "authentication", "blocked", {
      required: true,
      detailKey: "feature.admin.readiness.cap.auth_credential.action",
    }),
    makeCap("idp_configuration", "authentication", "incomplete", {
      adminRoute: "/admin/auth",
      detailKey: "feature.admin.readiness.cap.idp_configuration.action",
    }),
  ],
};

export const entitlementsFixture: EntitlementListResponse = {
  entitlements: [
    {
      key: "webhooks",
      displayName: "Outbound webhooks",
      description: "Tenant may register and receive signed outbound webhooks.",
      category: "developer-platform",
      state: "granted",
      source: "system",
      requiresProvider: false,
      providerKey: null,
      quota: { status: "not_enforced" },
      note: null,
      updatedAt: "2026-06-13T00:00:00.000Z",
      updatedBy: "00000000-0000-0000-0000-0000000000a3",
    },
    {
      key: "storage",
      displayName: "Object storage",
      description: "Tenant-isolated object storage with signed access.",
      category: "storage",
      state: "not_granted",
      source: null,
      requiresProvider: true,
      providerKey: "minio",
      quota: { status: "not_enforced" },
      note: null,
      updatedAt: null,
      updatedBy: null,
    },
  ],
};
