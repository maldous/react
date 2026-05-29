import type { Route } from "./pipeline.ts";
import { getHealth, getReadiness, getVersion } from "./health.ts";
import { getFixtureSession } from "./session.ts";
import { handleGetOrganisationProfile, handlePatchOrganisationProfile } from "./organisation.ts";
import {
  handleAuthLogin,
  handleAuthCallback,
  handleAuthLogout,
  parseSessionCookie,
} from "./auth.ts";
import { handleForwardAuth } from "./forward-auth.ts";
import { getSessionStore, getApplicationPool } from "./dependencies.ts";
import { serverT } from "./i18n.ts";
import { DEFAULT_THEME } from "@platform/authorisation-runtime";
import {
  provisionTenant,
  getTenantResourceConfig,
  CreateTenantRequestSchema,
} from "./provisioning.ts";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/healthz",
    handler: async (_req, res) => res.json(200, getHealth()),
  },
  {
    method: "GET",
    path: "/readyz",
    handler: async (_req, res) => {
      const result = await getReadiness();
      res.json(result.status === "ready" ? 200 : 503, result);
    },
  },
  {
    method: "GET",
    path: "/version",
    handler: async (_req, res) => res.json(200, getVersion()),
  },
  {
    method: "GET",
    path: "/api/session",
    handler: async (req, res) => {
      // Fixture session takes precedence (Tier 1 E2E determinism)
      const fixtureActor = getFixtureSession();
      if (fixtureActor) {
        res.json(200, fixtureActor);
        return;
      }
      // Real session: read from HTTP-only cookie → Redis
      const sessionId = parseSessionCookie(req.raw.headers["cookie"]);
      if (sessionId) {
        try {
          const record = await getSessionStore().find(sessionId);
          if (record) {
            res.json(200, {
              userId: record.userId,
              tenantId: record.tenantId,
              organisationId: record.organisationId,
              roles: record.roles,
              permissions: record.permissions,
              displayName: record.displayName,
            });
            return;
          }
        } catch {
          // Redis unavailable — fall through to 401
        }
      }
      res.json(401, {
        code: "UNAUTHENTICATED",
        message: serverT("api.error.unauthenticatedSession"),
      });
    },
  },
  // ---------------------------------------------------------------------------
  // Caddy forward auth (ADR-0029, ADR-0030)
  // Called by Caddy's forward_auth directive before proxying admin/tool UIs.
  // Not authenticated itself — reads session cookie forwarded by Caddy.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/internal/auth/forward",
    operationName: "internal.auth.forward",
    handler: handleForwardAuth,
  },
  // ---------------------------------------------------------------------------
  // Auth routes (ADR-ACT-0119)
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/auth/login",
    operationName: "auth.login",
    handler: handleAuthLogin,
  },
  {
    method: "GET",
    path: "/auth/callback",
    operationName: "auth.callback",
    handler: handleAuthCallback,
  },
  {
    method: "POST",
    path: "/auth/logout",
    operationName: "auth.logout",
    handler: handleAuthLogout,
  },
  // ---------------------------------------------------------------------------
  // Theme / branding (ADR-0029 §4) — unauthenticated, keyed by Host header.
  // Returns per-tenant branding config for the React SPA to apply at load time.
  // Stub: returns defaults until tenant_settings table is provisioned (ADR-ACT-0142).
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/theme",
    handler: async (_req, res) => {
      // TODO ADR-ACT-0142: resolve host → slug → tenant_settings for real branding
      res.json(200, DEFAULT_THEME);
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant provisioning (ADR-ACT-0142)
  // POST — provision a new tenant with per-resource tier config.
  // GET  — read a tenant's current resource config.
  // System-admin only (requiredPermission: admin.access).
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/tenants",
    operationName: "admin.tenants.create",
    requiresAuth: true,
    requiredPermission: "admin.access",
    handler: async (req, res) => {
      const parsed = CreateTenantRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? "Invalid request body";
        res.json(400, { code: "VALIDATION_ERROR", message: msg });
        return;
      }
      const result = await provisionTenant(parsed.data);
      res.json(201, result);
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/resources",
    operationName: "admin.tenants.resources.get",
    requiresAuth: true,
    requiredPermission: "admin.access",
    handler: async (req, res) => {
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const organisationId = url.searchParams.get("organisationId") ?? "";
      if (!organisationId) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const config = await getTenantResourceConfig(getApplicationPool(), organisationId);
      if (!config) {
        res.json(404, { code: "NOT_FOUND", message: serverT("api.error.organisationNotFound") });
        return;
      }
      res.json(200, config);
    },
  },
  {
    method: "POST",
    path: "/api/admin/sub-tenants",
    operationName: "admin.sub-tenants.create",
    requiresAuth: true,
    requiredPermission: "admin.access",
    handler: async (_req, res) => {
      res.json(501, { code: "NOT_IMPLEMENTED", message: serverT("api.error.notImplemented") });
    },
  },
  // ---------------------------------------------------------------------------
  // Organisation profile
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/organisation/profile",
    operationName: "organisation.profile.get",
    requiresAuth: true,
    requiredPermission: "organisation.read",
    handler: handleGetOrganisationProfile,
  },
  {
    method: "PATCH",
    path: "/api/organisation/profile",
    operationName: "organisation.profile.update",
    requiresAuth: true,
    requiredPermission: "organisation.update",
    handler: handlePatchOrganisationProfile,
  },
];
