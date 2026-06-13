import { http, HttpResponse } from "msw";
import { sessionFixtures, type SessionPersona } from "./fixtures/session.ts";
import { defaultThemeFixture, type ThemeFixture } from "./fixtures/theme.ts";
import { providersFixture } from "./fixtures/providers.ts";
import type { LoginProvider } from "../auth/login-providers.ts";
import { createGraphqlHandler } from "./graphql/handlers.ts";
import {
  membersFixture,
  featuresFixture,
  authProvidersFixture,
  idpsFixture,
  mfaFixture,
  sessionPolicyFixture,
  authReadinessFixture,
  externalIdentitiesFixture,
  configFixture,
  auditFixture,
  tenantReadinessFixture,
  entitlementsFixture,
  tenantsLookupFixture,
  usageFixture,
  quotasFixture,
  apiKeysFixture,
  createApiKeyFixture,
  rateLimitsFixture,
  developerPortalFixture,
  searchResponseFixture,
  searchReadinessFixture,
} from "./fixtures/admin.ts";
import type { AuthSettingsReadiness } from "@platform/contracts-admin";

// Complete MSW baseline for the SPA (ADR-0019). Every endpoint the app touches
// has a default handler so no feature test hand-rolls low-level fetch mocks.
// Tests override per-case with `server.use(...)` using the factories below.

// --- /api/session ----------------------------------------------------------

/** Authenticated as a persona, or 401 when persona is null. */
export function sessionHandler(persona: SessionPersona | null) {
  return http.get("/api/session", () =>
    persona ? HttpResponse.json(sessionFixtures[persona]) : new HttpResponse(null, { status: 401 })
  );
}

/** Non-401 session failure (drives the session-error UI state). */
export function sessionErrorHandler(status = 503) {
  return http.get("/api/session", () => new HttpResponse(null, { status }));
}

// --- /api/theme -------------------------------------------------------------

export function themeHandler(theme: ThemeFixture = defaultThemeFixture) {
  return http.get("/api/theme", () => HttpResponse.json(theme));
}

/** Theme endpoint failure — drives the default-theme fallback path. */
export function themeErrorHandler(status = 500) {
  return http.get("/api/theme", () => new HttpResponse(null, { status }));
}

// --- /api/auth/providers ----------------------------------------------------

/** Login provider list (defaults to the mock-mode platform + 3 upstreams). */
export function providersHandler(providers: LoginProvider[] = providersFixture) {
  return http.get("/api/auth/providers", () => HttpResponse.json(providers));
}

/** Empty provider list — drives the "no sign-in options" UI state. */
export function providersEmptyHandler() {
  return http.get("/api/auth/providers", () => HttpResponse.json([]));
}

/** Provider list failure — drives the error UI state. */
export function providersErrorHandler(status = 503) {
  return http.get("/api/auth/providers", () => new HttpResponse(null, { status }));
}

// --- admin control plane (ADR-0036) -----------------------------------------

