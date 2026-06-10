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
} from "./fixtures/admin.ts";

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
/** GET /api/auth/settings/mfa + /session. */
export function adminMfaHandler(response = mfaFixture) {
  return http.get("/api/auth/settings/mfa", () => HttpResponse.json(response));
}
export function adminSessionPolicyHandler(response = sessionPolicyFixture) {
  return http.get("/api/auth/settings/session", () => HttpResponse.json(response));
}

/** A failing GET for an admin endpoint (drives error/empty UI states). */
export function adminGetErrorHandler(path: string, status = 503) {
  return http.get(path, () => new HttpResponse(null, { status }));
}

/** All admin write endpoints succeeding — POST/PATCH/DELETE return 200. */
export function adminWriteOkHandlers() {
  return [
    http.post("/api/org/members/invite", () => HttpResponse.json({ kind: "added" })),
    http.patch("/api/org/members/:userId", () => HttpResponse.json({ ok: true })),
    http.delete("/api/org/members/:userId", () => HttpResponse.json({ ok: true })),
    http.patch("/api/org/features/:featureKey", ({ params }) =>
      HttpResponse.json({ key: params["featureKey"], enabled: true, updatedAt: null })
    ),
    http.patch("/api/auth/settings/providers", () => HttpResponse.json(authProvidersFixture)),
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
  ...adminWriteOkHandlers(),
];
