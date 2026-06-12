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

// --- Tenant custom domains (ADR-0048) ---
const domainsListFixture = {
  domains: [
    {
      domain: "app.example.com",
      status: "pending_dns",
      tls: "tls_unknown",
      routing: "routing_unknown",
      txtRecord: "_platform-verify.app.example.com",
      createdAt: "2026-06-12T00:00:00Z",
      verifiedAt: null,
      expiresAt: null,
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
  adminStorageReadinessHandler(),
  ...adminWriteOkHandlers(),
];