/** GET /api/org/members. */
export function adminMembersHandler(response = membersFixture) {
  return http.get("/api/org/members", () => HttpResponse.json(response));
}
/** GET /api/org/features. */
export function adminFeaturesHandler(response = featuresFixture) {
  return http.get("/api/org/features", () => HttpResponse.json(response));
}
/** GET /api/auth/settings/providers. */
export function adminAuthProvidersHandler(response = authProvidersFixture) {
  return http.get("/api/auth/settings/providers", () => HttpResponse.json(response));
}
/** GET /api/auth/settings/idps. */
export function adminIdpsHandler(response = idpsFixture) {
  return http.get("/api/auth/settings/idps", () => HttpResponse.json(response));
}
// --- OIDC enterprise hardening (ADR-0046) ---
/** POST /api/auth/settings/idps/oidc/discover. */
export function adminIdpDiscoverHandler(
  response = {
    metadata: {
      issuer: "https://idp.example.com",
      authorizationEndpoint: "https://idp.example.com/authorize",
      tokenEndpoint: "https://idp.example.com/token",
      userInfoEndpoint: "https://idp.example.com/userinfo",
      jwksUri: "https://idp.example.com/jwks",
    },
    validation: { result: "ok", issuerValid: true, jwksValid: true, jwksKeyCount: 2 },
  }
) {
  return http.post("/api/auth/settings/idps/oidc/discover", () => HttpResponse.json(response));
}
/** GET /api/auth/settings/idps/:alias/callback-url. */
export function adminIdpCallbackUrlHandler(
  callbackUrl = "https://kc.test/realms/tenant-1/broker/mock-google/endpoint"
) {
  return http.get("/api/auth/settings/idps/:alias/callback-url", ({ params }) =>
    HttpResponse.json({ alias: String(params["alias"]), callbackUrl })
  );
}
/** POST /api/auth/settings/idps/:alias/test-connection. */
export function adminIdpTestConnectionHandler(
  response = { result: "ok", issuerValid: true, jwksValid: true, jwksKeyCount: 2 }
) {
  return http.post("/api/auth/settings/idps/:alias/test-connection", () =>
    HttpResponse.json(response)
  );
}
/** GET + PATCH /api/auth/settings/idps/:alias/mapping. */
export function adminIdpMappingHandler(response = { claimMappings: [], roleMappings: [] }) {
  return http.get("/api/auth/settings/idps/:alias/mapping", () => HttpResponse.json(response));
}
export function adminIdpMappingUpdateHandler() {
  return http.patch("/api/auth/settings/idps/:alias/mapping", async ({ request }) =>
    HttpResponse.json(await request.json())
  );
}

// --- Tenant custom domains (ADR-0048 / ADR-ACT-0232 full lifecycle) ---
const domainsListFixture = {
  domains: [
    {
      domain: "app.example.com",
      source: "custom",
      status: "pending_dns",
      authClient: "inactive",
      tls: "tls_unknown",
      routing: "routing_unknown",
      canonical: false,
      redirectPolicy: "no_redirect",
      redirectActive: false,
      txtRecord: "_platform-verify.app.example.com",
      createdAt: "2026-06-12T00:00:00Z",
      verifiedAt: null,
      expiresAt: null,
      authClientActivatedAt: null,
      routingLocalProvenAt: null,
      routingPublicProvenAt: null,
      tlsLocalProvenAt: null,
      tlsPublicProvenAt: null,
      canonicalAt: null,
    },
  ],
};
const domainsReadinessFixture = {
  status: "pending_verification",
  total: 1,
  verified: 0,
  pending: 1,
};
export function adminDomainsListHandler(response: Record<string, unknown> = domainsListFixture) {
  return http.get("/api/org/domains", () => HttpResponse.json(response));
}
export function adminDomainsReadinessHandler(
  response: Record<string, unknown> = domainsReadinessFixture
) {
  return http.get("/api/org/domains/readiness", () => HttpResponse.json(response));
}
export function adminDomainsCreateHandler() {
  return http.post("/api/org/domains", async ({ request }) => {
    const body = (await request.json()) as { domain: string };
    return HttpResponse.json(
      {
        domain: body.domain,
        status: "pending_dns",
        txtRecord: `_platform-verify.${body.domain}`,
        token: "verify-token-abc123",
      },
      { status: 201 }
    );
  });
}
export function adminDomainsVerifyHandler() {
  return http.post("/api/org/domains/:domain/verify", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      status: "verified",
      txtRecord: `_platform-verify.${decodeURIComponent(String(params["domain"]))}`,
      token: null,
    })
  );
}
export function adminDomainsRemoveHandler() {
  return http.delete("/api/org/domains/:domain", () => new HttpResponse(null, { status: 204 }));
}
export function adminDomainsActivateHandler() {
  return http.post("/api/org/domains/:domain/activate", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      authClient: "active",
      authClientActivatedAt: "2026-06-12T00:00:00Z",
    })
  );
}
export function adminDomainsDeactivateHandler() {
  return http.post("/api/org/domains/:domain/deactivate", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      authClient: "inactive",
      authClientActivatedAt: null,
    })
  );
}
export function adminDomainsProbeRoutingHandler(matched = true) {
  return http.post("/api/org/domains/:domain/probe-routing-local", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      reachable: matched,
      tenantContextMatched: matched,
      routing: matched ? "routing_local_active" : "routing_unknown",
      routingLocalProvenAt: matched ? "2026-06-12T00:00:00Z" : null,
    })
  );
}
export function adminDomainsSetCanonicalHandler() {
  return http.post("/api/org/domains/:domain/canonical", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      canonical: true,
      canonicalAt: "2026-06-12T00:00:00Z",
      redirectPolicy: "no_redirect",
      redirectActive: false,
    })
  );
}
export function adminDomainsUnsetCanonicalHandler() {
  return http.delete("/api/org/domains/:domain/canonical", ({ params }) =>
    HttpResponse.json({
      domain: decodeURIComponent(String(params["domain"])),
      canonical: false,
      canonicalAt: null,
      redirectPolicy: "no_redirect",
      redirectActive: false,
    })
  );
}
/** POST /api/org/domains responding 409 DOMAIN_ALREADY_CLAIMED (ADR-ACT-0236). */
export function adminDomainsCreateConflictHandler() {
  return http.post("/api/org/domains", () =>
    HttpResponse.json(
      {
        code: "DOMAIN_ALREADY_CLAIMED",
        message: "This domain is already claimed by another organisation",
      },
      { status: 409 }
    )
  );
}

