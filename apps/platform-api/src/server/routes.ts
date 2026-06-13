import { ConflictError, ForbiddenError, ValidationError } from "@platform/platform-errors";
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
  SetEntitlementRequestSchema,
  RecordMeterEventRequestSchema,
  SetQuotaRequestSchema,
  CreateApiKeyRequestSchema,
  SetRateLimitRequestSchema,
  SearchRequestSchema,
  ReindexRequestSchema,
  UpdateProfileRequestSchema,
  UpdateNotificationPreferencesRequestSchema,
  TestNotificationRequestSchema,
  CreateAlertRuleRequestSchema,
  UpdateIncidentRequestSchema,
  CreateScheduledJobRequestSchema,
  UpdateScheduledJobRequestSchema,
  PutSecretRequestSchema,
  SecretRefActionRequestSchema,
  PutProviderConfigRequestSchema,
  SetProviderLifecycleRequestSchema,
  type TenantAuthProvidersConfig,
  type ObservabilitySignalStatus,
} from "@platform/contracts-admin";
import {
  getSessionStore,
  getApplicationPool,
  getKeycloakConfigForRealm,
  getProvisioningConfig,
  getLokiAdapter,
  getRedisClient,
  connectRedis,
} from "./dependencies.ts";
import { createLogger } from "@platform/platform-logging";
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

// Build the entitlement usecase deps (repository + audit) — ADR-ACT-0254.
async function buildEntitlementDeps() {
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  return {
    repository: new PostgresEntitlementRepository(getApplicationPool()),
    audit: createPostgresAuditEventPort(getApplicationPool()),
  };
}

// Build the metering usecase deps (metering repo + entitlement repo) — ADR-ACT-0256.
async function buildMeteringDeps() {
  const { PostgresMeteringRepository } =
    await import("../adapters/postgres-metering-repository.ts");
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  const pool = getApplicationPool();
  return {
    metering: new PostgresMeteringRepository(pool),
    entitlements: new PostgresEntitlementRepository(pool),
  };
}

