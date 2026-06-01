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
import { getSessionStore, getApplicationPool, getKeycloakConfigForRealm } from "./dependencies.ts";
import { queryTenantSchema } from "@platform/adapters-postgres";
import { serverT } from "./i18n.ts";
import { DEFAULT_THEME } from "@platform/authorisation-runtime";
import {
  provisionTenant,
  getTenantResourceConfig,
  CreateTenantRequestSchema,
} from "./provisioning.ts";
import { enterSupportMode } from "../usecases/support.ts";
import {
  mutateAuthSetting,
  buildIdpAuditMetadata,
  buildMfaAuditMetadata,
  buildSessionAuditMetadata,
  buildSysadminBrokeringAuditMetadata,
} from "../usecases/auth-settings.ts";
import { createPostgresAuditEventPort, AuditAction } from "@platform/audit-events";
import { resolveTenantFromRequest } from "./tenant-resolver.ts";
import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import { PostgresTenantCredentialStore } from "../adapters/postgres-tenant-credential-store.ts";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Auth Settings body schemas (ADR-0030 ?1b safety)
// Client-supplied bodies are validated; admin secrets/clientIds are stripped.
// Realm is always derived from the Host header ? never from the request body.
// ---------------------------------------------------------------------------

const IdpBodySchema = z.object({
  alias: z.string().min(1).max(64),
  displayName: z.string().min(1).max(120),
  providerId: z.enum(["oidc", "saml", "keycloak-oidc"]),
  config: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

const MfaBodySchema = z.object({
  required: z.enum(["none", "optional", "required"]),
  type: z.enum(["totp", "webauthn"]).default("totp"),
  gracePeriodSeconds: z.number().int().min(0).optional(),
});

const SessionBodySchema = z.object({
  accessTokenLifespanSeconds: z.number().int().min(60).max(86400),
  ssoSessionIdleTimeoutSeconds: z.number().int().min(300).max(86400),
  ssoSessionMaxLifespanSeconds: z.number().int().min(3600).max(2592000),
  rememberMe: z.boolean().default(false),
});

const SysadminBrokeringBodySchema = z.object({
  enabled: z.boolean(),
  requireMfa: z.boolean().default(true),
  auditAllAccess: z.boolean().default(true),
});

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
      // Real session: read from HTTP-only cookie ? Redis
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
          // Redis unavailable ? fall through to 401
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
  // Not authenticated itself ? reads session cookie forwarded by Caddy.
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
  // Theme / branding (ADR-0029 ?4) ? unauthenticated, keyed by Host header.
  // Returns per-tenant branding config for the React SPA to apply at load time.
  // Stub: returns defaults until tenant_settings table is provisioned (ADR-ACT-0142).
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/theme",
    handler: async (req, res) => {
      // Resolve per-tenant branding from tenant_settings (ADR-0029 ?4).
      // Uses queryTenantSchema from adapters-postgres ? same UUID validation
      // and client.escapeIdentifier safety as withTenant. No manual schema
      // string construction here (centralised in adapters-postgres).
      try {
        const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
        if (tenantCtx) {
          const { rows } = await queryTenantSchema<{ key: string; value: unknown }>(
            getApplicationPool(),
            tenantCtx.organisationId,
            "SELECT key, value FROM tenant_settings WHERE key LIKE 'theme.%'"
          );
          if (rows.length > 0) {
            const theme = { ...DEFAULT_THEME };
            for (const row of rows) {
              const field = row.key.replace("theme.", "") as keyof typeof theme;
              (theme as Record<string, unknown>)[field] = row.value;
            }
            res.json(200, theme);
            return;
          }
        }
      } catch {
        // Schema not yet created or settings not seeded ? fall through to defaults
      }
      res.json(200, DEFAULT_THEME);
    },
  },
  // ---------------------------------------------------------------------------
  // Auth Settings API — tenant admin self-service (ADR-0030 §1b)
  // Tenant admin manages their realm's IdPs, MFA policy, session policy, and
  // sysadmin brokering through these endpoints. All calls are proxied to
  // Keycloak Admin REST API via KeycloakRealmAdminAdapter.
  // scope: "tenant" — must be called from a tenant FQDN, not the global apex.
  //
  // All Auth Settings routes (read + write) use the per-tenant service account
  // credential stored in tenant_auth_settings_credentials (ADR-ACT-0186).
  // Reads resolve the credential then build the adapter; returns 503 NO_CREDENTIAL
  // if the tenant was provisioned before ADR-ACT-0186 landed.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/auth/settings/idps",
    operationName: "auth.settings.idps.list",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.read",
    resource: "admin:auth",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      res.json(200, await adapter.listIdentityProviders());
    },
  },
  {
    method: "POST",
    path: "/api/auth/settings/idps",
    operationName: "auth.settings.idps.upsert",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsIdpChanged,
          buildAuditMetadata: buildIdpAuditMetadata,
          schema: IdpBodySchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).upsertIdentityProvider(body),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "no_tenant") {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      if (result.kind === "no_credential") {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "GET",
    path: "/api/auth/settings/mfa",
    operationName: "auth.settings.mfa.get",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.read",
    resource: "admin:auth",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      res.json(200, await adapter.getMfaPolicy());
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/mfa",
    operationName: "auth.settings.mfa.set",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsMfaChanged,
          buildAuditMetadata: buildMfaAuditMetadata,
          schema: MfaBodySchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).setMfaPolicy(body),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "no_tenant") {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      if (result.kind === "no_credential") {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "GET",
    path: "/api/auth/settings/session",
    operationName: "auth.settings.session.get",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.read",
    resource: "admin:auth",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      res.json(200, await adapter.getSessionPolicy());
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/session",
    operationName: "auth.settings.session.set",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsSessionChanged,
          buildAuditMetadata: buildSessionAuditMetadata,
          schema: SessionBodySchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).setSessionPolicy(body),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "no_tenant") {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      if (result.kind === "no_credential") {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "GET",
    path: "/api/auth/settings/sysadmin-brokering",
    operationName: "auth.settings.brokering.get",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.read",
    resource: "admin:auth",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      res.json(200, await adapter.getSysadminBrokering());
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/sysadmin-brokering",
    operationName: "auth.settings.brokering.set",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsSysadminBrokeringChanged,
          buildAuditMetadata: buildSysadminBrokeringAuditMetadata,
          schema: SysadminBrokeringBodySchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).setSysadminBrokering(body),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "no_tenant") {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      if (result.kind === "no_credential") {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant provisioning (ADR-ACT-0142)
  // POST — provision a new tenant with per-resource tier config.
  // GET  — read a tenant's current resource config.
  // scope: "global" — system-admin only, must be called from global apex host.
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/tenants",
    operationName: "admin.tenants.create",
    requiresAuth: true,
    requiredPermission: "platform.tenants.create",
    resource: "admin:tenants",
    umaScope: "create" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = CreateTenantRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const msg = parsed.error.issues[0]?.message ?? "Invalid request body";
        res.json(400, { code: "VALIDATION_ERROR", message: msg });
        return;
      }
      const result = await provisionTenant(parsed.data, req.actor!.userId);
      res.json(201, result);
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/resources",
    operationName: "admin.tenants.resources.get",
    requiresAuth: true,
    requiredPermission: "platform.tenants.read",
    resource: "admin:tenants",
    umaScope: "read" as const,
    scope: "global" as const,
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
    requiredPermission: "tenant.admin.access",
    resource: "admin:tenants",
    umaScope: "create" as const,
    scope: "tenant" as const,
    handler: async (_req, res) => {
      res.json(501, { code: "NOT_IMPLEMENTED", message: serverT("api.error.notImplemented") });
    },
  },
  // ---------------------------------------------------------------------------
  // Support mode — explicit audited system-admin support session (ADR-ACT-0187)
  // Must be called from the global host (scope: global). Creates a short-lived
  // support session for the specified tenant. Audit event is emitted before
  // the session is created — no unaudited support access.
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/support-session",
    operationName: "admin.support-session.create",
    requiresAuth: true,
    requiredPermission: "platform.admin.access",
    resource: "platform:support",
    umaScope: "enter" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const SupportSessionRequestSchema = z.object({
        targetOrganisationId: z.string().uuid("targetOrganisationId must be a valid UUID"),
        supportAccessReason: z.string().min(1, "supportAccessReason must not be empty").max(500),
      });

      const parsed = SupportSessionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }

      const { targetOrganisationId, supportAccessReason } = parsed.data;
      const actor = req.actor!;
      const auditPort = createPostgresAuditEventPort(getApplicationPool());

      try {
        const result = await enterSupportMode(
          {
            actorUserId: actor.userId,
            actorRoles: actor.roles,
            actorDisplayName: actor.displayName,
            targetOrganisationId,
            targetTenantId: targetOrganisationId,
            supportAccessReason,
            sourceHost:
              (req.raw.headers["x-forwarded-host"] as string | undefined) ??
              req.raw.headers["host"],
            ipAddress:
              (req.raw.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
              req.raw.socket?.remoteAddress,
          },
          { sessions: getSessionStore(), audit: auditPort }
        );

        res.json(201, {
          supportSessionId: result.supportSessionId,
          targetOrganisationId: result.targetOrganisationId,
          supportAccessReason: result.supportAccessReason,
          expiresInSeconds: 3600,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "support session creation failed";
        if (msg.startsWith("support_mode.reason_required")) {
          res.json(400, {
            code: "VALIDATION_ERROR",
            message: "supportAccessReason must not be empty",
          });
        } else if (msg.startsWith("support_mode.forbidden")) {
          res.json(403, {
            code: "FORBIDDEN",
            message: "Only system-admin may create support sessions",
          });
        } else {
          throw err;
        }
      }
    },
  },
  // ---------------------------------------------------------------------------
  // Resource policy management — tenant admin self-service (ADR-ACT-0151 / ADR-0030 §3d)
  // Tenant admins view and update resource policies for their realm at runtime.
  // Changes take effect on the next request — no deployment required.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/auth/settings/resource-policies",
    operationName: "auth.settings.resource-policies.list",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.read",
    resource: "admin:auth",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const { getResourcePolicies } = await import("../usecases/resource-policies.ts");
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      const result = await getResourcePolicies(
        {
          organisationId: tenantCtx.organisationId,
          realmName: tenantCtx.realmName,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { adapter }
      );
      res.json(200, result);
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/resource-policies",
    operationName: "auth.settings.resource-policies.set",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const ResourcePolicyBodySchema = z.object({
        resourceName: z.string().min(1).max(120),
        policy: z.object({
          name: z.string().min(1).max(120),
          type: z.enum(["role", "time", "aggregated", "user", "group", "regex", "js"]),
          config: z.record(z.string(), z.unknown()).default({}),
        }),
      });
      const parsed = ResourcePolicyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const { setResourcePolicy } = await import("../usecases/resource-policies.ts");
      const adapter = new KeycloakRealmAdminAdapter({
        url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
        realm: tenantCtx.realmName,
        adminClientId: cred.clientId,
        adminClientSecret: cred.clientSecret,
      });
      await setResourcePolicy(
        {
          organisationId: tenantCtx.organisationId,
          realmName: tenantCtx.realmName,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          resourceName: parsed.data.resourceName,
          policy: parsed.data.policy as import("@platform/authorisation-runtime").ResourcePolicy,
        },
        { adapter, audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      res.json(204, null);
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
    resource: "organisation:profile",
    umaScope: "read" as const,
    handler: handleGetOrganisationProfile,
  },
  {
    method: "PATCH",
    path: "/api/organisation/profile",
    operationName: "organisation.profile.update",
    requiresAuth: true,
    requiredPermission: "organisation.update",
    resource: "organisation:profile",
    umaScope: "write" as const,
    handler: handlePatchOrganisationProfile,
  },
];