// --- Tenant email sender (ADR-0047) ---
const emailSenderFixture = {
  provider: "local",
  fromName: "Acme",
  fromEmail: "noreply@acme.test",
  replyToEmail: "",
  enabled: true,
  smtpHost: "",
  smtpPort: 0,
  smtpSecure: false,
  smtpUsername: "",
  hasCredential: false,
  updatedAt: "2026-06-12T00:00:00Z",
  readiness: "configured",
};
// --- Tenant object storage readiness (ADR-0049) ---
const storageReadinessFixture = {
  status: "configured",
  prefix: "00000000-0000-0000-0000-000000000001/",
  endpointConfigured: true,
  isolationEnforced: true,
};
const storageProbeFixture = {
  status: "configured",
  wrote: true,
  read: true,
  deleted: true,
  foreignKeyRejected: true,
};
export function adminStorageReadinessHandler(
  response: Record<string, unknown> = storageReadinessFixture
) {
  return http.get("/api/org/storage/readiness", () => HttpResponse.json(response));
}
export function adminStorageProbeHandler(response: Record<string, unknown> = storageProbeFixture) {
  return http.post("/api/org/storage/probe", () => HttpResponse.json(response));
}

// --- Tenant webhooks (ADR-0051) ---
const webhooksListFixture = {
  subscriptions: [
    {
      id: "wh-1",
      url: "https://example.com/hooks/platform",
      enabled: true,
      eventTypes: ["platform.test", "tenant.member.invited"],
      hasSecret: true,
      createdAt: "2026-06-12T00:00:00Z",
      updatedAt: null,
    },
  ],
};
const webhooksReadinessFixture = {
  status: "configured",
  total: 1,
  enabled: 1,
};
export function adminWebhooksListHandler(response: Record<string, unknown> = webhooksListFixture) {
  return http.get("/api/org/webhooks", () => HttpResponse.json(response));
}
export function adminWebhooksReadinessHandler(
  response: Record<string, unknown> = webhooksReadinessFixture
) {
  return http.get("/api/org/webhooks/readiness", () => HttpResponse.json(response));
}
export function adminWebhooksCreateHandler() {
  return http.post("/api/org/webhooks", async ({ request }) => {
    const body = (await request.json()) as { url: string; eventTypes: string[]; enabled?: boolean };
    return HttpResponse.json(
      {
        subscription: {
          id: "wh-new",
          url: body.url,
          enabled: body.enabled ?? true,
          eventTypes: body.eventTypes,
          hasSecret: true,
          createdAt: "2026-06-12T00:00:00Z",
          updatedAt: null,
        },
        secret: "whsec_msw",
      },
      { status: 201 }
    );
  });
}
export function adminWebhooksUpdateHandler() {
  return http.patch("/api/org/webhooks/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: String(params["id"]),
      url: "https://example.com/hooks/platform",
      enabled: true,
      eventTypes: ["platform.test"],
      hasSecret: true,
      createdAt: "2026-06-12T00:00:00Z",
      updatedAt: "2026-06-12T01:00:00Z",
      ...body,
    });
  });
}
export function adminWebhooksDeleteHandler() {
  return http.delete("/api/org/webhooks/:id", () => new HttpResponse(null, { status: 204 }));
}
export function adminWebhooksRotateHandler() {
  return http.post("/api/org/webhooks/:id/rotate-secret", ({ params }) =>
    HttpResponse.json({ id: String(params["id"]), secret: "whsec_rotated" })
  );
}
export function adminWebhooksTestHandler(
  response: Record<string, unknown> = { status: "delivered", responseStatus: 200 }
) {
  return http.post("/api/org/webhooks/:id/test", () => HttpResponse.json(response));
}
export function adminWebhooksDeliveriesHandler() {
  return http.get("/api/org/webhooks/:id/deliveries", () =>
    HttpResponse.json({
      deliveries: [
        {
          id: "del-1",
          event: "platform.test",
          status: "delivered",
          responseStatus: 200,
          attempt: 1,
          error: null,
          createdAt: "2026-06-12T00:00:00Z",
        },
        {
          id: "del-dead-1",
          event: "tenant.member.invited",
          status: "dead",
          responseStatus: null,
          attempt: 5,
          error: "Connection refused",
          createdAt: "2026-06-12T01:00:00Z",
        },
      ],
    })
  );
}

