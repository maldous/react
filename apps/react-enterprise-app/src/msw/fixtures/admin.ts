import type {
  MemberListResponse,
  FeatureListResponse,
  TenantAuthProvidersResponse,
  IdpSummary,
  MfaPolicyDto,
  SessionPolicyDto,
} from "@platform/contracts-admin";

// Canonical admin control-plane fixtures for frontend tests (ADR-0036). Pure data;
// MSW handlers in ../handlers.ts serve them and tests assert against them.

export const membersFixture: MemberListResponse = {
  members: [
    {
      userId: "00000000-0000-0000-0000-0000000000a1",
      email: "admin@example.com",
      displayName: "Tenant Admin",
      role: "tenant-admin",
      joinedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      userId: "00000000-0000-0000-0000-0000000000b2",
      email: "member@example.com",
      displayName: "Regular Member",
      role: "member",
      joinedAt: "2026-02-01T00:00:00.000Z",
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

export const mfaFixture: MfaPolicyDto = { required: "optional", type: "totp" };

export const sessionPolicyFixture: SessionPolicyDto = {
  accessTokenLifespanSeconds: 300,
  ssoSessionIdleTimeoutSeconds: 1800,
  ssoSessionMaxLifespanSeconds: 36000,
  rememberMe: true,
};
