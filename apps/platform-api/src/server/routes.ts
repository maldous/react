import { ConflictError } from "@platform/platform-errors";
import type { Route } from "./pipeline.ts";
import { getHealth, getReadiness, getVersion } from "./health.ts";
import { getFixtureSession } from "./session.ts";
import { handleGetOrganisationProfile, handlePatchOrganisationProfile } from "./organisation.ts";
import { handleGraphql } from "./graphql.ts";
import { handleSearchLogs } from "./admin-logs.ts";
import {
  handleAuthLogin,
  handleAuthCallback,
  handleAuthLogout,
  handleAuthLogoutRedirect,
  parseSessionCookie,
} from "./auth.ts";
import { handleForwardAuth } from "./forward-auth.ts";
import {
  listEnabledProviders,
  environmentDefaultMode,
  availableThirdPartyIds,
} from "./auth-providers.ts";
import { getStoredTenantAuthProviders } from "../usecases/auth-provider-config.ts";
import type { TenantAuthProvidersConfig } from "@platform/contracts-admin";
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
  {
    // GET /auth/logout?returnTo=/login
    // Preferred for UI — performs full browser-navigation logout:
    //   1. destroys platform Redis session
    //   2. clears platform_session cookie (host-only + domain-scoped)
    //   3. redirects browser to Keycloak RP-Initiated Logout endpoint
    // After KC logout, browser is sent to post_logout_redirect_uri (returnTo).
    method: "GET",
    path: "/auth/logout",
    operationName: "auth.logout.redirect",
    handler: handleAuthLogoutRedirect,
  },
  // ---------------------------------------------------------------------------
  // Login provider list (ADR-ACT-0157) — unauthenticated.
  // Returns the brokered third-party + platform login options the React /login
  // selector should render. Environment/mode aware; contains NO secrets or
  // Keycloak credentials. Each item links to the BFF handoff (/auth/login?provider=),
  // never directly to Keycloak or the mock-oidc fixture.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/auth/providers",
    operationName: "auth.providers.list",
    handler: async (req, res) => {
      // Tenant-aware (ADR-0037): merge the tenant's stored provider config over the
      // environment defaults. Unauthenticated + pre-session: tenant resolved from FQDN.
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(
        () => null
      );
      const tenantConfig: TenantAuthProvidersConfig | undefined = tenantCtx
        ? ((await getStoredTenantAuthProviders(
            tenantCtx.organisationId,
            getApplicationPool()
          ).catch(() => null)) ?? undefined)
        : undefined;
      res.json(200, listEnabledProviders(tenantConfig));
    },
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
  // ---------------------------------------------------------------------------
  // Per-tenant authentication provider config (ADR-0037). Stored in tenant_settings
  // (auth.providers) — no Keycloak credential needed (unlike the idp/mfa/session
  // routes). Controls which product providers/login options the tenant offers.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/auth/settings/providers",
    operationName: "auth.settings.providers.get",
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
      const availableProviders = availableThirdPartyIds();
      const stored = await getStoredTenantAuthProviders(
        tenantCtx.organisationId,
        getApplicationPool()
      );
      const config = stored ?? { mode: "default" as const, enabledProviders: availableProviders };
      res.json(200, {
        config,
        environmentDefaultMode: environmentDefaultMode(),
        availableProviders,
      });
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/providers",
    operationName: "auth.settings.providers.set",
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
      const availableProviders = availableThirdPartyIds();
      const stored = await getStoredTenantAuthProviders(
        tenantCtx.organisationId,
        getApplicationPool()
      );
      const currentConfig = stored ?? {
        mode: "default" as const,
        enabledProviders: availableProviders,
      };
      const { setTenantAuthProviders } = await import("../usecases/auth-provider-config.ts");
      const result = await setTenantAuthProviders(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          currentConfig,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      res.json(200, {
        config: result.config,
        environmentDefaultMode: environmentDefaultMode(),
        availableProviders,
      });
    },
  },
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
      try {
        const result = await provisionTenant(parsed.data, req.actor!.userId);
        res.json(201, result);
      } catch (err) {
        if (err instanceof ConflictError) {
          res.json(409, { code: "CONFLICT", message: err.message });
          return;
        }
        throw err;
      }
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
    requiredPermission: "tenant.suborgs.create",
    resource: "organisation:sub-organisations",
    umaScope: "create" as const,
    scope: "tenant" as const,
    handler: async (_req, res) => {
      // Redirects to the canonical sub-organisations endpoint
      res.json(308, { code: "MOVED", message: "Use POST /api/org/sub-organisations" });
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
          type: z.enum(["role", "time", "aggregated", "user", "group", "regex"]),
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
  // Vanity domain management — tenant admin runtime redirect_uri management (ADR-ACT-0162)
  // Add/remove custom domains from the tenant's BFF client without deployment.
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/auth/settings/domains",
    operationName: "auth.settings.domains.add",
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
      const DomainBodySchema = z.object({
        domain: z.string().regex(/^[a-zA-Z0-9.-]+$/, "domain must be a valid hostname"),
      });
      const parsed = DomainBodySchema.safeParse(req.body);
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
      const { addVanityDomain } = await import("../usecases/vanity-domain.ts");
      await addVanityDomain(
        {
          organisationId: tenantCtx.organisationId,
          realmName: tenantCtx.realmName,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          domain: parsed.data.domain,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          adminConfig: {
            url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
            realm: tenantCtx.realmName,
            adminClientId: cred.clientId,
            adminClientSecret: cred.clientSecret,
          },
        }
      );
      res.json(201, { domain: parsed.data.domain });
    },
  },
  {
    method: "DELETE",
    path: "/api/auth/settings/domains/:domain",
    operationName: "auth.settings.domains.remove",
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
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const domain = url.pathname.split("/").pop() ?? "";
      if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid domain format" });
        return;
      }
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const { removeVanityDomain } = await import("../usecases/vanity-domain.ts");
      await removeVanityDomain(
        {
          organisationId: tenantCtx.organisationId,
          realmName: tenantCtx.realmName,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          domain,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          adminConfig: {
            url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
            realm: tenantCtx.realmName,
            adminClientId: cred.clientId,
            adminClientSecret: cred.clientSecret,
          },
        }
      );
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Member management (ADR-ACT-0143 Slice 1)
  // Tenant admin self-service: list, invite, update role, remove members.
  // All routes: scope "tenant" — must arrive at {slug}.aldous.info.
  // UMA resource: organisation:members
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/members",
    operationName: "org.members.list",
    requiresAuth: true,
    requiredPermission: "tenant.members.read",
    resource: "organisation:members",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listOrgMembers } = await import("../usecases/members.ts");
      const result = await listOrgMembers(tenantCtx.organisationId, getApplicationPool());
      res.json(200, result);
    },
  },
  {
    method: "POST",
    path: "/api/org/members/invite",
    operationName: "org.members.invite",
    requiresAuth: true,
    requiredPermission: "tenant.members.invite",
    resource: "organisation:members",
    umaScope: "invite" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { inviteOrgMember } = await import("../usecases/members.ts");
      const result = await inviteOrgMember(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "conflict" || result.kind === "already_invited") {
        res.json(409, {
          code: "CONFLICT",
          message:
            result.kind === "conflict" ? "Member already exists" : "Invitation already pending",
        });
        return;
      }
      res.json(201, { kind: result.kind });
    },
  },
  {
    method: "PATCH",
    path: "/api/org/members/:userId",
    operationName: "org.members.update_role",
    requiresAuth: true,
    requiredPermission: "tenant.members.update_role",
    resource: "organisation:members",
    umaScope: "update_role" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const targetUserId = req.params["userId"] ?? "";
      if (!targetUserId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "userId path parameter is required" });
        return;
      }
      const { updateMemberRole } = await import("../usecases/members.ts");
      const result = await updateMemberRole(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          targetUserId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: serverT("api.error.organisationNotFound") });
        return;
      }
      if (result.kind === "last_admin_cannot_be_demoted") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "Cannot demote the last tenant-admin",
        });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/members/:userId",
    operationName: "org.members.remove",
    requiresAuth: true,
    requiredPermission: "tenant.members.delete",
    resource: "organisation:members",
    umaScope: "delete" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const targetUserId = req.params["userId"] ?? "";
      if (!targetUserId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "userId path parameter is required" });
        return;
      }
      const { removeMember } = await import("../usecases/members.ts");
      const result = await removeMember(
        {
          organisationId: tenantCtx.organisationId,
          targetUserId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: serverT("api.error.organisationNotFound") });
        return;
      }
      if (result.kind === "last_admin_cannot_be_removed") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "Cannot remove the last tenant-admin",
        });
        return;
      }
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Group management (ADR-ACT-0143 Slice 2)
  // Tenant admin manages groups in their own Keycloak realm.
  // All routes: scope "tenant" — must arrive at {slug}.aldous.info.
  // Uses per-tenant auth-settings credential (ADR-ACT-0186).
  // UMA resource: organisation:groups
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/groups",
    operationName: "org.groups.list",
    requiresAuth: true,
    requiredPermission: "tenant.groups.read",
    resource: "organisation:groups",
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
      const { listOrgGroups } = await import("../usecases/groups.ts");
      const groups = await listOrgGroups(adapter);
      res.json(200, { groups });
    },
  },
  {
    method: "POST",
    path: "/api/org/groups",
    operationName: "org.groups.create",
    requiresAuth: true,
    requiredPermission: "tenant.groups.create",
    resource: "organisation:groups",
    umaScope: "create" as const,
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
      const body = req.body as Record<string, unknown>;
      const { createOrgGroup } = await import("../usecases/groups.ts");
      const result = await createOrgGroup(
        {
          rawName: body?.name,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { groups: adapter, audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      if (result.kind === "invalid_name") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "conflict") {
        res.json(409, { code: "CONFLICT", message: "A group with this name already exists" });
        return;
      }
      res.json(201, { groupId: result.groupId, name: result.groupName });
    },
  },
  {
    method: "PATCH",
    path: "/api/org/groups/:groupId",
    operationName: "org.groups.update",
    requiresAuth: true,
    requiredPermission: "tenant.groups.update",
    resource: "organisation:groups",
    umaScope: "update" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const groupId = req.params["groupId"] ?? "";
      if (!groupId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "groupId path parameter is required" });
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
      const body = req.body as Record<string, unknown>;
      const { updateOrgGroup } = await import("../usecases/groups.ts");
      const result = await updateOrgGroup(
        {
          groupId,
          rawName: body?.name,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { groups: adapter, audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      if (result.kind === "invalid_name") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Group not found" });
        return;
      }
      if (result.kind === "conflict") {
        res.json(409, { code: "CONFLICT", message: "A group with this name already exists" });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/groups/:groupId",
    operationName: "org.groups.delete",
    requiresAuth: true,
    requiredPermission: "tenant.groups.delete",
    resource: "organisation:groups",
    umaScope: "delete" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const groupId = req.params["groupId"] ?? "";
      if (!groupId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "groupId path parameter is required" });
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
      const { deleteOrgGroup } = await import("../usecases/groups.ts");
      const result = await deleteOrgGroup(
        {
          groupId,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { groups: adapter, audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Group not found" });
        return;
      }
      if (result.kind === "protected") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "This group is protected and cannot be deleted",
        });
        return;
      }
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Feature toggles (ADR-ACT-0143 Slice 4)
  // Tenant admin enables/disables named platform capabilities.
  // Stored in tenant_settings (tenant schema). Audit-first.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/features",
    operationName: "org.features.list",
    requiresAuth: true,
    requiredPermission: "tenant.features.read",
    resource: "organisation:features",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listFeatures } = await import("../usecases/features.ts");
      const features = await listFeatures(tenantCtx.organisationId, getApplicationPool());
      res.json(200, { features });
    },
  },
  {
    method: "PATCH",
    path: "/api/org/features/:featureKey",
    operationName: "org.features.toggle",
    requiresAuth: true,
    requiredPermission: "tenant.features.update",
    resource: "organisation:features",
    umaScope: "update" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const featureKey = req.params["featureKey"] ?? "";
      const { toggleFeature } = await import("../usecases/features.ts");
      const result = await toggleFeature(
        {
          rawBody: req.body,
          featureKey,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "unknown_key") {
        res.json(404, { code: "NOT_FOUND", message: result.message });
        return;
      }
      res.json(200, result.state);
    },
  },
  // ---------------------------------------------------------------------------
  // Sub-organisation management (ADR-ACT-0143 Slice 3)
  // Tenant admin manages sub-organisations inside their own tenant.
  // Sub-orgs are Tier 2: share parent Keycloak realm, no new infrastructure.
  // All routes: scope "tenant" — must arrive at {slug}.aldous.info.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/sub-organisations",
    operationName: "org.sub-organisations.list",
    requiresAuth: true,
    requiredPermission: "tenant.suborgs.read",
    resource: "organisation:sub-organisations",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listSubOrgs } = await import("../usecases/sub-organisations.ts");
      const subOrgs = await listSubOrgs(tenantCtx.organisationId, getApplicationPool());
      res.json(200, { subOrganisations: subOrgs });
    },
  },
  {
    method: "POST",
    path: "/api/org/sub-organisations",
    operationName: "org.sub-organisations.create",
    requiresAuth: true,
    requiredPermission: "tenant.suborgs.create",
    resource: "organisation:sub-organisations",
    umaScope: "create" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { createSubOrg } = await import("../usecases/sub-organisations.ts");
      const result = await createSubOrg(
        {
          rawBody: req.body,
          parentOrgId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "reserved_slug") {
        res.json(422, { code: "VALIDATION_ERROR", message: "This slug is reserved" });
        return;
      }
      if (result.kind === "conflict") {
        res.json(409, {
          code: "CONFLICT",
          message: "An organisation with this slug already exists",
        });
        return;
      }
      res.json(201, result.subOrg);
    },
  },
  {
    method: "PATCH",
    path: "/api/org/sub-organisations/:subOrgId",
    operationName: "org.sub-organisations.update",
    requiresAuth: true,
    requiredPermission: "tenant.suborgs.update",
    resource: "organisation:sub-organisations",
    umaScope: "update" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const subOrgId = req.params["subOrgId"] ?? "";
      if (!subOrgId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "subOrgId path parameter is required" });
        return;
      }
      const { updateSubOrg } = await import("../usecases/sub-organisations.ts");
      const result = await updateSubOrg(
        {
          rawBody: req.body,
          parentOrgId: tenantCtx.organisationId,
          subOrgId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Sub-organisation not found" });
        return;
      }
      res.json(200, result.subOrg);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/sub-organisations/:subOrgId",
    operationName: "org.sub-organisations.deactivate",
    requiresAuth: true,
    requiredPermission: "tenant.suborgs.delete",
    resource: "organisation:sub-organisations",
    umaScope: "delete" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const subOrgId = req.params["subOrgId"] ?? "";
      if (!subOrgId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "subOrgId path parameter is required" });
        return;
      }
      const { deactivateSubOrg } = await import("../usecases/sub-organisations.ts");
      const result = await deactivateSubOrg(
        {
          parentOrgId: tenantCtx.organisationId,
          subOrgId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Sub-organisation not found" });
        return;
      }
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Vanity domain ownership challenges (ADR-ACT-0188)
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/auth/settings/domains/challenges",
    operationName: "auth.settings.domains.challenge.create",
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
      const body = req.body as Record<string, unknown>;
      const domain = typeof body?.domain === "string" ? body.domain : "";
      const { createDomainChallenge } = await import("../usecases/vanity-domain-challenge.ts");
      const result = await createDomainChallenge(
        {
          domain,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "invalid_domain") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      res.json(201, { txtRecord: result.txtRecord, token: result.token });
    },
  },
  {
    method: "POST",
    path: "/api/auth/settings/domains/verify",
    operationName: "auth.settings.domains.challenge.verify",
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
      const body = req.body as Record<string, unknown>;
      const domain = typeof body?.domain === "string" ? body.domain : "";
      const { verifyDomainChallenge } = await import("../usecases/vanity-domain-challenge.ts");
      const result = await verifyDomainChallenge(
        {
          domain,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          pool: getApplicationPool(),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "No active challenge for this domain" });
        return;
      }
      if (result.kind === "expired") {
        res.json(422, { code: "VALIDATION_ERROR", message: "Challenge has expired" });
        return;
      }
      if (result.kind === "already_verified") {
        res.json(200, { status: "already_verified" });
        return;
      }
      if (result.kind === "dns_not_found" || result.kind === "dns_mismatch") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: `DNS verification failed: ${result.kind}`,
        });
        return;
      }
      res.json(200, { status: "verified" });
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
  // GraphQL boundary (ADR-0013, ADR-ACT-0199). Authentication + tenant-FQDN are
  // enforced here (requiresAuth); per-operation UMA authz is enforced inside the
  // handler since one path serves both the read query and the write mutation.
  {
    method: "POST",
    path: "/api/graphql",
    operationName: "graphql",
    requiresAuth: true,
    handler: handleGraphql,
  },
  // Operator log search (ADR-0035, ADR-ACT-0194). Global-host, system-admin only.
  // Static RBAC (platform.logs.read) — no UMA resource: log search is a global
  // platform-admin capability with no per-tenant policy surface.
  {
    method: "GET",
    path: "/api/admin/logs/search",
    operationName: "admin.logs.search",
    requiresAuth: true,
    requiredPermission: "platform.logs.read",
    scope: "global",
    handler: handleSearchLogs,
  },
];