const webhooksMetricsFixture = {
  subscriptionId: "wh-1",
  total: 10,
  delivered: 7,
  failed: 2,
  dead: 1,
  pending: 0,
  lastStatus: "delivered",
  lastDeliveryAt: "2026-06-12T00:00:00Z",
  lastSuccessAt: "2026-06-12T00:00:00Z",
  lastFailureAt: "2026-06-11T23:00:00Z",
};

export function adminWebhooksMetricsHandler(
  response: Record<string, unknown> = webhooksMetricsFixture
) {
  return http.get("/api/org/webhooks/:id/metrics", () => HttpResponse.json(response));
}

export function adminWebhooksRedriveHandler() {
  return http.post("/api/org/webhooks/:id/deliveries/:deliveryId/redrive", () =>
    HttpResponse.json({ redriven: 1 })
  );
}

export function adminWebhooksRedriveDeadHandler() {
  return http.post("/api/org/webhooks/:id/redrive-dead", () => HttpResponse.json({ redriven: 2 }));
}

// --- Tenant observability readiness (ADR-0050) ---
const observabilityReadinessFixture = {
  status: "configured",
  logIngestion: "ok",
  tenantScopedQuery: "ok",
  traceCorrelation: "not_applicable",
  highCardinalityGuard: true,
  metrics: "not_applicable",
  otelCollector: "ok",
  dashboards: "ok",
  errorCapture: "not_configured",
};
export function adminObservabilityReadinessHandler(
  response: Record<string, unknown> = observabilityReadinessFixture
) {
  return http.get("/api/org/observability/readiness", () => HttpResponse.json(response));
}

// Mirrors the platform-api SERVICE_REGISTRY + ADR-ACT-0233/0236 console
// classifications (keys, categories, console URLs, routed-vs-direct labelling).
// The platform-api unit suite owns the registry truth; this fixture must track
// it — postgres/redis/loki/etc. carry NO console URL.
const platformService = (
  key: string,
  category: string,
  status: string,
  consoleAccess: "tenant_safe" | "global_only" | "not_exposed",
  consoleUrl: string | null,
  detailKey: string | null = null
) => ({
  key,
  labelKey: `feature.admin.platform.svc.${key}.label`,
  category,
  status,
  localOnly: true,
  consoleUrl,
  consoleAccess,
  // System-operator links are direct local service ports (labelled as such).
  consoleUrlKind: consoleUrl ? ("direct_local" as const) : null,
  checkedAt: "2026-06-12T00:00:00.000Z",
  detailKey,
});