// Build the quota usecase deps (quota + metering + entitlement repos + audit) — ADR-ACT-0256.
async function buildQuotaDeps() {
  const { PostgresQuotaRepository } = await import("../adapters/postgres-quota-repository.ts");
  const { PostgresMeteringRepository } =
    await import("../adapters/postgres-metering-repository.ts");
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  const pool = getApplicationPool();
  return {
    quota: new PostgresQuotaRepository(pool),
    metering: new PostgresMeteringRepository(pool),
    entitlements: new PostgresEntitlementRepository(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Build the API-keys usecase deps (api-key repo + entitlement repo + audit) — ADR-ACT-0257.
async function buildApiKeysDeps() {
  const { PostgresApiKeyRepository } = await import("../adapters/postgres-api-key-repository.ts");
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  const pool = getApplicationPool();
  return {
    apiKeys: new PostgresApiKeyRepository(pool),
    entitlements: new PostgresEntitlementRepository(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

const rateLimitProviderLog = createLogger({ name: "rate-limit-provider" });
const secretStoreProviderLog = createLogger({ name: "secret-store-provider" });
const notificationProviderLog = createLogger({ name: "notification-transport" });

// Select the rate-limit repository provider (ADR-0065 / ADR-ACT-0263 — Phase 3.5).
// Postgres is the durable default and store of record for policy definitions.
// RATE_LIMIT_PROVIDER=redis enables the high-throughput Redis counter provider,
// which delegates policy CRUD back to Postgres and keeps Postgres as the honest
// counter fallback when Redis is unreachable (degraded, never faked).
async function selectRateLimitRepository(
  pool: ReturnType<typeof getApplicationPool>
): Promise<import("../ports/rate-limit-repository.ts").RateLimitRepository> {
  const { PostgresRateLimitRepository } =
    await import("../adapters/postgres-rate-limit-repository.ts");
  const durable = new PostgresRateLimitRepository(pool);
  if ((process.env["RATE_LIMIT_PROVIDER"] ?? "postgres").toLowerCase() !== "redis") {
    return durable;
  }
  const { RedisRateLimitRepository } = await import("../adapters/redis-rate-limit-repository.ts");
  await connectRedis();
  return new RedisRateLimitRepository(getRedisClient(), durable, {
    warn: (message, meta) => rateLimitProviderLog.warn(meta, message),
  });
}

// Build the rate-limit usecase deps (rate-limit repo + entitlement repo + audit) — ADR-ACT-0257.
async function buildRateLimitDeps() {
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  const pool = getApplicationPool();
  return {
    rateLimits: await selectRateLimitRepository(pool),
    entitlements: new PostgresEntitlementRepository(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Select the active secret store (ADR-0069 / ADR-ACT-0265). Built-in Postgres is the
// durable default; the composed OpenBao provider is chosen only when
// SECRET_STORE_PROVIDER=openbao AND OPENBAO_ADDR/OPENBAO_TOKEN are wired. A container
// is not a capability — OpenBao is delivered only when proof:secrets-openbao proves a
// live round-trip; otherwise this falls back to the built-in store with a warning.
async function selectSecretStore(
  pool: ReturnType<typeof getApplicationPool>
): Promise<import("../ports/secret-store.ts").SecretStore> {
  const { PostgresSecretStore } = await import("../adapters/postgres-secret-store.ts");
  const builtin = new PostgresSecretStore(pool);
  if ((process.env["SECRET_STORE_PROVIDER"] ?? "builtin").toLowerCase() !== "openbao") {
    return builtin;
  }
  const address = process.env["OPENBAO_ADDR"];
  const token = process.env["OPENBAO_TOKEN"];
  if (!address || !token) {
    secretStoreProviderLog.warn(
      { provider: "openbao" },
      "SECRET_STORE_PROVIDER=openbao but OPENBAO_ADDR/OPENBAO_TOKEN unset; using built-in store"
    );
    return builtin;
  }
  const { OpenBaoSecretStore } = await import("../adapters/openbao-secret-store.ts");
  return new OpenBaoSecretStore(pool, {
    address,
    token,
    mount: process.env["OPENBAO_KV_MOUNT"] ?? "secret",
    kvBasePath: process.env["OPENBAO_KV_BASE_PATH"] ?? "platform",
    warn: (message, meta) => secretStoreProviderLog.warn(meta, message),
  });
}

// Build the secrets usecase deps (secret store + audit) — ADR-ACT-0265.
async function buildSecretsDeps() {
  const pool = getApplicationPool();
  return { store: await selectSecretStore(pool), audit: createPostgresAuditEventPort(pool) };
}

// Build the history usecase deps (read-only history projection) — ADR-ACT-0272.
async function buildHistoryDeps() {
  const { PostgresHistoryRepository } = await import("../adapters/postgres-history-repository.ts");
  return { history: new PostgresHistoryRepository(getApplicationPool()) };
}

// Parse history list query params (limit/offset/sources) from a request URL.
function parseHistoryQuery(rawUrl: string): {
  limit: number;
  offset: number;
  sources: import("@platform/contracts-admin").HistorySourceType[] | undefined;
} {
  const sp = new URL(rawUrl, "http://localhost").searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const known = ["audit", "event", "notification", "incident", "meter"] as const;
  const raw = (sp.get("sources") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sources = raw.filter((s): s is (typeof known)[number] =>
    (known as readonly string[]).includes(s)
  );
  return { limit, offset, sources: sources.length ? sources : undefined };
}

// Build the provider-config usecase deps (provider-config repo + audit) — ADR-ACT-0266.
async function buildProviderConfigDeps() {
  const { PostgresProviderConfigRepository } =
    await import("../adapters/postgres-provider-config-repository.ts");
  const pool = getApplicationPool();
  return {
    providers: new PostgresProviderConfigRepository(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Build the scheduled-jobs usecase deps (scheduled-job repo + event bus + audit) — ADR-ACT-0262.
async function buildScheduledJobsDeps() {
  const { PostgresScheduledJobRepository } =
    await import("../adapters/postgres-scheduled-job-repository.ts");
  const { PostgresEventBus } = await import("../adapters/postgres-event-bus.ts");
  const pool = getApplicationPool();
  return {
    jobs: new PostgresScheduledJobRepository(pool),
    bus: new PostgresEventBus(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Build the observability usecase deps (metric/alert/incident repo + audit +
// the Phase-6 notification substrate for the alert→notification bridge) — ADR-ACT-0261.
async function buildObservabilityDeps() {
  const { PostgresObservabilityRepository } =
    await import("../adapters/postgres-observability-repository.ts");
  const { PostgresNotificationRepository } =
    await import("../adapters/postgres-notification-repository.ts");
  const pool = getApplicationPool();
  const repo = new PostgresObservabilityRepository(pool);
  const audit = createPostgresAuditEventPort(pool);
  return {
    metrics: repo,
    alerts: repo,
    incidents: repo,
    audit,
    notifications: { notifications: new PostgresNotificationRepository(pool), audit },
  };
}

// Build the profile usecase deps (profile repo + audit) — ADR-ACT-0260.
async function buildProfileDeps() {
  const { PostgresProfileRepository } = await import("../adapters/postgres-profile-repository.ts");
  const pool = getApplicationPool();
  return {
    profiles: new PostgresProfileRepository(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Build the notifications usecase deps (notification repo + audit + real transports) —
// ADR-ACT-0260 / ADR-ACT-0273. Real transports are opt-in (NOTIFICATION_EMAIL_TRANSPORT=smtp,
// NOTIFICATION_WEBHOOK_TRANSPORT=on); otherwise the built-in local sink is used (default).
async function buildNotificationsDeps() {
  const { PostgresNotificationRepository } =
    await import("../adapters/postgres-notification-repository.ts");
  const pool = getApplicationPool();
  return {
    notifications: new PostgresNotificationRepository(pool),
    audit: createPostgresAuditEventPort(pool),
    transports: await selectNotificationTransports(),
  };
}

// Select real notification transports from env (email → SMTP/Mailpit; webhook → signed
// POST, ADR-0052 signer). Returns undefined (local sink) when none are enabled.
async function selectNotificationTransports() {
  const emailOn = (process.env["NOTIFICATION_EMAIL_TRANSPORT"] ?? "").toLowerCase() === "smtp";
  const webhookOn = (process.env["NOTIFICATION_WEBHOOK_TRANSPORT"] ?? "").toLowerCase() === "on";
  if (!emailOn && !webhookOn) return undefined;
  const { ConfiguredNotificationRecipientResolver, createEmailTransport, createWebhookTransport } =
    await import("../adapters/notification-transports.ts");
  const resolver = new ConfiguredNotificationRecipientResolver({
    emailDomain: process.env["NOTIFICATION_EMAIL_DOMAIN"] ?? "mailpit.local",
    emailOverride: process.env["NOTIFICATION_EMAIL_OVERRIDE"],
    webhookUrl: process.env["NOTIFICATION_WEBHOOK_URL"],
  });
  const registry: import("../ports/notification-repository.ts").NotificationTransportRegistry = {};
  if (emailOn) {
    const { SmtpEmailAdapter } = await import("../adapters/smtp-email-adapter.ts");
    const email = new SmtpEmailAdapter({
      host: process.env["SMTP_HOST"] ?? "localhost",
      port: Number(process.env["MAILPIT_SMTP_PORT"] ?? 1025),
      secure: false,
    });
    registry.email = createEmailTransport({
      resolver,
      email,
      from: {
        address: process.env["NOTIFICATION_FROM_EMAIL"] ?? "notifications@platform.local",
      },
      warn: (m, meta) => notificationProviderLog.warn(meta, m),
    });
  }
  if (webhookOn) {
    const { HttpWebhookDispatcher } = await import("../adapters/http-webhook-dispatcher.ts");
    registry.webhook = createWebhookTransport({
      resolver,
      dispatch: new HttpWebhookDispatcher(),
      secret: process.env["NOTIFICATION_WEBHOOK_SECRET"],
      warn: (m, meta) => notificationProviderLog.warn(meta, m),
    });
  }
  return registry;
}

// Build the events usecase deps (event bus + worker registry + audit) — ADR-ACT-0259.
async function buildEventsDeps() {
  const { PostgresEventBus, PostgresWorkerRegistry } =
    await import("../adapters/postgres-event-bus.ts");
  const pool = getApplicationPool();
  return {
    bus: new PostgresEventBus(pool),
    workers: new PostgresWorkerRegistry(pool),
    audit: createPostgresAuditEventPort(pool),
  };
}

// Build the search usecase deps (search index + query repo + audit) — ADR-ACT-0258.
async function buildSearchDeps() {
  const { PostgresSearchRepository } = await import("../adapters/postgres-search-repository.ts");
  const pool = getApplicationPool();
  const repo = new PostgresSearchRepository(pool);
  return { index: repo, query: repo, audit: createPostgresAuditEventPort(pool) };
}

// Build the developer-portal foundation deps (api-key + rate-limit + entitlement repos).
async function buildDeveloperPortalDeps() {
  const { PostgresApiKeyRepository } = await import("../adapters/postgres-api-key-repository.ts");
  const { PostgresEntitlementRepository } =
    await import("../adapters/postgres-entitlement-repository.ts");
  const pool = getApplicationPool();
  return {
    apiKeys: new PostgresApiKeyRepository(pool),
    rateLimits: await selectRateLimitRepository(pool),
    entitlements: new PostgresEntitlementRepository(pool),
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
      if (result.kind === "domain_already_claimed") {
        // Explicit cross-tenant conflict (ADR-ACT-0236) — no token, no TXT record.
        res.json(409, {
          code: "DOMAIN_ALREADY_CLAIMED",
          message: "This domain is already claimed by another organisation",
        });
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
      if (result.kind === "domain_already_claimed") {
        res.json(409, {
          code: "DOMAIN_ALREADY_CLAIMED",
          message: "This domain is already claimed by another organisation",
        });
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
        // Canonical is a MARKER: no redirect implementation exists, so this is
        // constant false until one is explicitly proven (ADR-ACT-0236).
        redirectActive: false,
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
        redirectActive: false,
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
  // Platform operations cockpit — service readiness + workers (ADR-ACT-0228,
  // hardened ADR-ACT-0235/0236). Read-only, tenant.platform.read. Bounded
  // service-specific health checks over a safe local-service allowlist; never
  // returns secrets/DSNs/raw env. Console links follow the ADR-ACT-0233
  // clickthrough policy under EXPLICIT host authority (resolveReadinessAccess):
  //   - tenant-resolved FQDN → tenant_operator view (every viewer, including a
  //     system-admin without support escalation — documented downgrade policy)
  //   - system-admin on the APEX host → system_operator view (global links)
  //   - system-admin on reserved/unknown/unresolved hosts → REFUSED; "no
  //     tenant context" never means "safe global context"
  // No pipeline FQDN scope: the handler enforces the matrix above itself.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/platform/services/readiness",
    operationName: "org.platform.services.readiness",
    requiresAuth: true,
    requiredPermission: "tenant.platform.read",
    resource: "admin:platform",
    umaScope: "read" as const,
    handler: async (req, res) => {
      const { buildPlatformServicesReadiness, resolveReadinessAccess } =
        await import("../usecases/platform-services.ts");
      const host = requestHostFromHeaders(req.raw);
      const identity = classifyHostIdentity(host, process.env["APEX_DOMAIN"] ?? "aldous.info");
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const access = resolveReadinessAccess({
        isSystemAdmin: req.actor!.roles.includes("system-admin"),
        hostKind: identity.kind,
        tenantResolved: tenantCtx !== null,
      });
      if (access.kind === "no_tenant") {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      if (access.kind === "invalid_operations_origin") {
        res.json(403, {
          code: "INVALID_OPERATIONS_ORIGIN",
          message: "Operator readiness is only served on the apex host or a tenant FQDN",
        });
        return;
      }
      const { getWorkerHeartbeat } = await import("./worker-registry.ts");
      const pool = getApplicationPool();
      const readiness = await buildPlatformServicesReadiness({
        httpProbe: async (url) => {
          try {
            const response = await fetch(url, {
              method: "GET",
              signal: AbortSignal.timeout(1500),
            });
            // 64KB cap: large enough for full structured health bodies (the
            // Keycloak discovery document is >4KB — truncating it would break
            // its JSON check and fake a degraded state), small enough to bound.
            const body = ((await response.text().catch(() => "")) || "").slice(0, 65536);
            return { statusCode: response.status, body };
          } catch {
            return null;
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
        viewerMode: access.viewerMode,
        tenantHost: access.viewerMode === "tenant_operator" ? host : null,
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
      if (result.kind === "domain_already_claimed") {
        res.json(409, {
          code: "DOMAIN_ALREADY_CLAIMED",
          message: "This domain is already claimed by another organisation",
        });
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
      if (result.kind === "domain_already_claimed") {
        res.json(409, {
          code: "DOMAIN_ALREADY_CLAIMED",
          message: "This domain is already claimed by another organisation",
        });
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
  // ---------------------------------------------------------------------------
  // Entitlements + service catalog (Phase 1, ADR-0055 / ADR-0057 / ADR-0058 / ADR-ACT-0254).
  // Entitlements answer "what is this tenant allowed to use?" — server-authoritative,
  // deny-by-default, operator-assigned, audited. A tenant can never self-grant.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/entitlements",
    operationName: "org.entitlements.list",
    requiresAuth: true,
    requiredPermission: "tenant.entitlements.read",
    resource: "organisation:entitlements",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listTenantEntitlements } = await import("../usecases/entitlements.ts");
      res.json(
        200,
        await listTenantEntitlements(tenantCtx.organisationId, await buildEntitlementDeps())
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/entitlements",
    operationName: "admin.tenants.entitlements.list",
    requiresAuth: true,
    requiredPermission: "platform.entitlements.read",
    resource: "admin:entitlements",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listEntitlementsForTenant } = await import("../usecases/entitlements.ts");
      res.json(200, await listEntitlementsForTenant(tenantId, await buildEntitlementDeps()));
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/tenants/:tenantId/entitlements",
    operationName: "admin.tenants.entitlements.set",
    requiresAuth: true,
    requiredPermission: "platform.entitlements.write",
    resource: "admin:entitlements",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = SetEntitlementRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid entitlement request",
        });
        return;
      }
      const { setEntitlement } = await import("../usecases/entitlements.ts");
      const result = await setEntitlement(
        {
          organisationId: tenantId,
          key: parsed.data.key,
          state: parsed.data.state,
          note: parsed.data.note,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildEntitlementDeps()
      );
      if (result.kind === "unknown_key") {
        res.json(404, { code: "NOT_FOUND", message: "Unknown entitlement key" });
        return;
      }
      res.json(200, { entitlement: result.entitlement });
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants",
    operationName: "admin.tenants.lookup",
    requiresAuth: true,
    requiredPermission: "platform.tenants.read",
    resource: "admin:tenants",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const q = url.searchParams.get("q") ?? undefined;
      const { lookupTenants } = await import("../usecases/admin-tenants.ts");
      res.json(200, await lookupTenants(getApplicationPool(), q));
    },
  },
  {
    method: "GET",
    path: "/api/platform/service-catalog",
    operationName: "platform.serviceCatalog.list",
    requiresAuth: true,
    requiredPermission: "platform.admin.access",
    resource: "admin:platform",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { buildServiceCatalog } = await import("../usecases/service-catalog.ts");
      res.json(200, buildServiceCatalog({ operator: true }));
    },
  },
  // ---------------------------------------------------------------------------
  // Metering + quota (Phase 2, ADR-0067 / ADR-ACT-0256). Metering = "how much
  // usage was recorded"; quota = "is the next action allowed under the limit".
  // Ingestion is operator/internal (server-authoritative) — tenant self-ingestion
  // is deliberately NOT exposed (usage/quota integrity). Reads are tenant + operator.
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/meter-events",
    operationName: "admin.tenants.meterEvents.record",
    requiresAuth: true,
    requiredPermission: "platform.metering.write",
    resource: "admin:metering",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = RecordMeterEventRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid meter event",
        });
        return;
      }
      const { recordMeterEvent } = await import("../usecases/metering.ts");
      try {
        const result = await recordMeterEvent(
          { organisationId: tenantId, ...parsed.data },
          await buildMeteringDeps()
        );
        if (result.kind === "unknown_meter") {
          res.json(404, { code: "NOT_FOUND", message: "Unknown meter key" });
          return;
        }
        res.json(result.deduplicated ? 200 : 201, {
          recorded: result.recorded,
          deduplicated: result.deduplicated,
        });
      } catch (err) {
        if (err instanceof ForbiddenError) {
          res.json(403, err.toSafeResponse());
          return;
        }
        if (err instanceof ValidationError) {
          res.json(400, err.toSafeResponse());
          return;
        }
        throw err;
      }
    },
  },
  {
    method: "GET",
    path: "/api/org/usage",
    operationName: "org.usage.list",
    requiresAuth: true,
    requiredPermission: "tenant.metering.read",
    resource: "organisation:usage",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getUsage } = await import("../usecases/metering.ts");
      res.json(200, await getUsage(tenantCtx.organisationId, await buildMeteringDeps()));
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/usage",
    operationName: "admin.tenants.usage.list",
    requiresAuth: true,
    requiredPermission: "platform.metering.read",
    resource: "admin:metering",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { getUsage } = await import("../usecases/metering.ts");
      res.json(200, await getUsage(tenantId, await buildMeteringDeps(), { operator: true }));
    },
  },
  {
    method: "GET",
    path: "/api/org/quotas",
    operationName: "org.quotas.list",
    requiresAuth: true,
    requiredPermission: "tenant.metering.read",
    resource: "organisation:quotas",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listQuotas } = await import("../usecases/quota.ts");
      res.json(200, await listQuotas(tenantCtx.organisationId, await buildQuotaDeps()));
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/quotas",
    operationName: "admin.tenants.quotas.list",
    requiresAuth: true,
    requiredPermission: "platform.quotas.read",
    resource: "admin:quotas",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listQuotas } = await import("../usecases/quota.ts");
      res.json(200, await listQuotas(tenantId, await buildQuotaDeps(), { operator: true }));
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/tenants/:tenantId/quotas",
    operationName: "admin.tenants.quotas.set",
    requiresAuth: true,
    requiredPermission: "platform.quotas.write",
    resource: "admin:quotas",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = SetQuotaRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid quota request",
        });
        return;
      }
      const { setQuota } = await import("../usecases/quota.ts");
      const result = await setQuota(
        {
          organisationId: tenantId,
          ...parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildQuotaDeps()
      );
      res.json(200, { quotaKey: result.quotaKey });
    },
  },
  // ---------------------------------------------------------------------------
  // Developer platform (Phase 3, ADR-0065 / ADR-ACT-0257). API keys are
  // tenant self-service (server-generated, secret shown once, hashed at rest,
  // entitlement-gated, revocable). Rate limits are operator-set + tenant-read.
  // The developer-portal foundation is a read-only summary. No route ever
  // returns an API-key secret or hash except the one-time create response.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/api-keys",
    operationName: "org.apiKeys.list",
    requiresAuth: true,
    requiredPermission: "tenant.api_keys.read",
    resource: "organisation:api_keys",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listApiKeys } = await import("../usecases/api-keys.ts");
      res.json(200, await listApiKeys(tenantCtx.organisationId, await buildApiKeysDeps()));
    },
  },
  {
    method: "POST",
    path: "/api/org/api-keys",
    operationName: "org.apiKeys.create",
    requiresAuth: true,
    requiredPermission: "tenant.api_keys.write",
    resource: "organisation:api_keys",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = CreateApiKeyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid API key request",
        });
        return;
      }
      const { createApiKey } = await import("../usecases/api-keys.ts");
      try {
        const result = await createApiKey(
          {
            organisationId: tenantCtx.organisationId,
            ...parsed.data,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          await buildApiKeysDeps()
        );
        if (result.kind === "not_entitled") {
          res.json(403, {
            code: "FORBIDDEN",
            message: "Tenant is not entitled to programmatic API access",
          });
          return;
        }
        res.json(201, result.response);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.json(400, err.toSafeResponse());
          return;
        }
        throw err;
      }
    },
  },
  {
    method: "DELETE",
    path: "/api/org/api-keys/:keyId",
    operationName: "org.apiKeys.revoke",
    requiresAuth: true,
    requiredPermission: "tenant.api_keys.write",
    resource: "organisation:api_keys",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const keyId = req.params["keyId"] ?? "";
      if (!UUID_RE.test(keyId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid key id" });
        return;
      }
      const { revokeApiKey } = await import("../usecases/api-keys.ts");
      const result = await revokeApiKey(
        {
          organisationId: tenantCtx.organisationId,
          keyId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildApiKeysDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "API key not found" });
        return;
      }
      res.json(200, { revoked: true });
    },
  },
  {
    method: "GET",
    path: "/api/org/developer",
    operationName: "org.developer.portal",
    requiresAuth: true,
    requiredPermission: "tenant.developer.read",
    resource: "organisation:developer",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getDeveloperPortal } = await import("../usecases/rate-limits.ts");
      res.json(
        200,
        await getDeveloperPortal(tenantCtx.organisationId, await buildDeveloperPortalDeps())
      );
    },
  },
  {
    method: "GET",
    path: "/api/org/rate-limits",
    operationName: "org.rateLimits.list",
    requiresAuth: true,
    requiredPermission: "tenant.developer.read",
    resource: "organisation:rate_limits",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { listRateLimits } = await import("../usecases/rate-limits.ts");
      res.json(200, await listRateLimits(tenantCtx.organisationId, await buildRateLimitDeps()));
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/api-keys",
    operationName: "admin.tenants.apiKeys.list",
    requiresAuth: true,
    requiredPermission: "platform.api_keys.read",
    resource: "admin:api_keys",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listApiKeys } = await import("../usecases/api-keys.ts");
      res.json(200, await listApiKeys(tenantId, await buildApiKeysDeps(), { operator: true }));
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/rate-limits",
    operationName: "admin.tenants.rateLimits.list",
    requiresAuth: true,
    requiredPermission: "platform.rate_limits.read",
    resource: "admin:rate_limits",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listRateLimits } = await import("../usecases/rate-limits.ts");
      res.json(200, await listRateLimits(tenantId, await buildRateLimitDeps(), { operator: true }));
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/tenants/:tenantId/rate-limits",
    operationName: "admin.tenants.rateLimits.set",
    requiresAuth: true,
    requiredPermission: "platform.rate_limits.write",
    resource: "admin:rate_limits",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = SetRateLimitRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid rate-limit request",
        });
        return;
      }
      const { setRateLimit } = await import("../usecases/rate-limits.ts");
      const result = await setRateLimit(
        {
          organisationId: tenantId,
          ...parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildRateLimitDeps()
      );
      res.json(200, { policyKey: result.policyKey });
    },
  },
  // ---------------------------------------------------------------------------
  // Tenant-isolated product search (Phase 4, ADR-0060 / ADR-ACT-0258). Built-in
  // Postgres FTS; tenant query is permission-aware + RLS-isolated. Indexing is
  // server-internal (not exposed). Readiness + reindex are operator-only.
  // ---------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/org/search",
    operationName: "org.search.query",
    requiresAuth: true,
    requiredPermission: "tenant.search.read",
    resource: "organisation:search",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = SearchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid search request",
        });
        return;
      }
      const { searchProducts } = await import("../usecases/search.ts");
      try {
        res.json(
          200,
          await searchProducts(
            tenantCtx.organisationId,
            parsed.data,
            req.actor!.permissions,
            await buildSearchDeps()
          )
        );
      } catch (err) {
        if (err instanceof ValidationError) {
          res.json(400, err.toSafeResponse());
          return;
        }
        throw err;
      }
    },
  },
  {
    method: "GET",
    path: "/api/admin/search/readiness",
    operationName: "admin.search.readiness",
    requiresAuth: true,
    requiredPermission: "platform.search.read",
    resource: "admin:search",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getSearchReadiness } = await import("../usecases/search.ts");
      res.json(200, await getSearchReadiness(await buildSearchDeps()));
    },
  },
  {
    method: "POST",
    path: "/api/admin/search/reindex",
    operationName: "admin.search.reindex",
    requiresAuth: true,
    requiredPermission: "platform.search.write",
    resource: "admin:search",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = ReindexRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid reindex request",
        });
        return;
      }
      const { reindexTenant } = await import("../usecases/search.ts");
      const result = await reindexTenant(
        {
          organisationId: parsed.data.tenantId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildSearchDeps()
      );
      res.json(200, { reindexed: result.reindexed });
    },
  },
  // ---------------------------------------------------------------------------
  // Event bus + durable workers + DLQ/redrive (Phase 5, ADR-0059 / ADR-ACT-0259).
  // Operator-only read surfaces + audited redrive + worker-runtime visibility.
  // Publishing + worker ticks are server-internal (not exposed on HTTP).
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/events",
    operationName: "admin.events.list",
    requiresAuth: true,
    requiredPermission: "platform.events.read",
    resource: "admin:events",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { getEvents } = await import("../usecases/events.ts");
      res.json(200, await getEvents(organisationId, await buildEventsDeps()));
    },
  },
  {
    method: "GET",
    path: "/api/admin/events/dead-letter",
    operationName: "admin.events.deadLetter.list",
    requiresAuth: true,
    requiredPermission: "platform.events.read",
    resource: "admin:events",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { getDeadLetters } = await import("../usecases/events.ts");
      res.json(200, await getDeadLetters(organisationId, await buildEventsDeps()));
    },
  },
  {
    method: "POST",
    path: "/api/admin/events/:eventId/redrive",
    operationName: "admin.events.redrive",
    requiresAuth: true,
    requiredPermission: "platform.events.write",
    resource: "admin:events",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const deadLetterId = req.params["eventId"] ?? "";
      if (!UUID_RE.test(deadLetterId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid dead-letter id" });
        return;
      }
      const { redriveEvent } = await import("../usecases/events.ts");
      const result = await redriveEvent(
        {
          deadLetterId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildEventsDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Dead letter not found or already redriven" });
        return;
      }
      res.json(200, { redriven: true, eventId: result.eventId });
    },
  },
  {
    method: "GET",
    path: "/api/admin/workers",
    operationName: "admin.workers.list",
    requiresAuth: true,
    requiredPermission: "platform.workers.read",
    resource: "admin:workers",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { listWorkers } = await import("../usecases/events.ts");
      res.json(200, await listWorkers(await buildEventsDeps()));
    },
  },
  // ---------------------------------------------------------------------------
  // End-user profile self-service + notification preferences + notifications
  // (Phase 6, ADR-0068 / ADR-ACT-0260). /api/me/* is own-user only (the userId is
  // the session subject, never a param). Readiness + test send are operator-only.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/me/profile",
    operationName: "me.profile.get",
    requiresAuth: true,
    requiredPermission: "profile.read_self",
    resource: "me:profile",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getMyProfile } = await import("../usecases/profile.ts");
      res.json(
        200,
        await getMyProfile(tenantCtx.organisationId, req.actor!.userId, await buildProfileDeps())
      );
    },
  },
  {
    method: "PATCH",
    path: "/api/me/profile",
    operationName: "me.profile.update",
    requiresAuth: true,
    requiredPermission: "profile.update_self",
    resource: "me:profile",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = UpdateProfileRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid profile",
        });
        return;
      }
      const { updateMyProfile } = await import("../usecases/profile.ts");
      try {
        const profile = await updateMyProfile(
          {
            organisationId: tenantCtx.organisationId,
            userId: req.actor!.userId,
            ...parsed.data,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          await buildProfileDeps()
        );
        res.json(200, profile);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.json(400, err.toSafeResponse());
          return;
        }
        throw err;
      }
    },
  },
  {
    method: "GET",
    path: "/api/me/notification-preferences",
    operationName: "me.notificationPreferences.get",
    requiresAuth: true,
    requiredPermission: "profile.read_self",
    resource: "me:notification_preferences",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const { getMyPreferences } = await import("../usecases/notifications.ts");
      res.json(
        200,
        await getMyPreferences(
          tenantCtx.organisationId,
          req.actor!.userId,
          await buildNotificationsDeps()
        )
      );
    },
  },
  {
    method: "PATCH",
    path: "/api/me/notification-preferences",
    operationName: "me.notificationPreferences.update",
    requiresAuth: true,
    requiredPermission: "profile.update_self",
    resource: "me:notification_preferences",
    umaScope: "write" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const parsed = UpdateNotificationPreferencesRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid preferences",
        });
        return;
      }
      const { updateMyPreferences } = await import("../usecases/notifications.ts");
      res.json(
        200,
        await updateMyPreferences(
          {
            organisationId: tenantCtx.organisationId,
            userId: req.actor!.userId,
            preferences: parsed.data.preferences,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          await buildNotificationsDeps()
        )
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/notifications/readiness",
    operationName: "admin.notifications.readiness",
    requiresAuth: true,
    requiredPermission: "platform.notifications.read",
    resource: "admin:notifications",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getNotificationReadiness } = await import("../usecases/notifications.ts");
      res.json(200, await getNotificationReadiness(await buildNotificationsDeps()));
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/notifications/test",
    operationName: "admin.notifications.test",
    requiresAuth: true,
    requiredPermission: "platform.notifications.write",
    resource: "admin:notifications",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = TestNotificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid test request",
        });
        return;
      }
      const { sendTestNotification } = await import("../usecases/notifications.ts");
      const result = await sendTestNotification(
        {
          organisationId: tenantId,
          userId: parsed.data.userId,
          category: parsed.data.category,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildNotificationsDeps()
      );
      res.json(200, result);
    },
  },
  // ---------------------------------------------------------------------------
  // Observability — metric signals + alert rules + incidents (Phase 7, ADR-0062 /
  // ADR-ACT-0261). Operator-only. Signal registration + sample recording are
  // server-internal (not exposed); reads/alert-management/incident-lifecycle here.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/observability/signals",
    operationName: "admin.observability.signals",
    requiresAuth: true,
    requiredPermission: "platform.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { listSignals } = await import("../usecases/observability.ts");
      res.json(
        200,
        await listSignals(organisationId, await buildObservabilityDeps(), { operator: true })
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/alerts",
    operationName: "admin.alerts.list",
    requiresAuth: true,
    requiredPermission: "platform.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { listAlertRules } = await import("../usecases/observability.ts");
      res.json(
        200,
        await listAlertRules(organisationId, await buildObservabilityDeps(), { operator: true })
      );
    },
  },
  {
    method: "POST",
    path: "/api/admin/alerts",
    operationName: "admin.alerts.create",
    requiresAuth: true,
    requiredPermission: "platform.observability.write",
    resource: "admin:observability",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = CreateAlertRuleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid alert rule",
        });
        return;
      }
      const { setAlertRule } = await import("../usecases/observability.ts");
      const result = await setAlertRule(
        {
          ...parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildObservabilityDeps()
      );
      res.json(200, { ruleKey: result.ruleKey });
    },
  },
  {
    method: "POST",
    path: "/api/admin/alerts/:alertId/evaluate",
    operationName: "admin.alerts.evaluate",
    requiresAuth: true,
    requiredPermission: "platform.observability.write",
    resource: "admin:observability",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const alertId = req.params["alertId"] ?? "";
      if (!UUID_RE.test(alertId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid alert id" });
        return;
      }
      const { evaluateAlert } = await import("../usecases/observability.ts");
      const result = await evaluateAlert(alertId, await buildObservabilityDeps(), {
        actorId: req.actor!.userId,
        actorRoles: req.actor!.roles,
        sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
      });
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Alert rule not found" });
        return;
      }
      res.json(200, result.response);
    },
  },
  {
    method: "GET",
    path: "/api/admin/incidents",
    operationName: "admin.incidents.list",
    requiresAuth: true,
    requiredPermission: "platform.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { listIncidents } = await import("../usecases/observability.ts");
      res.json(
        200,
        await listIncidents(organisationId, await buildObservabilityDeps(), { operator: true })
      );
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/incidents/:incidentId",
    operationName: "admin.incidents.update",
    requiresAuth: true,
    requiredPermission: "platform.observability.write",
    resource: "admin:observability",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const incidentId = req.params["incidentId"] ?? "";
      if (!UUID_RE.test(incidentId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid incident id" });
        return;
      }
      const parsed = UpdateIncidentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid incident update",
        });
        return;
      }
      const { updateIncident } = await import("../usecases/observability.ts");
      const result = await updateIncident(
        {
          incidentId,
          status: parsed.data.status,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildObservabilityDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Incident not found" });
        return;
      }
      res.json(200, result.incident);
    },
  },
  {
    method: "GET",
    path: "/api/admin/observability/readiness",
    operationName: "admin.observability.readiness",
    requiresAuth: true,
    requiredPermission: "platform.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getObservabilityReadiness } = await import("../usecases/observability.ts");
      res.json(200, await getObservabilityReadiness(await buildObservabilityDeps()));
    },
  },
  // ---------------------------------------------------------------------------
  // Scheduled jobs (Phase 5.5, ADR-0059 / ADR-ACT-0262). Operator-only. A due job
  // enqueues an event onto the Phase-5 outbox (idempotent per window). The scheduler
  // tick (runDueJobs) is server-internal; these routes manage + run-now + pause/resume.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/scheduled-jobs",
    operationName: "admin.scheduledJobs.list",
    requiresAuth: true,
    requiredPermission: "platform.jobs.read",
    resource: "admin:scheduled_jobs",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { listScheduledJobs } = await import("../usecases/scheduled-jobs.ts");
      res.json(
        200,
        await listScheduledJobs(organisationId, await buildScheduledJobsDeps(), { operator: true })
      );
    },
  },
  {
    method: "POST",
    path: "/api/admin/scheduled-jobs",
    operationName: "admin.scheduledJobs.create",
    requiresAuth: true,
    requiredPermission: "platform.jobs.write",
    resource: "admin:scheduled_jobs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = CreateScheduledJobRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid scheduled job",
        });
        return;
      }
      const { setScheduledJob } = await import("../usecases/scheduled-jobs.ts");
      const result = await setScheduledJob(
        {
          ...parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildScheduledJobsDeps()
      );
      res.json(200, { jobKey: result.jobKey });
    },
  },
  {
    method: "POST",
    path: "/api/admin/scheduled-jobs/:jobId/run",
    operationName: "admin.scheduledJobs.run",
    requiresAuth: true,
    requiredPermission: "platform.jobs.write",
    resource: "admin:scheduled_jobs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const jobId = req.params["jobId"] ?? "";
      if (!UUID_RE.test(jobId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid job id" });
        return;
      }
      const { runScheduledJobNow } = await import("../usecases/scheduled-jobs.ts");
      const result = await runScheduledJobNow(
        {
          jobId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildScheduledJobsDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Scheduled job not found" });
        return;
      }
      res.json(200, result.response);
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/scheduled-jobs/:jobId",
    operationName: "admin.scheduledJobs.update",
    requiresAuth: true,
    requiredPermission: "platform.jobs.write",
    resource: "admin:scheduled_jobs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const jobId = req.params["jobId"] ?? "";
      if (!UUID_RE.test(jobId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid job id" });
        return;
      }
      const parsed = UpdateScheduledJobRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid update",
        });
        return;
      }
      const { setScheduledJobEnabled } = await import("../usecases/scheduled-jobs.ts");
      const result = await setScheduledJobEnabled(
        {
          jobId,
          enabled: parsed.data.enabled,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildScheduledJobsDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Scheduled job not found" });
        return;
      }
      res.json(200, result.job);
    },
  },
  // ---------------------------------------------------------------------------
  // Runtime secrets — central secret store (Tier-1 kernel, ADR-0069 / ADR-ACT-0265).
  // Operator-only. The read/list/readiness surface returns value-free metadata; the
  // plaintext is write-only and resolved exclusively server-internally. The active
  // backend (built-in Postgres default or composed OpenBao) is chosen behind the port.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/secrets/readiness",
    operationName: "admin.secrets.readiness",
    requiresAuth: true,
    requiredPermission: "platform.secrets.read",
    resource: "admin:secrets",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { secretStoreReadiness } = await import("../usecases/secrets.ts");
      res.json(200, await secretStoreReadiness(await buildSecretsDeps()));
    },
  },
  {
    method: "GET",
    path: "/api/admin/secrets",
    operationName: "admin.secrets.list",
    requiresAuth: true,
    requiredPermission: "platform.secrets.read",
    resource: "admin:secrets",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query parameter is required",
        });
        return;
      }
      const { listSecrets } = await import("../usecases/secrets.ts");
      res.json(200, await listSecrets(organisationId, await buildSecretsDeps()));
    },
  },
  {
    method: "POST",
    path: "/api/admin/secrets",
    operationName: "admin.secrets.put",
    requiresAuth: true,
    requiredPermission: "platform.secrets.write",
    resource: "admin:secrets",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = PutSecretRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid secret",
        });
        return;
      }
      const { putSecret } = await import("../usecases/secrets.ts");
      const summary = await putSecret(
        {
          organisationId: parsed.data.organisationId,
          name: parsed.data.name,
          value: parsed.data.value,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildSecretsDeps()
      );
      res.json(200, summary);
    },
  },
  {
    method: "POST",
    path: "/api/admin/secrets/revoke",
    operationName: "admin.secrets.revoke",
    requiresAuth: true,
    requiredPermission: "platform.secrets.write",
    resource: "admin:secrets",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = SecretRefActionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid secret reference" });
        return;
      }
      const { revokeSecret } = await import("../usecases/secrets.ts");
      const result = await revokeSecret(
        {
          organisationId: parsed.data.organisationId,
          ref: parsed.data.ref,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildSecretsDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Secret not found" });
        return;
      }
      res.json(200, { revoked: true });
    },
  },
  {
    method: "POST",
    path: "/api/admin/secrets/delete",
    operationName: "admin.secrets.delete",
    requiresAuth: true,
    requiredPermission: "platform.secrets.write",
    resource: "admin:secrets",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = SecretRefActionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid secret reference" });
        return;
      }
      const { deleteSecret } = await import("../usecases/secrets.ts");
      const result = await deleteSecret(
        {
          organisationId: parsed.data.organisationId,
          ref: parsed.data.ref,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildSecretsDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Secret not found" });
        return;
      }
      res.json(200, { deleted: true });
    },
  },
  // ---------------------------------------------------------------------------
  // Provider configuration plane (Tier-1 kernel, ADR-0070 / ADR-ACT-0266). Operator-only.
  // Binds a USF capability to a concrete provider per environment; credentials by
  // secretRef (ADR-0069); config rejects secret-bearing keys; lifecycle ready is
  // adapter-confirmed; a forbidden-in-production provider can never be active in prod.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/provider-configs",
    operationName: "admin.providerConfigs.list",
    requiresAuth: true,
    requiredPermission: "platform.providers.read",
    resource: "admin:provider_configs",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const capability =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("capability") ?? undefined;
      const { listProviderConfigs } = await import("../usecases/provider-config.ts");
      res.json(200, await listProviderConfigs(await buildProviderConfigDeps(), { capability }));
    },
  },
  {
    method: "POST",
    path: "/api/admin/provider-configs",
    operationName: "admin.providerConfigs.put",
    requiresAuth: true,
    requiredPermission: "platform.providers.write",
    resource: "admin:provider_configs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = PutProviderConfigRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid provider config",
        });
        return;
      }
      const { putProviderConfig } = await import("../usecases/provider-config.ts");
      const summary = await putProviderConfig(
        {
          ...parsed.data,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildProviderConfigDeps()
      );
      res.json(200, summary);
    },
  },
  {
    method: "POST",
    path: "/api/admin/provider-configs/:id/lifecycle",
    operationName: "admin.providerConfigs.lifecycle",
    requiresAuth: true,
    requiredPermission: "platform.providers.write",
    resource: "admin:provider_configs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const id = req.params["id"] ?? "";
      if (!UUID_RE.test(id)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid provider config id" });
        return;
      }
      const parsed = SetProviderLifecycleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid lifecycle state" });
        return;
      }
      const { PostgresProviderConfigRepository } =
        await import("../adapters/postgres-provider-config-repository.ts");
      const repo = new PostgresProviderConfigRepository(getApplicationPool());
      const ok = await repo.setLifecycleState(id, parsed.data.lifecycleState);
      if (!ok) {
        res.json(404, { code: "NOT_FOUND", message: "Provider config not found" });
        return;
      }
      res.json(200, { lifecycleState: parsed.data.lifecycleState });
    },
  },
  {
    method: "POST",
    path: "/api/admin/provider-configs/:id/delete",
    operationName: "admin.providerConfigs.delete",
    requiresAuth: true,
    requiredPermission: "platform.providers.write",
    resource: "admin:provider_configs",
    umaScope: "write" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const id = req.params["id"] ?? "";
      if (!UUID_RE.test(id)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid provider config id" });
        return;
      }
      const { deleteProviderConfig } = await import("../usecases/provider-config.ts");
      const result = await deleteProviderConfig(
        {
          id,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        await buildProviderConfigDeps()
      );
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Provider config not found" });
        return;
      }
      res.json(200, { deleted: true });
    },
  },
  // ---------------------------------------------------------------------------
  // Composed provider readiness (ADR-0071 / ADR-ACT-0271). Operator-only. Live health
  // probe per composed provider feeding the adapter-confirmed lifecycle. No secret.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/providers/readiness",
    operationName: "admin.providers.readiness",
    requiresAuth: true,
    requiredPermission: "platform.providers.read",
    resource: "admin:provider_configs",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getComposedProviderReadiness } = await import("../usecases/composed-providers.ts");
      res.json(200, await getComposedProviderReadiness());
    },
  },
  // ---------------------------------------------------------------------------
  // History read-model (ADR-0063 / ADR-ACT-0272). Read-only UNION projection over the
  // existing audited/event/notification/incident/meter sources — no new store, no
  // duplicated data. Tenant reads its own; operator reads a selected tenant. Paginated;
  // secret-bearing columns never projected.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/org/history",
    operationName: "org.history.list",
    requiresAuth: true,
    requiredPermission: "tenant.audit.read",
    resource: "organisation:history",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const q = parseHistoryQuery(req.raw.url ?? "");
      const { getHistory } = await import("../usecases/history.ts");
      res.json(
        200,
        await getHistory(
          tenantCtx.organisationId,
          { limit: q.limit, offset: q.offset, sources: q.sources },
          await buildHistoryDeps()
        )
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/history",
    operationName: "admin.tenants.history.list",
    requiresAuth: true,
    requiredPermission: "platform.audit.read_all",
    resource: "admin:history",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const q = parseHistoryQuery(req.raw.url ?? "");
      const { getHistory } = await import("../usecases/history.ts");
      res.json(
        200,
        await getHistory(
          tenantId,
          { limit: q.limit, offset: q.offset, sources: q.sources },
          await buildHistoryDeps()
        )
      );
    },
  },
];
