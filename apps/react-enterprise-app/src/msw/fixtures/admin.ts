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
  { alias: "mock-google", displayName: "Mock Google", providerId: "oidc", enabled: true },
  { alias: "mock-azure", displayName: "Mock Microsoft", providerId: "oidc", enabled: false },
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