/** The full registry as the BFF returns it to a SYSTEM-ADMIN on the apex host. */
const platformServicesSystemAdminView = [
  platformService("postgres", "data", "healthy", "not_exposed", null),
  platformService(
    "redis",
    "data",
    "configured",
    "not_exposed",
    null,
    "feature.admin.platform.svc.redis.detail"
  ),
  platformService("clickhouse", "data", "healthy", "global_only", "http://localhost:8124/play"),
  platformService("minio", "storage", "healthy", "global_only", "http://localhost:9001"),
  platformService("mailpit", "mail", "healthy", "global_only", "http://localhost:8025/mailpit"),
  platformService("otel_collector", "observability", "healthy", "not_exposed", null),
  platformService("loki", "observability", "healthy", "not_exposed", null),
  platformService("grafana", "observability", "healthy", "global_only", "http://localhost:3200"),
  platformService("keycloak", "auth", "healthy", "tenant_safe", "http://localhost:8090/kc"),
  platformService(
    "mock_oidc",
    "auth",
    "not_configured",
    "not_exposed",
    null,
    "feature.admin.platform.svc.mock_oidc.detail"
  ),
  platformService("pgadmin", "data", "unreachable", "global_only", "http://localhost:5050/pgadmin"),
  platformService("wiremock", "mocks", "unreachable", "not_exposed", null),
  platformService("localstack", "mocks", "unreachable", "global_only", null),
  platformService("sonarqube", "quality", "degraded", "global_only", "http://localhost:9064/sonar"),
  platformService("web_caddy", "web", "unreachable", "global_only", "http://localhost:80"),
];

const platformWorkersFixture = [
  {
    key: "webhook-delivery",
    labelKey: "feature.admin.platform.worker.webhook-delivery.label",
    enabled: true,
    intervalMs: 5000,
    lastTickAt: null,
    lastError: null,
    status: "idle",
    inMemory: true,
  },
];

/** Default fixture = the TENANT-OPERATOR view (tenant FQDN): global-only console
 * links are nulled by the BFF; the tenant-safe Keycloak link is the ROUTED
 * tenant-origin path, never a direct local port (ADR-ACT-0236). */
const platformServicesReadinessFixture = {
  environment: "test",
  appVersion: "abc123",
  viewerMode: "tenant_operator",
  services: platformServicesSystemAdminView.map((s) =>
    s.consoleAccess === "tenant_safe"
      ? { ...s, consoleUrl: "http://acme.aldous.info/kc", consoleUrlKind: "routed" as const }
      : { ...s, consoleUrl: null, consoleUrlKind: null }
  ),
  workers: platformWorkersFixture,
};

/** System-operator view (apex): global-only console links present, direct-local labelled. */
export const platformServicesReadinessSystemAdminFixture = {
  environment: "test",
  appVersion: "abc123",
  viewerMode: "system_operator",
  services: platformServicesSystemAdminView,
  workers: platformWorkersFixture,
};

export function adminPlatformServicesHandler(
  response: Record<string, unknown> = platformServicesReadinessFixture
) {
  return http.get("/api/org/platform/services/readiness", () => HttpResponse.json(response));
}

export function adminEmailSenderHandler(response: Record<string, unknown> = emailSenderFixture) {
  return http.get("/api/org/email-sender", () => HttpResponse.json(response));
}
export function adminEmailSenderUpdateHandler() {
  return http.patch("/api/org/email-sender", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      ...emailSenderFixture,
      ...body,
      hasCredential: true,
      readiness: "unknown",
    });
  });
}
export function adminEmailSenderTestHandler(
  response: Record<string, unknown> = { result: "sent", messageId: "mid-1" }
) {
  return http.post("/api/org/email-sender/test", () => HttpResponse.json(response));
}

/** GET /api/auth/settings/mfa + /session. */
export function adminMfaHandler(response = mfaFixture) {
  return http.get("/api/auth/settings/mfa", () => HttpResponse.json(response));
}
export function adminSessionPolicyHandler(response = sessionPolicyFixture) {
  return http.get("/api/auth/settings/session", () => HttpResponse.json(response));
}
/** GET /api/auth/settings/readiness (ADR-0041 credential readiness). */
export function adminAuthReadinessHandler(response: AuthSettingsReadiness = authReadinessFixture) {
  return http.get("/api/auth/settings/readiness", () => HttpResponse.json(response));
}

/** A failing GET for an admin endpoint (drives error/empty UI states). */
export function adminGetErrorHandler(path: string, status = 503) {
  return http.get(path, () => new HttpResponse(null, { status }));
}

