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
import {
  AttachAuthCredentialRequestSchema,
  CredentialSecretRequestSchema,
  CreateIdpRequestSchema,
  UpdateIdpRequestSchema,
  CreateTenantDomainRequestSchema,
  CreateWebhookSubscriptionRequestSchema,
  UpdateWebhookSubscriptionRequestSchema,
  type TenantAuthProvidersConfig,
  type ObservabilitySignalStatus,
} from "@platform/contracts-admin";
import {
  getSessionStore,
  getApplicationPool,
  getKeycloakConfigForRealm,
  getProvisioningConfig,
  getLokiAdapter,
} from "./dependencies.ts";
import { S3ObjectStorageAdapter } from "@platform/adapters-object-storage";
import type {
  ObservabilityProbePort,
  ObservabilityInfraProbes,
} from "../usecases/tenant-observability.ts";
import { queryTenantSchema, withTenant } from "@platform/adapters-postgres";
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
  buildMfaAuditMetadata,
  buildSessionAuditMetadata,
  buildSysadminBrokeringAuditMetadata,
  type AuthSettingsMutationResult,
} from "../usecases/auth-settings.ts";
import {
  getAuthSettingsReadiness,
  attachAuthSettingsCredential,
  applyCredentialLifecycle,
  mapProbe,
  type AttachCredentialResult,
  type AuthReadinessStatus,
} from "../usecases/auth-settings-readiness.ts";
import { buildTenantReadiness } from "../usecases/capability-registry.ts";
import {
  toIdpSummary,
  buildCreateRepresentation,
  applyUpdate,
  buildIdpCreateAuditMetadata,
  buildIdpUpdateAuditMetadata,
  buildIdpDeleteAuditMetadata,
} from "../usecases/idp-management.ts";
import {
  importOidcDiscovery,
  testIdpConnection,
  buildIdpCallbackUrl,
} from "../usecases/oidc-discovery.ts";
import { readIdpMapping, applyIdpMapping } from "../usecases/idp-mapping.ts";
import { createOidcHttpFetcher } from "./oidc-http-fetcher.ts";
import {
  getEmailSenderSettings,
  getEmailSenderReadiness,
  updateEmailSenderSettings,
  testEmailSender,
  type EmailSenderFactory,
} from "../usecases/email-sender.ts";
import { PostgresEmailSenderSecretStore } from "../adapters/postgres-email-sender-store.ts";
import { SmtpEmailAdapter } from "../adapters/smtp-email-adapter.ts";
import { BrevoEmailAdapter } from "@platform/adapters-brevo";
import {
  createPostgresAuditEventPort,
  createAuditEvent,
  AuditAction,
} from "@platform/audit-events";
import { resolveTenantFromRequest, requestHostFromHeaders } from "./tenant-resolver.ts";
import { classifyHostIdentity } from "@platform/domain-identity";
import { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import { PostgresTenantCredentialStore } from "../adapters/postgres-tenant-credential-store.ts";
import { PostgresTenantDomainRegistry } from "../adapters/postgres-tenant-domain-registry.ts";
import { CaddyLocalRoutingProbe } from "../adapters/caddy-local-routing-probe.ts";
import {
  activateDomainAuthClient,
  deactivateDomainAuthClient,
  probeDomainLocalRouting,
  setCanonicalDomain,
  unsetCanonicalDomain,
  type AuthClientDomainPort,
} from "../usecases/tenant-domain-lifecycle.ts";
import { z } from "zod";

// ---------------------------------------------------------------------------
// AuthClientDomainPort over the existing vanity-domain Keycloak plumbing
// (ADR-ACT-0232): domain lifecycle operations run under tenant.domains.write;
// the Keycloak client mutation uses the tenant's auth-settings credential.
// ---------------------------------------------------------------------------
function buildAuthClientDomainPort(
  tenantCtx: { organisationId: string; realmName: string },
  cred: { clientId: string; clientSecret: string },
  actor: { userId: string; roles: string[] }
): AuthClientDomainPort {
  const adminConfig = {
    url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
    realm: tenantCtx.realmName,
    adminClientId: cred.clientId,
    adminClientSecret: cred.clientSecret,
  };
  const base = {
    organisationId: tenantCtx.organisationId,
    realmName: tenantCtx.realmName,
    actorId: actor.userId,
    actorRoles: actor.roles,
  };
  return {
    async addRedirectOrigin(domain: string): Promise<void> {
      const { addVanityDomain } = await import("../usecases/vanity-domain.ts");
      await addVanityDomain(
        { ...base, domain },
        { audit: createPostgresAuditEventPort(getApplicationPool()), adminConfig }
      );
    },
    async removeRedirectOrigin(domain: string): Promise<void> {
      const { removeVanityDomain } = await import("../usecases/vanity-domain.ts");
      await removeVanityDomain(
        { ...base, domain },
        { audit: createPostgresAuditEventPort(getApplicationPool()), adminConfig }
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Shared mapping of an Auth Settings mutation result to an HTTP response
// (ADR-0041). Returns true when it sent a failure response; false on "ok" so the
// caller emits its own success. Realm-failure codes mirror the readiness model so
// the SPA shows a precise reason. Secrets never appear in any message.
// ---------------------------------------------------------------------------
function sendAuthSettingsFailure(
  res: { json: (status: number, body: unknown) => void },
  result: AuthSettingsMutationResult
): boolean {
  switch (result.kind) {
    case "ok":
      return false;
    case "invalid_body":
      res.json(400, { code: "VALIDATION_ERROR", message: result.message });
      return true;
    case "no_tenant":
      res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      return true;
    case "no_credential":
      res.json(503, {
        code: "NO_CREDENTIAL",
        message: "Auth settings credential is not configured for this tenant",
      });
      return true;
    case "invalid_credential":
      res.json(502, {
        code: "INVALID_CREDENTIAL",
        message: "The auth settings credential was rejected by the realm",
      });
      return true;
    case "forbidden_realm_operation":
      res.json(403, {
        code: "FORBIDDEN_REALM_OPERATION",
        message: "The auth settings credential lacks realm-management permission",
      });
      return true;
    case "realm_unreachable":
      res.json(502, {
        code: "REALM_UNREACHABLE",
        message: "The identity realm could not be reached",
      });
      return true;
    case "conflict":
      res.json(409, {
        code: "CONFLICT",
        message: "An identity provider with this alias already exists",
      });
      return true;
    case "not_found":
      res.json(404, { code: "NOT_FOUND", message: "Identity provider not found" });
      return true;
  }
}

// Build a concrete EmailPort per provider (ADR-0047). `local` targets the Mailpit
// dev sink (env-overridable); `smtp` uses the tenant config + decrypted secret as
// the password; `brevo` needs an API key. Returns null when sending is impossible.
function createEmailSenderFactory(): EmailSenderFactory {
  return (provider, config, secret) => {
    if (provider === "local") {
      return new SmtpEmailAdapter({
        host: process.env["MAIL_SMTP_HOST"] ?? "localhost",
        port: Number(process.env["MAIL_SMTP_PORT"] ?? 1025),
        secure: false,
      });
    }
    if (provider === "smtp") {
      if (!config.smtpHost) return null;
      return new SmtpEmailAdapter({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: config.smtpSecure,
        ...(config.smtpUsername ? { user: config.smtpUsername, pass: secret ?? "" } : {}),
      });
    }
    if (provider === "brevo") {
      if (!secret) return null;
      return new BrevoEmailAdapter({
        apiKey: secret,
        defaultFromAddress: config.fromEmail,
        ...(config.fromName ? { defaultFromName: config.fromName } : {}),
      });
    }
    return null;
  };
}

// Build the tenant storage readiness deps (ADR-0049). `endpointConfigured` is honest:
// it is true only when an S3/MinIO endpoint + admin credentials are actually wired.
// When configured, `makeProbe` builds a tenant-prefix-locked adapter and an isolation
// assertion (a foreign cross-prefix key must be rejected by the adapter).
function buildStorageReadinessDeps(organisationId: string): {
  organisationId: string;
  endpointConfigured: boolean;
  makeProbe?: () => {
    prefix: string;
    port: S3ObjectStorageAdapter;
    assertIsolation: () => Promise<boolean>;
  };
} {
  const cfg = getProvisioningConfig();
  const endpointConfigured = !!(
    cfg.s3DefaultEndpoint &&
    cfg.s3AdminAccessKeyId &&
    cfg.s3AdminSecretAccessKey
  );
  if (!endpointConfigured) return { organisationId, endpointConfigured: false };
  const prefix = `${organisationId}/`;
  return {
    organisationId,
    endpointConfigured: true,
    makeProbe: () => {
      const port = new S3ObjectStorageAdapter({
        bucket: cfg.s3DefaultBucket,
        region: cfg.s3DefaultRegion,
        endpoint: cfg.s3DefaultEndpoint ?? undefined,
        forcePathStyle: true, // MinIO / S3-compat
        credentials: {
          accessKeyId: cfg.s3AdminAccessKeyId!,
          secretAccessKey: cfg.s3AdminSecretAccessKey!,
        },
        organisationId,
      });
      return {
        prefix,
        port,
        // A deliberately foreign cross-prefix key must be rejected by the adapter's
        // prefix guard (ADR-0029 §6) before any network call.
        assertIsolation: async () => {
          try {
            await port.get("isolation-check-foreign-tenant/probe");
            return false;
          } catch {
            return true;
          }
        },
      };
    },
  };
}

// Build a timeout-bounded observability probe port (ADR-0050). Each Loki query is
// raced against a hard timeout so a slow/unreachable backend cannot stall the
// readiness response; a timeout surfaces as `provider_unreachable`, never faked.
function buildObservabilityPort(timeoutMs = 2000): ObservabilityProbePort {
  const loki = getLokiAdapter();
  return {
    search: (query) =>
      Promise.race([
        loki.search(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("loki probe timeout")), timeoutMs)
        ),
      ]),
  };
}

// Honest reachability probes for the surrounding observability infra (ADR-ACT-0224).
// A bounded GET = reachable (any HTTP response); a network error = unreachable; an
// unset endpoint = not_configured; no local backend = not_applicable. No secret/DSN
// is returned — only signal statuses.
function buildObservabilityInfra(timeoutMs = 1500): ObservabilityInfraProbes {
  const reach = async (
    url: string | undefined,
    naWhenUnset = false
  ): Promise<ObservabilitySignalStatus> => {
    if (!url) return naWhenUnset ? "not_applicable" : "not_configured";
    try {
      await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      return "ok"; // any HTTP response means the endpoint is reachable
    } catch {
      return "unreachable";
    }
  };
  // Derive the local health URLs from the per-env ports already in .env.<env>
  // (GRAFANA_PORT / OTEL_HEALTH_PORT), overridable by an explicit *_URL.
  const port = (v: string | undefined): string | undefined =>
    v ? `http://localhost:${v}` : undefined;
  const grafanaUrl = process.env["GRAFANA_URL"] ?? port(process.env["GRAFANA_PORT"]);
  const otelUrl = process.env["OTEL_HEALTH_URL"] ?? port(process.env["OTEL_HEALTH_PORT"]);
  return {
    // No Prometheus/metrics backend locally → not_applicable unless PROMETHEUS_URL is set.
    probeMetrics: () => reach(process.env["PROMETHEUS_URL"], true),
    probeOtelCollector: () => reach(otelUrl),
    probeDashboards: () => reach(grafanaUrl ? `${grafanaUrl}/api/health` : undefined),
    probeErrorCapture: async () => {
      const dsn = process.env["SENTRY_DSN"];
      if (!dsn) return "not_configured";
      try {
        await fetch(new URL(dsn).origin, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
        return "ok";
      } catch {
        return "unreachable";
      }
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract the `:id` segment after `/api/org/webhooks/` from the request path (ADR-0051). */
function webhookIdFromPath(rawUrl: string | undefined): string | null {
  const segments = new URL(rawUrl ?? "", "http://localhost").pathname.split("/");
  const i = segments.indexOf("webhooks");
  const id = i >= 0 ? (segments[i + 1] ?? "") : "";
  return UUID_RE.test(id) ? id : null;
}

// Build the webhook usecase deps (store + audit). The dispatcher is added per-call.
async function buildWebhookDeps() {
  const { PostgresWebhookStore } = await import("../adapters/postgres-webhook-store.ts");
  return {
    store: new PostgresWebhookStore(getApplicationPool()),
    audit: createPostgresAuditEventPort(getApplicationPool()),
  };
}

// ---------------------------------------------------------------------------
// Shared mapping of a credential lifecycle result (attach/rotate/repair) to an
// HTTP response (ADR-0044). The secret never appears in any message.
// ---------------------------------------------------------------------------
function sendCredentialResult(
  res: { json: (status: number, body: unknown) => void },
  result: AttachCredentialResult
): void {
  switch (result.kind) {
    case "configured":
      res.json(204, null);
      return;
    case "invalid_body":
      res.json(400, { code: "VALIDATION_ERROR", message: result.message });
      return;
    case "invalid_credential":
      res.json(502, {
        code: "INVALID_CREDENTIAL",
        message: "The supplied credential was rejected by the realm",
      });
      return;
    case "forbidden_realm_operation":
      res.json(422, {
        code: "FORBIDDEN_REALM_OPERATION",
        message: "The supplied credential lacks realm-management permission",
      });
      return;
    case "realm_unreachable":
      res.json(502, {
        code: "REALM_UNREACHABLE",
        message: "The identity realm could not be reached",
      });
      return;
  }
}

// ---------------------------------------------------------------------------
// Auth Settings body schemas (ADR-0030 ?1b safety)
// Client-supplied bodies are validated; admin secrets/clientIds are stripped.
// Realm is always derived from the Host header ? never from the request body.
// ---------------------------------------------------------------------------

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
  // Host identity (ADR-ACT-0231/0232) ? unauthenticated, keyed by Host header.
  // Returns the host classification and, when the host resolves, the tenant
  // slug + how it resolved (slug subdomain vs active custom domain). Public
  // values only ? the slug is already visible in any tenant URL; no ids, no
  // secrets. Used by the local routing probe and the routing proof scripts to
  // verify END-TO-END that a host reaches the correct tenant context through
  // the reverse proxy.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/host-identity",
    operationName: "host.identity",
    handler: async (req, res) => {
      const host = requestHostFromHeaders(req.raw);
      const identity = classifyHostIdentity(host, process.env["APEX_DOMAIN"] ?? "aldous.info");
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(
        () => null
      );
      res.json(200, {
        kind: identity.kind,
        tenant: tenantCtx ? { slug: tenantCtx.slug, hostSource: tenantCtx.hostSource } : null,
      });
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
  // ADR-0043: redacted IdP list — explicit DTO mapping, never the raw Keycloak
  // representation (which carries config + the masked clientSecret).
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
      const raw = await adapter.listIdentityProviders();
      res.json(200, raw.map(toIdpSummary));
    },
  },
  // ADR-0043: create a realm IdP. clientSecret is write-only; audit records the
  // clientId + safe fields only. Duplicate alias → 409 via classifyRealmError.
  {
    method: "POST",
    path: "/api/auth/settings/idps",
    operationName: "auth.settings.idps.create",
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
          buildAuditMetadata: buildIdpCreateAuditMetadata,
          schema: CreateIdpRequestSchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).createIdentityProvider(buildCreateRepresentation(body)),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (sendAuthSettingsFailure(res, result)) return;
      res.json(201, null);
    },
  },
  // ADR-0043: update a realm IdP. A blank/absent clientSecret preserves the
  // existing secret (read-merge-write keeps Keycloak's secret mask). The merge
  // GET happens inside mutate so it uses the tenant credential; a missing alias
  // surfaces as 404 via classifyRealmError.
  {
    method: "PATCH",
    path: "/api/auth/settings/idps/:alias",
    operationName: "auth.settings.idps.update",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const alias = req.params["alias"] ?? "";
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsIdpChanged,
          buildAuditMetadata: (body) => buildIdpUpdateAuditMetadata(alias, body),
          schema: UpdateIdpRequestSchema,
          mutate: async (body, cred) => {
            const adapter = new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            });
            const existing = await adapter.getIdentityProvider(alias);
            if (!existing) {
              // Classified to 404 by sendAuthSettingsFailure (not_found).
              throw new Error(
                `updateIdentityProvider(${alias}): Keycloak admin request failed: 404`
              );
            }
            await adapter.updateIdentityProvider(alias, applyUpdate(existing, body));
          },
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (sendAuthSettingsFailure(res, result)) return;
      res.json(204, null);
    },
  },
  // ADR-0043: delete a realm IdP (audit-first; idempotent on the realm side).
  {
    method: "DELETE",
    path: "/api/auth/settings/idps/:alias",
    operationName: "auth.settings.idps.delete",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const alias = req.params["alias"] ?? "";
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: {},
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsIdpChanged,
          buildAuditMetadata: () => buildIdpDeleteAuditMetadata(alias),
          schema: z.object({}).strip(),
          mutate: (_body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).deleteIdentityProvider(alias),
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
        }
      );
      if (sendAuthSettingsFailure(res, result)) return;
      res.json(204, null);
    },
  },
  // ADR-0046: OIDC discovery import. BFF fetches the discovery document itself
  // (bounded timeout + size cap + HTTPS-only-outside-local) and returns only a
  // minimal redacted projection + a classified validation — never the raw doc.
  {
    method: "POST",
    path: "/api/auth/settings/idps/oidc/discover",
    operationName: "auth.settings.idps.oidc.discover",
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
      const result = await importOidcDiscovery(req.body, { fetcher: createOidcHttpFetcher() });
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      res.json(200, result.response);
    },
  },
  // ADR-0046: the brokered callback URL for an IdP alias — derived from the tenant
  // realm + alias (FQDN-resolved), never a secret. Read-only.
  {
    method: "GET",
    path: "/api/auth/settings/idps/:alias/callback-url",
    operationName: "auth.settings.idps.callbackUrl",
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
      const alias = req.params["alias"] ?? "";
      res.json(
        200,
        buildIdpCallbackUrl(
          getKeycloakConfigForRealm(tenantCtx.realmName).url,
          tenantCtx.realmName,
          alias
        )
      );
    },
  },
  // ADR-0046: non-interactive connection test — re-validate the stored issuer's
  // discovery + JWKS. Audit records alias + classified result only. NOT a login.
  {
    method: "POST",
    path: "/api/auth/settings/idps/:alias/test-connection",
    operationName: "auth.settings.idps.testConnection",
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
      const result = await testIdpConnection(
        {
          alias: req.params["alias"] ?? "",
          organisationId: tenantCtx.organisationId,
          realmName: tenantCtx.realmName,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          reader: adapter,
          fetcher: createOidcHttpFetcher(),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Identity provider not found" });
        return;
      }
      res.json(200, result.validation);
    },
  },
  // ADR-0046: read the managed claim/group-role mapping for an IdP.
  {
    method: "GET",
    path: "/api/auth/settings/idps/:alias/mapping",
    operationName: "auth.settings.idps.mapping.get",
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
      const result = await readIdpMapping(req.params["alias"] ?? "", { mapperPort: adapter });
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Identity provider not found" });
        return;
      }
      res.json(200, result.config);
    },
  },
  // ADR-0046: full-replace the managed claim/group-role mapping (audit-first).
  {
    method: "PATCH",
    path: "/api/auth/settings/idps/:alias/mapping",
    operationName: "auth.settings.idps.mapping.update",
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
      const result = await applyIdpMapping(
        {
          alias: req.params["alias"] ?? "",
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        { mapperPort: adapter, audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      if (sendAuthSettingsFailure(res, result)) return;
      if (result.kind === "ok") {
        res.json(200, result.config);
        return;
      }
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
      if (sendAuthSettingsFailure(res, result)) return;
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
      if (sendAuthSettingsFailure(res, result)) return;
      res.json(204, null);
    },
  },
  // ADR-0041: classify the tenant's auth-settings credential so the SPA knows
  // whether editing is possible (configured) or why not (missing/invalid/
  // forbidden/unreachable). Read permission — never exposes the credential.
  {
    method: "GET",
    path: "/api/auth/settings/readiness",
    operationName: "auth.settings.readiness.get",
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
      const result = await getAuthSettingsReadiness(
        { organisationId: tenantCtx.organisationId, realmName: tenantCtx.realmName },
        {
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
          makeProbe: (cred, realmName) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(realmName).url,
              realm: realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }),
        }
      );
      res.json(200, result);
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
  // ADR-0041: operator-seeded attach/rotate of a per-tenant auth-settings
  // credential, for tenants that predate automated provisioning. SEPARATE from
  // the tenant-admin mutation path: global scope, system-admin only. The secret
  // is validated against the realm before storage and is never returned, logged,
  // or audited (audit records the clientId only). The target tenant comes from
  // the body's organisationId (a global endpoint has no tenant FQDN); the realm
  // name is derived deterministically, never taken from the body.
  {
    method: "POST",
    path: "/api/admin/tenants/auth-settings-credential",
    operationName: "admin.tenants.authSettingsCredential.attach",
    requiresAuth: true,
    requiredPermission: "platform.tenants.create",
    resource: "admin:tenants",
    umaScope: "create" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = AttachAuthCredentialRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const { organisationId, clientId, clientSecret } = parsed.data;
      const realmName = `tenant-${organisationId}`;
      const result = await attachAuthSettingsCredential(
        {
          organisationId,
          realmName,
          clientId,
          clientSecret,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
          makeProbe: (cred, realm) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(realm).url,
              realm,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }),
        }
      );
      sendCredentialResult(res, result);
    },
  },
  // ADR-0044: credential lifecycle (rotate / repair / readiness) for a SPECIFIC
  // tenant. Global scope, system-admin only. The target tenant comes from the URL
  // path; the realm name is derived deterministically; the body carries ONLY the
  // write-only credential and can never confer tenant authority. Secret is never
  // returned, logged, or audited.
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/auth-settings-credential/readiness",
    operationName: "admin.tenants.authSettingsCredential.readiness",
    requiresAuth: true,
    requiredPermission: "platform.tenants.read",
    resource: "admin:tenants",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      const realmName = `tenant-${tenantId}`;
      const store = new PostgresTenantCredentialStore(getApplicationPool());
      const readiness = await getAuthSettingsReadiness(
        { organisationId: tenantId, realmName },
        {
          credentialStore: store,
          makeProbe: (cred, realm) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(realm).url,
              realm,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }),
        }
      );
      const metadata = await store.getAuthSettingsCredentialMetadata(tenantId);
      res.json(200, { status: readiness.status, metadata });
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/auth-settings-credential/rotate",
    operationName: "admin.tenants.authSettingsCredential.rotate",
    requiresAuth: true,
    requiredPermission: "platform.tenants.create",
    resource: "admin:tenants",
    umaScope: "create" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = CredentialSecretRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const tenantId = req.params["tenantId"] ?? "";
      const result = await applyCredentialLifecycle(
        "rotate",
        {
          organisationId: tenantId,
          realmName: `tenant-${tenantId}`,
          clientId: parsed.data.clientId,
          clientSecret: parsed.data.clientSecret,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
          makeProbe: (cred, realm) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(realm).url,
              realm,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }),
        }
      );
      sendCredentialResult(res, result);
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/auth-settings-credential/repair",
    operationName: "admin.tenants.authSettingsCredential.repair",
    requiresAuth: true,
    requiredPermission: "platform.tenants.create",
    resource: "admin:tenants",
    umaScope: "create" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = CredentialSecretRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const tenantId = req.params["tenantId"] ?? "";
      const result = await applyCredentialLifecycle(
        "repair",
        {
          organisationId: tenantId,
          realmName: `tenant-${tenantId}`,
          clientId: parsed.data.clientId,
          clientSecret: parsed.data.clientSecret,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          audit: createPostgresAuditEventPort(getApplicationPool()),
          credentialStore: new PostgresTenantCredentialStore(getApplicationPool()),
          makeProbe: (cred, realm) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(realm).url,
              realm,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }),
        }
      );
      sendCredentialResult(res, result);
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
      const domain = parsed.data.domain.toLowerCase();
      // ADR-ACT-0232 hardening: the documented lifecycle (migration 014) always
      // required a verified, unconsumed ownership challenge before the domain
      // is added to the auth client — but no caller ever enforced it. Enforce
      // it here so this legacy surface matches /api/org/domains/:domain/activate.
      const { checkDomainOwnership, consumeChallenge } =
        await import("../usecases/vanity-domain-challenge.ts");
      if (!(await checkDomainOwnership(domain, tenantCtx.organisationId, getApplicationPool()))) {
        res.json(422, {
          code: "OWNERSHIP_NOT_VERIFIED",
          message: "DNS ownership must be verified before activation",
        });
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
      // Lifecycle registry sync + challenge consumption (ADR-ACT-0232).
      await new PostgresTenantDomainRegistry(getApplicationPool()).markAuthClientActive(
        tenantCtx.organisationId,
        domain
      );
      await consumeChallenge(domain, tenantCtx.organisationId, getApplicationPool());
      res.json(201, { domain });
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
      // Lifecycle registry sync (ADR-ACT-0232): the auth client no longer
      // serves this domain — clears canonical and resets routing claims too.
      await new PostgresTenantDomainRegistry(getApplicationPool()).markAuthClientInactive(
        tenantCtx.organisationId,
        domain.toLowerCase()
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
  // Membership v2 (ADR-ACT-0206): tenant-scoped username, status (enable/disable),
  // resend invitation, and external-identity read. Username/status edits reuse the
  // tenant.members.update_role permission (member-attribute updates a tenant-admin
  // already holds — see ADR-0036); resend reuses invite; external-ids reuse read.
  // ---------------------------------------------------------------------------
  {
    method: "PATCH",
    path: "/api/org/members/:userId/username",
    operationName: "org.members.set_username",
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
      const { editMemberUsername } = await import("../usecases/members.ts");
      const result = await editMemberUsername(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          targetUserId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: serverT("api.error.organisationNotFound") });
        return;
      }
      if (result.kind === "conflict") {
        res.json(409, { code: "CONFLICT", message: "That username is already taken" });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "PATCH",
    path: "/api/org/members/:userId/status",
    operationName: "org.members.set_status",
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
      const { setMemberStatus } = await import("../usecases/members.ts");
      const result = await setMemberStatus(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          targetUserId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: serverT("api.error.organisationNotFound") });
        return;
      }
      if (result.kind === "invalid_transition") {
        res.json(422, { code: "VALIDATION_ERROR", message: "Invalid status transition" });
        return;
      }
      if (result.kind === "last_admin_cannot_be_disabled") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "Cannot disable the last tenant-admin",
        });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "POST",
    path: "/api/org/members/resend-invite",
    operationName: "org.members.resend_invite",
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
      const { resendInvite } = await import("../usecases/members.ts");
      const result = await resendInvite(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "No pending invitation for that email" });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "GET",
    path: "/api/org/members/:userId/external-identities",
    operationName: "org.members.external_identities",
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
      const targetUserId = req.params["userId"] ?? "";
      if (!targetUserId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "userId path parameter is required" });
        return;
      }
      const { listMemberExternalIdentities } = await import("../usecases/members.ts");
      const identities = await listMemberExternalIdentities(
        { organisationId: tenantCtx.organisationId, targetUserId },
        getApplicationPool()
      );
      res.json(200, { identities });
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
  // Platform Configuration Registry (ADR-0039). Generic typed config: effective
  // value = tenant override → default. Route gate is the coarse tenant.config.*;
  // the usecase additionally enforces each definition's requiredPermissionWrite.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/config",
    operationName: "org.config.list",
    requiresAuth: true,
    requiredPermission: "tenant.config.read",
    resource: "organisation:config",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const category =
        new URL(req.raw.url ?? "/", "http://localhost").searchParams.get("category") ?? undefined;
      const { listEffectiveTenantConfig } = await import("../usecases/platform-config.ts");
      const items = await listEffectiveTenantConfig(
        {
          organisationId: tenantCtx.organisationId,
          actorPermissions: req.actor!.permissions,
          category,
        },
        getApplicationPool()
      );
      res.json(200, { items });
    },
  },
  {
    method: "PATCH",
    path: "/api/org/config/:key",
    operationName: "org.config.set",
    requiresAuth: true,
    requiredPermission: "tenant.config.write",
    resource: "organisation:config",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const key = req.params["key"] ?? "";
      const { setTenantConfigValue } = await import("../usecases/platform-config.ts");
      const result = await setTenantConfigValue(
        {
          organisationId: tenantCtx.organisationId,
          key,
          rawBody: req.body,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          actorPermissions: req.actor!.permissions,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown configuration key" });
        return;
      }
      if (result.kind === "not_overridable") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "This setting is not tenant-overridable",
        });
        return;
      }
      if (result.kind === "forbidden") {
        res.json(403, { code: "FORBIDDEN", message: "Insufficient permission for this setting" });
        return;
      }
      // Fan out the config-change event to subscribed webhooks (ADR-0052). Best-effort:
      // a webhook enqueue failure must never break the config mutation.
      try {
        const { emitWebhookEvent } = await import("../usecases/webhook-worker.ts");
        const { PostgresWebhookStore } = await import("../adapters/postgres-webhook-store.ts");
        await emitWebhookEvent(
          tenantCtx.organisationId,
          "tenant.config.changed",
          { key },
          new PostgresWebhookStore(getApplicationPool())
        );
      } catch {
        /* best-effort event fan-out */
      }
      res.json(204, null);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/config/:key",
    operationName: "org.config.clear",
    requiresAuth: true,
    requiredPermission: "tenant.config.write",
    resource: "organisation:config",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const key = req.params["key"] ?? "";
      const { clearTenantConfigOverride } = await import("../usecases/platform-config.ts");
      const result = await clearTenantConfigOverride(
        {
          organisationId: tenantCtx.organisationId,
          key,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          actorPermissions: req.actor!.permissions,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()), pool: getApplicationPool() }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown configuration key" });
        return;
      }
      if (result.kind === "not_overridable") {
        res.json(422, {
          code: "VALIDATION_ERROR",
          message: "This setting is not tenant-overridable",
        });
        return;
      }
      if (result.kind === "forbidden") {
        res.json(403, { code: "FORBIDDEN", message: "Insufficient permission for this setting" });
        return;
      }
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Administrative audit trail (ADR-0040). Tenant-scoped contextual query over the
  // durable audit_events store. Coarse gate tenant.audit.read; the usecase enforces
  // the per-context read permission for the requested logical resource.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/audit",
    operationName: "org.audit.list",
    requiresAuth: true,
    requiredPermission: "tenant.audit.read",
    resource: "organisation:audit",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const q = new URL(req.raw.url ?? "/", "http://localhost").searchParams;
      const limitRaw = q.get("limit");
      const { listContextualAuditEvents } = await import("../usecases/audit.ts");
      const result = await listContextualAuditEvents(
        {
          organisationId: tenantCtx.organisationId,
          actorPermissions: req.actor!.permissions,
          resource: q.get("resource") ?? "",
          resourceId: q.get("resourceId") ?? undefined,
          action: q.get("action") ?? undefined,
          actorId: q.get("actorId") ?? undefined,
          from: q.get("from") ? new Date(q.get("from")!) : undefined,
          to: q.get("to") ? new Date(q.get("to")!) : undefined,
          limit: limitRaw ? Number(limitRaw) : undefined,
        },
        { audit: createPostgresAuditEventPort(getApplicationPool()) }
      );
      if (result.kind === "invalid") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      if (result.kind === "forbidden") {
        res.json(403, {
          code: "FORBIDDEN",
          message: "Insufficient permission for this audit context",
        });
        return;
      }
      res.json(200, { events: result.events });
    },
  },
  // ---------------------------------------------------------------------------
  // Enterprise control-plane capability map + tenant readiness (ADR-0045).
  // Tenant-scoped; tenant comes from the FQDN/session, never the body. Readiness
  // is computed from live signals (credential probe, active-admin count, IdP
  // count) + documented invariants — never faked.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/readiness",
    operationName: "org.readiness.get",
    requiresAuth: true,
    requiredPermission: "tenant.admin.access",
    resource: "organisation:readiness",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const pool = getApplicationPool();
      const store = new PostgresTenantCredentialStore(pool);

      // Signal 1+3: auth-settings credential readiness + IdP count (only when the
      // credential actually works — otherwise the realm cannot be listed).
      let authCredential: AuthReadinessStatus = "missing_credential";
      let idpCount: number | null = null;
      const cred = await store.getAuthSettingsCredential(tenantCtx.organisationId);
      if (cred) {
        const adapter = new KeycloakRealmAdminAdapter({
          url: getKeycloakConfigForRealm(tenantCtx.realmName).url,
          realm: tenantCtx.realmName,
          adminClientId: cred.clientId,
          adminClientSecret: cred.clientSecret,
        });
        try {
          const probe = await adapter.probeReadiness();
          authCredential = mapProbe(probe);
          if (probe === "ok") idpCount = (await adapter.listIdentityProviders()).length;
        } catch {
          authCredential = "realm_unreachable";
        }
      }

      // Signal 2: active tenant-admin count (RLS-scoped to this tenant).
      const activeAdminCount = await withTenant(pool, tenantCtx.organisationId, async (client) => {
        const result = await client.query<{ cnt: number }>(
          `SELECT count(*)::int AS cnt FROM memberships
            WHERE organisation_id = $1 AND role = 'tenant-admin' AND status = 'active'`,
          [tenantCtx.organisationId]
        );
        return result.rows[0]?.cnt ?? 0;
      });

      // Signal 4: email sender readiness (ADR-0047).
      const emailSender = (
        await getEmailSenderReadiness(tenantCtx.organisationId, {
          pool,
          secretStore: new PostgresEmailSenderSecretStore(pool),
        })
      ).status;

      // Signal 5: custom-domain readiness (ADR-0048).
      const { getTenantDomainReadiness } = await import("../usecases/tenant-domains.ts");
      const domainReadiness = (await getTenantDomainReadiness(tenantCtx.organisationId, pool))
        .status;

      // Signal 6: storage readiness (ADR-0049) — cheap configured-check only; the deep
      // write/read/delete probe lives on GET /api/org/storage/readiness to avoid S3 IO here.
      const storageReadiness = buildStorageReadinessDeps(tenantCtx.organisationId)
        .endpointConfigured
        ? "configured"
        : "not_configured";

      // Signal 7: observability readiness (ADR-0050) — bounded Loki probe (short timeout).
      const { getTenantObservabilityReadiness } =
        await import("../usecases/tenant-observability.ts");
      const observabilityReadiness = (
        await getTenantObservabilityReadiness({
          organisationId: tenantCtx.organisationId,
          port: buildObservabilityPort(1200),
        })
      ).status;

      // Signal 8: webhooks readiness (ADR-0051) — cheap subscription-count check.
      const { getWebhookReadiness } = await import("../usecases/webhooks.ts");
      const { store: webhookStore } = await buildWebhookDeps();
      const webhooksReadiness = (await getWebhookReadiness(tenantCtx.organisationId, webhookStore))
        .status;

      res.json(
        200,
        buildTenantReadiness({
          authCredential,
          activeAdminCount,
          idpCount,
          emailSender,
          domainReadiness,
          storageReadiness,
          observabilityReadiness,
          webhooksReadiness,
        })
      );
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant email sender configuration + readiness (ADR-0047 / ADR-ACT-0216).
  // Non-secret config in tenant_settings; the secret is write-only + encrypted.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/email-sender",
    operationName: "org.emailSender.get",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.read",
    resource: "admin:email",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const pool = getApplicationPool();
      const settings = await getEmailSenderSettings(tenantCtx.organisationId, {
        pool,
        secretStore: new PostgresEmailSenderSecretStore(pool),
      });
      res.json(200, settings);
    },
  },
  {
    method: "PATCH",
    path: "/api/org/email-sender",
    operationName: "org.emailSender.update",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.write",
    resource: "admin:email",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const pool = getApplicationPool();
      const result = await updateEmailSenderSettings(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          pool,
          secretStore: new PostgresEmailSenderSecretStore(pool),
          audit: createPostgresAuditEventPort(pool),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      res.json(200, result.settings);
    },
  },
  {
    method: "GET",
    path: "/api/org/email-sender/readiness",
    operationName: "org.emailSender.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.read",
    resource: "admin:email",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const pool = getApplicationPool();
      const result = await getEmailSenderReadiness(tenantCtx.organisationId, {
        pool,
        secretStore: new PostgresEmailSenderSecretStore(pool),
      });
      res.json(200, result);
    },
  },
  {
    method: "POST",
    path: "/api/org/email-sender/test",
    operationName: "org.emailSender.test",
    requiresAuth: true,
    requiredPermission: "tenant.email.settings.write",
    resource: "admin:email",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const pool = getApplicationPool();
      const result = await testEmailSender(
        {
          rawBody: req.body,
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        },
        {
          pool,
          secretStore: new PostgresEmailSenderSecretStore(pool),
          audit: createPostgresAuditEventPort(pool),
          makeSender: createEmailSenderFactory(),
        }
      );
      if (result.kind === "invalid_body") {
        res.json(400, { code: "VALIDATION_ERROR", message: result.message });
        return;
      }
      res.json(200, { result: result.result, messageId: result.messageId });
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant custom domains + DNS/TLS readiness (ADR-0048 / ADR-ACT-0217).
  // Dedicated read + readiness + lifecycle surface (permission tenant.domains.*)
  // that delegates to the existing vanity-domain plumbing: ADR-ACT-0188 ownership
  // challenge / DNS-TXT verify and ADR-ACT-0162 add/remove on the auth client.
  // Tenant authority is FQDN/session only; the verification token is a PUBLIC
  // DNS value, not a secret. Readiness is never faked.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/domains",
    operationName: "org.domains.list",
    requiresAuth: true,
    requiredPermission: "tenant.domains.read",
    resource: "admin:domains",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listTenantDomains } = await import("../usecases/tenant-domains.ts");
      const domains = await listTenantDomains(tenantCtx.organisationId, getApplicationPool());
      res.json(200, { domains });
    },
  },
  {
    method: "GET",
    path: "/api/org/domains/readiness",
    operationName: "org.domains.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.domains.read",
    resource: "admin:domains",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getTenantDomainReadiness } = await import("../usecases/tenant-domains.ts");
      const readiness = await getTenantDomainReadiness(
        tenantCtx.organisationId,
        getApplicationPool()
      );
      res.json(200, readiness);
    },
  },
  {
    method: "POST",
    path: "/api/org/domains",
    operationName: "org.domains.create",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = CreateTenantDomainRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid domain",
        });
        return;
      }
      const { createDomainChallenge } = await import("../usecases/vanity-domain-challenge.ts");
      const result = await createDomainChallenge(
        {
          domain: parsed.data.domain,
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
      res.json(201, {
        domain: parsed.data.domain,
        status: "pending_dns",
        txtRecord: result.txtRecord,
        token: result.token,
      });
    },
  },
  {
    method: "POST",
    path: "/api/org/domains/:domain/verify",
    operationName: "org.domains.verify",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const domain = decodeURIComponent(
        url.pathname.split("/").slice(-2, -1)[0] ?? ""
      ).toLowerCase();
      const txtRecord = `_aldous-verify.${domain}`;
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
      const status =
        result.kind === "ok" || result.kind === "already_verified"
          ? "verified"
          : result.kind === "dns_mismatch"
            ? "dns_mismatch"
            : "pending_dns"; // dns_not_found — keep waiting on DNS propagation
      res.json(200, { domain, status, txtRecord, token: null });
    },
  },
  {
    method: "DELETE",
    path: "/api/org/domains/:domain",
    operationName: "org.domains.remove",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const domain = decodeURIComponent(url.pathname.split("/").pop() ?? "").toLowerCase();
      if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid domain format" });
        return;
      }
      // ADR-ACT-0232: only an auth-client-ACTIVE domain needs the Keycloak
      // mutation (and therefore the tenant credential). An inactive domain is
      // a registry-only delete — credential not required.
      const registry = new PostgresTenantDomainRegistry(getApplicationPool());
      const record = await registry.getDomain(tenantCtx.organisationId, domain);
      if (record?.authClientStatus === "active") {
        const cred = await new PostgresTenantCredentialStore(
          getApplicationPool()
        ).getAuthSettingsCredential(tenantCtx.organisationId);
        if (!cred) {
          res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
          return;
        }
        const result = await deactivateDomainAuthClient(
          {
            organisationId: tenantCtx.organisationId,
            domain,
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
          },
          {
            registry,
            audit: createPostgresAuditEventPort(getApplicationPool()),
            authClient: buildAuthClientDomainPort(tenantCtx, cred, req.actor!),
          }
        );
        if (result.kind === "not_found") {
          res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
          return;
        }
      }
      await registry.disable(tenantCtx.organisationId, domain);
      res.json(204, null);
    },
  },
  // ---------------------------------------------------------------------------
  // Domain lifecycle (ADR-ACT-0232): auth-client activation, local routing
  // probe, and canonical management — all under tenant.domains.write. Tenant
  // authority is FQDN/session only. routing_local_active is only ever written
  // from a LIVE local probe (no fake readiness); canonical NEVER changes
  // redirect behaviour (redirect_policy stays no_redirect).
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/org/domains/:domain/activate",
    operationName: "org.domains.activate",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const domain = decodeURIComponent(req.params["domain"] ?? "").toLowerCase();
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const result = await activateDomainAuthClient(
        {
          organisationId: tenantCtx.organisationId,
          domain,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          registry: new PostgresTenantDomainRegistry(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          authClient: buildAuthClientDomainPort(tenantCtx, cred, req.actor!),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
        return;
      }
      if (result.kind === "not_verified") {
        res.json(422, {
          code: "OWNERSHIP_NOT_VERIFIED",
          message: "DNS ownership must be verified before activation",
        });
        return;
      }
      if (result.kind === "already_active") {
        res.json(409, { code: "CONFLICT", message: "Domain is already active" });
        return;
      }
      // Consume the ownership challenge — the verified challenge has now been
      // applied to the auth client (the original meaning of consumed_at).
      const { consumeChallenge } = await import("../usecases/vanity-domain-challenge.ts");
      await consumeChallenge(domain, tenantCtx.organisationId, getApplicationPool());
      res.json(200, {
        domain,
        authClient: result.record.authClientStatus,
        authClientActivatedAt: result.record.authClientActivatedAt?.toISOString() ?? null,
      });
    },
  },
  {
    method: "POST",
    path: "/api/org/domains/:domain/deactivate",
    operationName: "org.domains.deactivate",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const domain = decodeURIComponent(req.params["domain"] ?? "").toLowerCase();
      const cred = await new PostgresTenantCredentialStore(
        getApplicationPool()
      ).getAuthSettingsCredential(tenantCtx.organisationId);
      if (!cred) {
        res.json(503, { code: "NO_CREDENTIAL", message: serverT("api.error.notImplemented") });
        return;
      }
      const result = await deactivateDomainAuthClient(
        {
          organisationId: tenantCtx.organisationId,
          domain,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          registry: new PostgresTenantDomainRegistry(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          authClient: buildAuthClientDomainPort(tenantCtx, cred, req.actor!),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
        return;
      }
      if (result.kind === "not_active") {
        res.json(409, { code: "CONFLICT", message: "Domain is not active" });
        return;
      }
      res.json(200, { domain, authClient: "inactive", authClientActivatedAt: null });
    },
  },
  {
    method: "POST",
    path: "/api/org/domains/:domain/probe-routing-local",
    operationName: "org.domains.probeRoutingLocal",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const domain = decodeURIComponent(req.params["domain"] ?? "").toLowerCase();
      const outcome = await probeDomainLocalRouting(
        {
          organisationId: tenantCtx.organisationId,
          domain,
          expectedSlug: tenantCtx.slug,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          registry: new PostgresTenantDomainRegistry(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          probe: new CaddyLocalRoutingProbe(),
        }
      );
      if ("kind" in outcome) {
        res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
        return;
      }
      res.json(200, {
        domain,
        reachable: outcome.reachable,
        tenantContextMatched: outcome.tenantContextMatched,
        routing: outcome.record?.routingStatus ?? outcome.routing,
        routingLocalProvenAt: outcome.record?.routingLocalProvenAt?.toISOString() ?? null,
      });
    },
  },
  {
    method: "POST",
    path: "/api/org/domains/:domain/canonical",
    operationName: "org.domains.canonical.set",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const domain = decodeURIComponent(req.params["domain"] ?? "").toLowerCase();
      const result = await setCanonicalDomain(
        {
          organisationId: tenantCtx.organisationId,
          domain,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          registry: new PostgresTenantDomainRegistry(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
        return;
      }
      if (result.kind !== "ok") {
        res.json(422, {
          code: "CANONICAL_GUARD_FAILED",
          message: `Canonical requires verified ownership, an active auth client, and proven routing (${result.kind})`,
        });
        return;
      }
      res.json(200, {
        domain,
        canonical: result.record.canonical,
        canonicalAt: result.record.canonicalAt?.toISOString() ?? null,
        redirectPolicy: result.record.redirectPolicy,
      });
    },
  },
  {
    method: "DELETE",
    path: "/api/org/domains/:domain/canonical",
    operationName: "org.domains.canonical.unset",
    requiresAuth: true,
    requiredPermission: "tenant.domains.write",
    resource: "admin:domains",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const domain = decodeURIComponent(req.params["domain"] ?? "").toLowerCase();
      const result = await unsetCanonicalDomain(
        {
          organisationId: tenantCtx.organisationId,
          domain,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        {
          registry: new PostgresTenantDomainRegistry(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown domain" });
        return;
      }
      res.json(200, {
        domain,
        canonical: result.record.canonical,
        canonicalAt: null,
        redirectPolicy: result.record.redirectPolicy,
      });
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant storage readiness + isolation proof (ADR-0049 / ADR-ACT-0218).
  // Read + operator-triggered live probe over the existing ObjectStoragePort +
  // prefix-per-tenant S3/MinIO adapter (ADR-0029 §6 / ADR-0031). No credential is
  // ever returned; readiness is `not_configured` until S3 is wired, and only
  // `configured` after a real write/read/delete round-trip + foreign-key rejection.
  // Tenant authority + key prefix derive from FQDN/session.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/storage/readiness",
    operationName: "org.storage.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.storage.read",
    resource: "admin:storage",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getTenantStorageReadiness } = await import("../usecases/tenant-storage.ts");
      const readiness = await getTenantStorageReadiness(
        buildStorageReadinessDeps(tenantCtx.organisationId)
      );
      res.json(200, readiness);
    },
  },
  {
    method: "POST",
    path: "/api/org/storage/probe",
    operationName: "org.storage.probe",
    requiresAuth: true,
    requiredPermission: "tenant.storage.write",
    resource: "admin:storage",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const deps = buildStorageReadinessDeps(tenantCtx.organisationId);
      // Audit-first: record the probe intent (no credential, no object payload).
      await createPostgresAuditEventPort(getApplicationPool()).emit(
        createAuditEvent({
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          tenantId: tenantCtx.organisationId,
          action: AuditAction.StorageProbed,
          resource: "storage",
          resourceId: "probe",
          metadata: { operation: "probe", endpointConfigured: deps.endpointConfigured },
        })
      );
      const { probeTenantStorage } = await import("../usecases/tenant-storage.ts");
      if (!deps.endpointConfigured || !deps.makeProbe) {
        res.json(200, {
          status: "not_configured",
          wrote: false,
          read: false,
          deleted: false,
          foreignKeyRejected: true,
        });
        return;
      }
      const result = await probeTenantStorage(deps.makeProbe());
      res.json(200, result);
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant observability readiness (ADR-0050 / ADR-ACT-0219).
  // Read-only: a bounded, tenant-scoped Loki log query is the live check, plus a
  // structural high-cardinality-label guard. No log line/label value is returned.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/observability/readiness",
    operationName: "org.observability.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getTenantObservabilityReadiness } =
        await import("../usecases/tenant-observability.ts");
      const readiness = await getTenantObservabilityReadiness({
        organisationId: tenantCtx.organisationId,
        port: buildObservabilityPort(),
        infra: buildObservabilityInfra(),
      });
      res.json(200, readiness);
    },
  },
  // ---------------------------------------------------------------------------
  // Integrations / outbound webhooks (ADR-0051 / ADR-ACT-0221).
  // Tenant-scoped subscriptions + delivery log. The signing secret is reveal-once
  // (create + rotate) and otherwise write-only; payloads are HMAC-SHA-256 signed with
  // a replay timestamp. Tenant authority is FQDN/session; the body has no tenant id.
  // The async retry worker is deferred — a test is a single immediate attempt logged.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/webhooks",
    operationName: "org.webhooks.list",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.read",
    resource: "admin:webhooks",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listWebhooks } = await import("../usecases/webhooks.ts");
      const { store } = await buildWebhookDeps();
      res.json(200, { subscriptions: await listWebhooks(tenantCtx.organisationId, store) });
    },
  },
  {
    method: "GET",
    path: "/api/org/webhooks/readiness",
    operationName: "org.webhooks.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.read",
    resource: "admin:webhooks",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getWebhookReadiness } = await import("../usecases/webhooks.ts");
      const { store } = await buildWebhookDeps();
      res.json(200, await getWebhookReadiness(tenantCtx.organisationId, store));
    },
  },
  {
    method: "POST",
    path: "/api/org/webhooks",
    operationName: "org.webhooks.create",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = CreateWebhookSubscriptionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid webhook",
        });
        return;
      }
      const { createWebhook } = await import("../usecases/webhooks.ts");
      const result = await createWebhook(
        {
          organisationId: tenantCtx.organisationId,
          data: parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      res.json(201, result);
    },
  },
  {
    method: "PATCH",
    path: "/api/org/webhooks/:id",
    operationName: "org.webhooks.update",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const parsed = UpdateWebhookSubscriptionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid webhook",
        });
        return;
      }
      const { updateWebhook } = await import("../usecases/webhooks.ts");
      const result = await updateWebhook(
        {
          organisationId: tenantCtx.organisationId,
          id,
          data: parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, result.subscription);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/webhooks/:id",
    operationName: "org.webhooks.delete",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { deleteWebhook } = await import("../usecases/webhooks.ts");
      const result = await deleteWebhook(
        {
          organisationId: tenantCtx.organisationId,
          id,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(204, null);
    },
  },
  {
    method: "POST",
    path: "/api/org/webhooks/:id/rotate-secret",
    operationName: "org.webhooks.rotateSecret",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { rotateWebhookSecret } = await import("../usecases/webhooks.ts");
      const result = await rotateWebhookSecret(
        {
          organisationId: tenantCtx.organisationId,
          id,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, { id, secret: result.secret });
    },
  },
  {
    method: "POST",
    path: "/api/org/webhooks/:id/test",
    operationName: "org.webhooks.test",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { testWebhook } = await import("../usecases/webhooks.ts");
      const { HttpWebhookDispatcher } = await import("../adapters/http-webhook-dispatcher.ts");
      const result = await testWebhook(
        {
          organisationId: tenantCtx.organisationId,
          id,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        { ...(await buildWebhookDeps()), dispatch: new HttpWebhookDispatcher() }
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, result.result);
    },
  },
  {
    method: "GET",
    path: "/api/org/webhooks/:id/deliveries",
    operationName: "org.webhooks.deliveries",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.read",
    resource: "admin:webhooks",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { listWebhookDeliveries } = await import("../usecases/webhooks.ts");
      const { store } = await buildWebhookDeps();
      const result = await listWebhookDeliveries(tenantCtx.organisationId, id, store);
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, { deliveries: result.deliveries });
    },
  },
  {
    method: "GET",
    path: "/api/org/webhooks/:id/metrics",
    operationName: "org.webhooks.metrics",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.read",
    resource: "admin:webhooks",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { getSubscriptionMetrics } = await import("../usecases/webhooks.ts");
      const { store } = await buildWebhookDeps();
      const metrics = await getSubscriptionMetrics(tenantCtx.organisationId, id, store);
      if (!metrics) {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, metrics);
    },
  },
  {
    method: "POST",
    path: "/api/org/webhooks/:id/deliveries/:deliveryId/redrive",
    operationName: "org.webhooks.redrive",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const segments = new URL(req.raw.url ?? "", "http://localhost").pathname.split("/");
      const id = segments[segments.indexOf("webhooks") + 1] ?? "";
      const deliveryId = segments[segments.indexOf("deliveries") + 1] ?? "";
      if (!UUID_RE.test(id) || !UUID_RE.test(deliveryId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid id" });
        return;
      }
      const { redriveDeadDeliveries } = await import("../usecases/webhooks.ts");
      const result = await redriveDeadDeliveries(
        {
          organisationId: tenantCtx.organisationId,
          subscriptionId: id,
          deliveryId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, { redriven: result.redriven });
    },
  },
  {
    method: "POST",
    path: "/api/org/webhooks/:id/redrive-dead",
    operationName: "org.webhooks.redriveDead",
    requiresAuth: true,
    requiredPermission: "tenant.webhooks.write",
    resource: "admin:webhooks",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const id = webhookIdFromPath(req.raw.url);
      if (!id) {
        res.json(400, { code: "VALIDATION_ERROR", message: "invalid webhook id" });
        return;
      }
      const { redriveDeadDeliveries } = await import("../usecases/webhooks.ts");
      const result = await redriveDeadDeliveries(
        {
          organisationId: tenantCtx.organisationId,
          subscriptionId: id,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildWebhookDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Webhook not found" });
        return;
      }
      res.json(200, { redriven: result.redriven });
    },
  },
  // ---------------------------------------------------------------------------
  // Platform operations cockpit — service readiness + workers (ADR-ACT-0228).
  // Read-only, tenant-scoped (FQDN/session), tenant.platform.read. Bounded health
  // probes over a safe local-service allowlist; never returns secrets/DSNs/raw env.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/platform/services/readiness",
    operationName: "org.platform.services.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.platform.read",
    resource: "admin:platform",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { buildPlatformServicesReadiness } = await import("../usecases/platform-services.ts");
      const { getWorkerHeartbeat } = await import("./worker-registry.ts");
      const pool = getApplicationPool();
      const readiness = await buildPlatformServicesReadiness({
        httpProbe: async (url) => {
          try {
            await fetch(url, { method: "GET", signal: AbortSignal.timeout(1500) });
            return true; // any HTTP response = reachable
          } catch {
            return false;
          }
        },
        pgProbe: async () => {
          try {
            await pool.query("SELECT 1");
            return true;
          } catch {
            return false;
          }
        },
        redisConfigured: () => !!process.env["REDIS_URL"],
        getHeartbeat: getWorkerHeartbeat,
      });
      res.json(200, readiness);
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
