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
  TenantLookupResponse,
  UsageResponse,
  QuotaListResponse,
  ApiKeyListResponse,
  RateLimitListResponse,
  DeveloperPortalResponse,
  CreateApiKeyResponse,
  SearchResponse,
  SearchReadinessResponse,
  EventListResponse,
  DeadLetterListResponse,
  WorkerListResponse,
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

export const tenantsLookupFixture: TenantLookupResponse = {
  tenants: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      slug: "fixture-org",
      displayName: "Fixture Organisation",
    },
    { id: "00000000-0000-0000-0000-000000000002", slug: "acme", displayName: "Acme Inc" },
  ],
  truncated: false,
};

export const usageFixture: UsageResponse = {
  usage: [
    {
      meterKey: "webhooks.deliveries",
      displayName: "Webhook deliveries",
      window: "lifetime",
      usage: 2,
    },
    { meterKey: "storage.bytes", displayName: "Storage used", window: "lifetime", usage: 0 },
  ],
};

export const quotasFixture: QuotaListResponse = {
  quotas: [
    {
      quotaKey: "webhooks.deliveries",
      entitlementKey: "webhooks",
      meterKey: "webhooks.deliveries",
      limit: 3,
      window: "lifetime",
      action: "deny",
      usage: 2,
      allowed: true,
      state: "within",
      updatedAt: "2026-06-13T00:00:00.000Z",
      updatedBy: "00000000-0000-0000-0000-0000000000a3",
    },
  ],
};

export const apiKeysFixture: ApiKeyListResponse = {
  apiKeys: [
    {
      id: "00000000-0000-0000-0000-0000000000k1",
      name: "CI deploy token",
      keyPrefix: "pk_ci0deploy",
      scopes: ["read"],
      state: "active",
      createdAt: "2026-06-13T00:00:00.000Z",
      createdBy: "00000000-0000-0000-0000-0000000000a1",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    },
  ],
};

export const createApiKeyFixture: CreateApiKeyResponse = {
  apiKey: {
    id: "00000000-0000-0000-0000-0000000000k2",
    name: "New token",
    keyPrefix: "pk_new0token",
    scopes: ["read"],
    state: "active",
    createdAt: "2026-06-13T00:00:00.000Z",
    createdBy: "00000000-0000-0000-0000-0000000000a1",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  },
  // Mock-only display secret — never a real credential.
  secret: "sk_mock0secret0shown0once0000000000",
  secretShownOnce: true,
};

export const rateLimitsFixture: RateLimitListResponse = {
  policies: [
    {
      policyKey: "api.requests",
      entitlementKey: "api_access",
      limit: 1000,
      windowSeconds: 3600,
      action: "deny",
      used: 12,
      state: "within",
      updatedAt: "2026-06-13T00:00:00.000Z",
      updatedBy: "00000000-0000-0000-0000-0000000000a3",
    },
  ],
};

export const developerPortalFixture: DeveloperPortalResponse = {
  apiAccessEntitled: true,
  activeKeyCount: 1,
  graphqlEndpoint: "/api/graphql",
  restBaselinePath: "/api",
  openapiPath: "/api/openapi.json",
  scopes: ["read", "write", "admin"],
  rateLimitPolicyCount: 1,
};

export const searchResponseFixture: SearchResponse = {
  hits: [
    {
      documentId: "p1",
      documentType: "product",
      title: "Blue widget",
      url: "/products/p1",
      score: 0.42,
    },
  ],
  total: 1,
  tookMs: 3,
};

export const searchReadinessFixture: SearchReadinessResponse = {
  engine: "postgres-fts",
  status: "ready",
  documentCount: 1,
  detail: "Postgres full-text search is reachable and has indexed documents.",
};

export const eventsFixture: EventListResponse = {
  events: [
    {
      id: "00000000-0000-0000-0000-0000000000e1",
      organisationId: "00000000-0000-0000-0000-000000000001",
      eventType: "thing.created",
      status: "processed",
      attempts: 1,
      maxAttempts: 5,
      lastError: null,
      createdAt: "2026-06-13T00:00:00.000Z",
      processedAt: "2026-06-13T00:00:01.000Z",
    },
  ],
};

export const deadLettersFixture: DeadLetterListResponse = {
  deadLetters: [
    {
      id: "00000000-0000-0000-0000-0000000000d1",
      eventId: "00000000-0000-0000-0000-0000000000e2",
      organisationId: "00000000-0000-0000-0000-000000000001",
      eventType: "boom.event",
      attempts: 5,
      lastError: "handler failed",
      deadAt: "2026-06-13T00:00:00.000Z",
      redrivenAt: null,
    },
  ],
};

export const workersFixture: WorkerListResponse = {
  workers: [
    {
      workerId: "event-worker-1",
      workerKind: "event-worker",
      status: "alive",
      lastHeartbeatAt: "2026-06-13T00:00:00.000Z",
      secondsSinceHeartbeat: 4,
    },
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