/** GET /api/org/members/:userId/external-identities. */
export function adminExternalIdentitiesHandler(response = externalIdentitiesFixture) {
  return http.get("/api/org/members/:userId/external-identities", () =>
    HttpResponse.json(response)
  );
}

/** GET /api/org/config (Platform Configuration Registry). */
export function adminConfigHandler(response = configFixture) {
  return http.get("/api/org/config", () => HttpResponse.json(response));
}

/** GET /api/org/audit (contextual audit trail). */
export function adminAuditHandler(response = auditFixture) {
  return http.get("/api/org/audit", () => HttpResponse.json(response));
}

/** GET /api/org/readiness (capability map + tenant readiness, ADR-0045). */
export function adminReadinessHandler(response = tenantReadinessFixture) {
  return http.get("/api/org/readiness", () => HttpResponse.json(response));
}

/** All admin write endpoints succeeding — POST/PATCH/DELETE return 200/204. */
export function adminWriteOkHandlers() {
  return [
    http.post("/api/org/members/invite", () => HttpResponse.json({ kind: "added" })),
    http.post("/api/org/members/resend-invite", () => new HttpResponse(null, { status: 204 })),
    // Specific member sub-paths must precede the bare :userId PATCH.
    http.patch("/api/org/members/:userId/username", () => new HttpResponse(null, { status: 204 })),
    http.patch("/api/org/members/:userId/status", () => new HttpResponse(null, { status: 204 })),
    http.patch("/api/org/members/:userId", () => HttpResponse.json({ ok: true })),
    http.delete("/api/org/members/:userId", () => HttpResponse.json({ ok: true })),
    http.patch("/api/org/features/:featureKey", ({ params }) =>
      HttpResponse.json({ key: params["featureKey"], enabled: true, updatedAt: null })
    ),
    http.patch("/api/auth/settings/providers", () => HttpResponse.json(authProvidersFixture)),
    http.patch("/api/auth/settings/session", () => new HttpResponse(null, { status: 204 })),
    http.patch("/api/auth/settings/mfa", () => new HttpResponse(null, { status: 204 })),
    http.post("/api/auth/settings/idps", () => new HttpResponse(null, { status: 201 })),
    http.patch("/api/auth/settings/idps/:alias", () => new HttpResponse(null, { status: 204 })),
    http.delete("/api/auth/settings/idps/:alias", () => new HttpResponse(null, { status: 204 })),
    http.patch("/api/org/config/:key", () => new HttpResponse(null, { status: 204 })),
    http.delete("/api/org/config/:key", () => new HttpResponse(null, { status: 204 })),
    http.patch("/api/admin/tenants/:tenantId/quotas", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { quotaKey?: string };
      return HttpResponse.json({ quotaKey: body.quotaKey ?? "webhooks.deliveries" });
    }),
    http.patch("/api/admin/tenants/:tenantId/entitlements", async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { key?: string; state?: string };
      return HttpResponse.json({
        entitlement: {
          key: body.key ?? "webhooks",
          displayName: "Outbound webhooks",
          description: "",
          category: "developer-platform",
          state: body.state ?? "granted",
          source: "system",
          requiresProvider: false,
          providerKey: null,
          quota: { status: "not_enforced" },
          note: null,
          updatedAt: "2026-06-13T00:00:00.000Z",
          updatedBy: "00000000-0000-0000-0000-0000000000a3",
        },
      });
    }),
  ];
}

// Entitlements (ADR-ACT-0254). One factory serves both the tenant self-read and the
// operator per-tenant read with the same fixture; the PATCH lives in adminWriteOkHandlers.
export function adminEntitlementsHandlers(response = entitlementsFixture) {
  return [
    http.get("/api/org/entitlements", () => HttpResponse.json(response)),
    http.get("/api/admin/tenants/:tenantId/entitlements", () => HttpResponse.json(response)),
  ];
}

export function adminTenantsLookupHandler(response = tenantsLookupFixture) {
  return http.get("/api/admin/tenants", () => HttpResponse.json(response));
}

// Metering + quota (ADR-ACT-0256). Usage + quota reads (tenant own + operator per-tenant).
export function adminUsageQuotaHandlers(usage = usageFixture, quotas = quotasFixture) {
  return [
    http.get("/api/org/usage", () => HttpResponse.json(usage)),
    http.get("/api/admin/tenants/:tenantId/usage", () => HttpResponse.json(usage)),
    http.get("/api/org/quotas", () => HttpResponse.json(quotas)),
    http.get("/api/admin/tenants/:tenantId/quotas", () => HttpResponse.json(quotas)),
  ];
}

// Developer platform (Phase 3, ADR-ACT-0257). API keys (tenant self-service + operator
// read), rate limits (tenant read + operator read/set), developer portal foundation.
export function adminDeveloperHandlers(
  keys = apiKeysFixture,
  created = createApiKeyFixture,
  rateLimits = rateLimitsFixture,
  portal = developerPortalFixture
) {
  return [
    http.get("/api/org/api-keys", () => HttpResponse.json(keys)),
    http.post("/api/org/api-keys", () => HttpResponse.json(created, { status: 201 })),
    http.delete("/api/org/api-keys/:keyId", () => HttpResponse.json({ revoked: true })),
    http.get("/api/org/developer", () => HttpResponse.json(portal)),
    http.get("/api/org/rate-limits", () => HttpResponse.json(rateLimits)),
    http.get("/api/admin/tenants/:tenantId/api-keys", () => HttpResponse.json(keys)),
    http.get("/api/admin/tenants/:tenantId/rate-limits", () => HttpResponse.json(rateLimits)),
    http.patch("/api/admin/tenants/:tenantId/rate-limits", () =>
      HttpResponse.json({ policyKey: "api.requests" })
    ),
  ];
}

// Tenant-isolated product search (Phase 4, ADR-ACT-0258).
export function adminSearchHandlers(
  searchResponse = searchResponseFixture,
  readiness = searchReadinessFixture
) {
  return [
    http.post("/api/org/search", () => HttpResponse.json(searchResponse)),
    http.get("/api/admin/search/readiness", () => HttpResponse.json(readiness)),
    http.post("/api/admin/search/reindex", () => HttpResponse.json({ reindexed: 1 })),
  ];
}

// --- generic helpers --------------------------------------------------------

/** Simulated network failure for any GET endpoint. */
export function networkErrorHandler(method: "get" | "post", path: string) {
  return http[method](path, () => HttpResponse.error());
}

// --- baseline ---------------------------------------------------------------
// Defaults are intentionally unauthenticated: a test must opt into a persona via
// server.use(sessionHandler("tenantAdmin")). This keeps authorisation explicit.
export const handlers = [
  sessionHandler(null),
  themeHandler(),
  providersHandler(),
  createGraphqlHandler(),
  http.get("/healthz", () => HttpResponse.json({ status: "ok" })),
  http.get("/readyz", () => HttpResponse.json({ status: "ok" })),
  http.get("/version", () => HttpResponse.json({ version: "test", commit: "test" })),
  http.get("/api/admin/logs/search", () => HttpResponse.json({ entries: [] })),
  // Admin control plane (ADR-0036).
  adminMembersHandler(),
  adminFeaturesHandler(),
  adminAuthProvidersHandler(),
  adminIdpsHandler(),
  adminMfaHandler(),
  adminSessionPolicyHandler(),
  adminAuthReadinessHandler(),
  adminExternalIdentitiesHandler(),
  adminConfigHandler(),
  adminAuditHandler(),
  adminReadinessHandler(),
  adminDomainsListHandler(),
  adminDomainsReadinessHandler(),
  adminDomainsActivateHandler(),
  adminDomainsDeactivateHandler(),
  adminDomainsProbeRoutingHandler(),
  adminDomainsSetCanonicalHandler(),
  adminDomainsUnsetCanonicalHandler(),
  adminStorageReadinessHandler(),
  adminObservabilityReadinessHandler(),
  adminPlatformServicesHandler(),
  adminWebhooksListHandler(),
  adminWebhooksReadinessHandler(),
  ...adminEntitlementsHandlers(),
  adminTenantsLookupHandler(),
  ...adminUsageQuotaHandlers(),
  ...adminDeveloperHandlers(),
  ...adminSearchHandlers(),
  ...adminWriteOkHandlers(),
];
