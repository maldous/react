import {
  ConflictError,
  ForbiddenError,
  UnexpectedError,
  ValidationError,
} from "@platform/platform-errors";
import type { Route } from "./pipeline.ts";
import { getHealth, getReadiness, getVersion } from "./health.ts";
import { getMetrics, metricsContentType } from "../adapters/prometheus-metrics.ts";
import { getFixtureSession } from "./session.ts";
import { handleGetOrganisationProfile, handlePatchOrganisationProfile } from "./organisation.ts";
import { handleGraphql } from "./graphql.ts";
import { handleSearchLogs } from "./admin-logs.ts";
import {
  handleAuthLogin,
  handleAuthCallback,
  handleAuthLogout,
  handleAuthLogoutRedirect,
  parseSessionCookies,
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
import {
  loadBootstrapSecretConfig,
  createSecretStoreFromBootstrap,
} from "../config/bootstrap-secrets.ts";
import { loadNotificationConfig } from "../config/notification-config.ts";
import { loadStageConfig } from "../config/stage-config.ts";
import { loadObservabilityProbeConfig } from "../config/observability-probe-config.ts";
import { loadHealthMetadataConfig } from "../config/health-metadata-config.ts";
import { loadProviderReadinessConfig } from "../config/provider-readiness-config.ts";
import { loadPlatformApiConfig } from "../config/app-config.ts";
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
import {
  enterSupportMode,
  requestSupportApproval,
  approveSupportApproval,
} from "../usecases/support.ts";
import {
  mutateAuthSetting,
  buildMfaAuditMetadata,
  buildLockoutAuditMetadata,
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
import { TemporalWorkflowProviderAdapter } from "../adapters/temporal-workflow-provider.ts";
import { WindmillAutomationProviderAdapter } from "../adapters/windmill-automation-provider.ts";
import { InMemoryWorkflowOrchestrator } from "../adapters/in-memory-workflow-orchestrator.ts";
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
import { suspendTenant, deleteTenant } from "../usecases/tenant-lifecycle.ts";
import { z } from "zod";
import { PostgresDataGovernanceAdapter } from "../adapters/postgres-data-governance.ts";
import { PostgresStorageObjectRepository } from "../adapters/postgres-storage-object-repository.ts";
import { PostgresLegalHoldRepository } from "../adapters/postgres-legal-hold.ts";
import { LegalHoldGuard } from "../usecases/legal-hold.ts";
import { StubAntivirusPort } from "../ports/antivirus.ts";
import { ClamAvAdapter, loadClamAvConfig } from "../adapters/clamav-antivirus.ts";

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

/**
 * Map a vanity-domain verify result kind to the public status string.
 * ok / already_verified → verified; dns_mismatch → dns_mismatch;
 * dns_not_found (and any other) → pending_dns (keep waiting on DNS propagation).
 */
function domainVerifyStatus(kind: string): string {
  if (kind === "ok" || kind === "already_verified") return "verified";
  if (kind === "dns_mismatch") return "dns_mismatch";
  return "pending_dns";
}

async function auditAdminWorkflowMutation(input: {
  actor: { userId: string; tenantId: string; roles: string[] };
  action: AuditAction;
  workflowId: string;
  workflowKey?: string;
  tenantId?: string;
  signalName?: string;
  requestId: string;
  sourceHost?: string;
}): Promise<void> {
  await createPostgresAuditEventPort(getApplicationPool()).emit(
    createAuditEvent({
      actorId: input.actor.userId,
      actorRoles: input.actor.roles,
      tenantId: input.tenantId ?? input.actor.tenantId,
      action: input.action,
      resource: "workflow",
      resourceId: input.workflowId,
      metadata: {
        workflowKey: input.workflowKey,
        workflowId: input.workflowId,
        signalName: input.signalName,
        before: "provider-authoritative",
        after:
          input.action === AuditAction.WorkflowStarted
            ? "running"
            : input.action === AuditAction.WorkflowCancelled
              ? "cancelled"
              : "provider-authoritative",
      },
      correlationId: input.requestId,
      sourceHost: input.sourceHost,
    })
  );
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
  const ncfg = loadNotificationConfig();
  return (provider, config, secret) => {
    if (provider === "local") {
      return new SmtpEmailAdapter({
        host: ncfg.localSmtpHost,
        port: ncfg.localSmtpPort,
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
  const probe = loadObservabilityProbeConfig();
  const grafanaUrl = probe.grafanaUrl ?? port(probe.grafanaPort);
  const otelUrl = probe.otelHealthUrl ?? port(probe.otelHealthPort);
  return {
    // No Prometheus/metrics backend locally → not_applicable unless PROMETHEUS_URL is set.
    probeMetrics: () => reach(probe.prometheusUrl, true),
    probeOtelCollector: () => reach(otelUrl),
    probeDashboards: () => reach(grafanaUrl ? `${grafanaUrl}/api/health` : undefined),
    probeErrorCapture: async () => {
      const dsn = probe.sentryDsn;
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

function temporalProvider(): TemporalWorkflowProviderAdapter | null {
  const providerConfig = loadProviderReadinessConfig();
  const temporalUrl =
    providerConfig.temporalAddress?.trim() ?? providerConfig.temporalHttpUrl?.trim();
  return temporalUrl ? new TemporalWorkflowProviderAdapter(temporalUrl, { preferSdk: true }) : null;
}

function windmillProvider(): WindmillAutomationProviderAdapter | null {
  const providerConfig = loadProviderReadinessConfig();
  const windmillUrl = providerConfig.windmillUrl?.trim();
  if (!windmillUrl) return null;
  return new WindmillAutomationProviderAdapter(windmillUrl, fetch, {
    token: providerConfig.windmillToken?.trim() || undefined,
    preferSdk: true,
  });
}

let supportWorkflowOrchestrator:
  | TemporalWorkflowProviderAdapter
  | InMemoryWorkflowOrchestrator
  | null = null;

function workflowOrchestrator(): TemporalWorkflowProviderAdapter | InMemoryWorkflowOrchestrator {
  if (supportWorkflowOrchestrator) return supportWorkflowOrchestrator;
  supportWorkflowOrchestrator = temporalProvider() ?? new InMemoryWorkflowOrchestrator();
  return supportWorkflowOrchestrator;
}

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

async function buildStorageObjectDeps(organisationId: string) {
  const storageDeps = buildStorageReadinessDeps(organisationId);
  if (!storageDeps.makeProbe) return null;
  const platformConfig = loadPlatformApiConfig();
  const pool = getApplicationPool();
  return {
    repository: new PostgresStorageObjectRepository(pool),
    storage: storageDeps.makeProbe().port,
    quotas: await buildQuotaDeps(),
    audit: createPostgresAuditEventPort(pool),
    legalHoldGuard: new LegalHoldGuard({
      repository: new PostgresLegalHoldRepository(pool),
    }),
    antivirus:
      platformConfig.storageAvProvider === "stub"
        ? new StubAntivirusPort()
        : new ClamAvAdapter({
            ...loadClamAvConfig(),
            host: platformConfig.clamavHost,
            port: platformConfig.clamavPort,
          }),
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

// Build the delegated-admin usecase deps (port + audit + logger) — V1C-04 / ADR-0063.
// The usecase carries its own stub-shaped AuditEventPort (action string literals);
// this adapter maps those onto the canonical @platform/audit-events port so grants
// and revocations land in the same audit ledger as every other admin mutation.
const delegationLog = createLogger({ name: "delegations" });
const DELEGATION_AUDIT_ACTION: Record<string, string> = {
  "Delegation.Granted": AuditAction.DelegationGranted,
  "Delegation.Revoked": AuditAction.DelegationRevoked,
  "Delegation.Listed": AuditAction.DelegationListed,
};
async function buildDelegationDeps() {
  const { PostgresDelegatedAdminRoles } =
    await import("../adapters/postgres-delegated-admin-roles.ts");
  const pool = getApplicationPool();
  const realAudit = createPostgresAuditEventPort(pool);
  return {
    port: new PostgresDelegatedAdminRoles(pool),
    audit: {
      async emit(e: {
        action: string;
        actorId: string;
        organisationId: string | null;
        delegationId?: string;
      }): Promise<void> {
        await realAudit.emit(
          createAuditEvent({
            actorId: e.actorId,
            tenantId: e.organisationId ?? "",
            action: DELEGATION_AUDIT_ACTION[e.action] ?? e.action,
            resource: "delegated_admin_roles",
            resourceId: e.delegationId ?? "",
          })
        );
      },
    },
    logger: {
      async warn(w: {
        event: string;
        actorId: string;
        organisationId: string | null;
        reason: string;
      }): Promise<void> {
        delegationLog.warn(
          { actorId: w.actorId, organisationId: w.organisationId, reason: w.reason },
          w.event
        );
      },
    },
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
  if (loadPlatformApiConfig().rateLimitProvider.toLowerCase() !== "redis") {
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
  // V1C-CONF-04: provider selection is the EXPLICIT Tier-0 bootstrap root of trust — there is no
  // implicit OpenBao⇄builtin fallback. SECRET_STORE_PROVIDER=openbao without OPENBAO_ADDR/TOKEN now
  // fails closed (instead of silently degrading to the built-in store).
  const bootstrap = loadBootstrapSecretConfig();
  return createSecretStoreFromBootstrap(pool, bootstrap, (message, meta) =>
    secretStoreProviderLog.warn(meta, message)
  );
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

async function buildTenantLifecycleCoordinator(pool: ReturnType<typeof getApplicationPool>) {
  return {
    exportTenant: async (organisationId: string, actor: { actorId: string }) => {
      const [
        { buildPortableTenantExport },
        { getHistory },
        { listOrgMembers },
        { listTenantDomains },
      ] = await Promise.all([
        import("../usecases/data-portability.ts"),
        import("../usecases/history.ts"),
        import("../usecases/members.ts"),
        import("../usecases/tenant-domains.ts"),
      ]);
      const [history, members, domains] = await Promise.all([
        getHistory(organisationId, { limit: 200, offset: 0 }, await buildHistoryDeps()),
        listOrgMembers(organisationId, pool),
        listTenantDomains(organisationId, pool),
      ]);
      const archive = await buildPortableTenantExport(
        {
          tenantId: organisationId,
          sourceCommit: loadHealthMetadataConfig().gitSha || "unknown",
          entries: [
            { path: "identity/members.json", content: members, order: 1 },
            { path: "config/domains.json", content: domains, order: 2 },
            { path: "audit/history.json", content: history, order: 4 },
          ],
        },
        { secretStore: await selectSecretStore(pool), actorId: actor.actorId }
      );
      return { digest: archive.digest, keyRef: archive.keyRef };
    },
    suspendData: async (organisationId: string) => {
      await pool.query(`UPDATE public.organisations SET is_active = false WHERE id = $1`, [
        organisationId,
      ]);
    },
    suspendStorage: async (organisationId: string) => {
      await pool.query(
        `UPDATE public.storage_objects
            SET scan_state = 'quarantined', updated_at = now()
          WHERE organisation_id = $1 AND scan_state = 'clean'`,
        [organisationId]
      );
    },
    suspendRealm: async (organisationId: string) => {
      await pool.query(
        `UPDATE public.tenant_domains
            SET auth_client_status = 'inactive',
                auth_client_activated_at = NULL,
                routing_status = 'routing_unknown',
                routing_local_proven_at = NULL,
                routing_public_proven_at = NULL,
                canonical = false,
                canonical_at = NULL
          WHERE organisation_id = $1 AND disabled_at IS NULL`,
        [organisationId]
      );
    },
    suspendDsr: async (organisationId: string, actor: { actorId: string }) => {
      await pool.query(
        `INSERT INTO public.dsr_requests
           (organisation_id, subject_id, type, state, reason, created_by, fulfilled_by, fulfilled_at)
         VALUES ($1, 'tenant', 'portability', 'fulfilled', 'tenant lifecycle suspend checkpoint', NULL, NULL, now())`,
        [organisationId, actor.actorId]
      );
    },
    deleteData: async (organisationId: string) => {
      await pool.query(
        `UPDATE public.organisations
            SET is_active = false, deleted_at = COALESCE(deleted_at, now())
          WHERE id = $1`,
        [organisationId]
      );
    },
    deleteStorage: async (organisationId: string) => {
      await pool.query(`DELETE FROM public.storage_objects WHERE organisation_id = $1`, [
        organisationId,
      ]);
    },
    deleteRealm: async (organisationId: string) => {
      await pool.query(
        `UPDATE public.tenant_domains
            SET disabled_at = COALESCE(disabled_at, now()),
                auth_client_status = 'inactive',
                auth_client_activated_at = NULL,
                canonical = false,
                canonical_at = NULL
          WHERE organisation_id = $1 AND disabled_at IS NULL`,
        [organisationId]
      );
    },
    deleteDsr: async (organisationId: string) => {
      await pool.query(
        `INSERT INTO public.dsr_requests
           (organisation_id, subject_id, type, state, reason, created_by, fulfilled_by, fulfilled_at)
         VALUES ($1, 'tenant', 'erasure', 'fulfilled', 'tenant lifecycle delete checkpoint', NULL, NULL, now())`,
        [organisationId]
      );
    },
  };
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
  const ncfg = loadNotificationConfig();
  const emailOn = ncfg.emailTransport.toLowerCase() === "smtp";
  const webhookOn = ncfg.webhookTransport.toLowerCase() === "on";
  if (!emailOn && !webhookOn) return undefined;
  const { ConfiguredNotificationRecipientResolver, createEmailTransport, createWebhookTransport } =
    await import("../adapters/notification-transports.ts");
  const resolver = new ConfiguredNotificationRecipientResolver({
    emailDomain: ncfg.emailDomain,
    emailOverride: ncfg.emailOverride,
    webhookUrl: ncfg.webhookUrl,
  });
  const registry: import("../ports/notification-repository.ts").NotificationTransportRegistry = {};
  if (emailOn) {
    const { SmtpEmailAdapter } = await import("../adapters/smtp-email-adapter.ts");
    const email = new SmtpEmailAdapter({
      host: ncfg.smtpHost,
      port: ncfg.smtpPort,
      secure: false,
    });
    registry.email = createEmailTransport({
      resolver,
      email,
      from: {
        address: ncfg.fromEmail,
      },
      warn: (m, meta) => notificationProviderLog.warn(meta, m),
    });
  }
  if (webhookOn) {
    const { HttpWebhookDispatcher } = await import("../adapters/http-webhook-dispatcher.ts");
    registry.webhook = createWebhookTransport({
      resolver,
      dispatch: new HttpWebhookDispatcher(),
      secret: ncfg.webhookSecret,
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

const LockoutBodySchema = z.object({
  enabled: z.boolean(),
  maxFailureWaitSeconds: z.number().int().min(1),
  failureFactor: z.number().int().min(1),
  waitIncrementSeconds: z.number().int().min(1),
  quickLoginCheckMilliSeconds: z.number().int().min(1),
  minimumQuickLoginWaitSeconds: z.number().int().min(1),
  maxDeltaTimeSeconds: z.number().int().min(1),
  failureResetTimeSeconds: z.number().int().min(1),
  permanentLockout: z.boolean(),
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

// V1C-12c: request schemas for /api/admin/data/legal-holds (ADR-0064).
// resourceTable enum mirrors the HOLDABLE_TABLES constant in usecases/legal-hold.ts
// (audit_events + object_storage). The usecase re-validates + emits the audit;
// this schema is a defence-in-depth at the BFF boundary.
const SetLegalHoldBodySchema = z.object({
  organisationId: z.uuid("organisationId must be a valid UUID"),
  resourceTable: z.enum(["audit_events", "object_storage"]),
  rowId: z.string().min(1).max(256),
  reason: z.string().min(8).max(500),
});

const ReleaseLegalHoldBodySchema = z.object({
  organisationId: z.uuid("organisationId must be a valid UUID"),
  resourceTable: z.enum(["audit_events", "object_storage"]),
  rowId: z.string().min(1).max(256),
});

const SetRetentionPolicyBodySchema = z.object({
  organisationId: z.uuid("organisationId must be a valid UUID"),
  resourceTable: z.enum(["audit_events", "tenant_invitations"]),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(365 * 24 * 60 * 60),
  filter: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({
      kind: z.literal("by_status"),
      statuses: z.array(z.string().min(1).max(64)).min(1),
    }),
  ]),
});

const DisableRetentionPolicyBodySchema = z.object({
  organisationId: z.uuid("organisationId must be a valid UUID"),
  resourceTable: z.enum(["audit_events", "tenant_invitations"]),
});

const SetResidencyBodySchema = z.object({
  organisationId: z.uuid("organisationId must be a valid UUID"),
  residencyTag: z.string().min(2).max(64),
});

// V1C-04 delegated-admin grant body (ADR-0063). organisationId comes from the
// path; grantedBy/granterUserId are server-stamped from the actor, never the body.
const GrantDelegationBodySchema = z.object({
  granteeUserId: z.string().min(1).max(256),
  scope: z.string().min(1).max(128),
  expiresAt: z.iso.datetime({ message: "expiresAt must be an ISO-8601 timestamp" }).nullish(),
});

async function observeSpaShellRoute(
  _req: Parameters<Route["handler"]>[0],
  res: Parameters<Route["handler"]>[1]
): Promise<void> {
  res.raw.writeHead(204, {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
  res.raw.end();
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/",
    operationName: "spa.shell.index",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin",
    operationName: "spa.shell.admin",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/account",
    operationName: "spa.shell.admin.account",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/auth",
    operationName: "spa.shell.admin.auth",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/clickthrough",
    operationName: "spa.shell.admin.clickthrough",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/config",
    operationName: "spa.shell.admin.config",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/developer",
    operationName: "spa.shell.admin.developer",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/domains",
    operationName: "spa.shell.admin.domains",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/email",
    operationName: "spa.shell.admin.email",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/entitlements",
    operationName: "spa.shell.admin.entitlements",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/events",
    operationName: "spa.shell.admin.events",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/features",
    operationName: "spa.shell.admin.features",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/logs",
    operationName: "spa.shell.admin.logs",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/members",
    operationName: "spa.shell.admin.members",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/monitoring",
    operationName: "spa.shell.admin.monitoring",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/observability",
    operationName: "spa.shell.admin.observability",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/platform",
    operationName: "spa.shell.admin.platform",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/readiness",
    operationName: "spa.shell.admin.readiness",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/scheduled-jobs",
    operationName: "spa.shell.admin.scheduledJobs",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/search",
    operationName: "spa.shell.admin.search",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/storage",
    operationName: "spa.shell.admin.storage",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/usage",
    operationName: "spa.shell.admin.usage",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/admin/webhooks",
    operationName: "spa.shell.admin.webhooks",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/e2e-harness",
    operationName: "spa.shell.e2eHarness",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/login",
    operationName: "spa.shell.login",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/organisation/profile",
    operationName: "spa.shell.organisation.profile",
    handler: observeSpaShellRoute,
  },
  {
    method: "GET",
    path: "/healthz",
    handler: async (_req, res) => res.json(200, getHealth()),
  },
  {
    // Prometheus /metrics scrape endpoint (ADR-0062 / ADR-0020).
    // Compose-internal only — NOT routed through Caddy to external traffic.
    // No auth required; Prometheus scrapes this directly on the container port.
    method: "GET",
    path: "/metrics",
    handler: async (_req, res) => {
      res.raw.writeHead(200, {
        "Content-Type": metricsContentType(),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.raw.end(await getMetrics());
    },
  },
  {
    // Controlled synthetic-failure endpoint (ADR-ACT-0285 Phase 5). E2E uses this
    // to prove an intentional error is logged (http.request.failed) AND captured
    // to Sentry with the active trace context. GATED OFF by default and INVISIBLE
    // (404) unless E2E_FAILURE_ENDPOINT_ENABLED=true; in production it additionally
    // requires the explicit E2E_ALLOW_PROD_SYNTHETIC_FAILURE=true approval flag, so
    // it can never be triggered in prod by accident. Throws a TYPED UnexpectedError
    // (500) so the pipeline's catch logs + captures it (not a raw Error — #6).
    method: "POST",
    path: "/internal/e2e/trigger-failure",
    operationName: "e2e.synthetic.failure",
    handler: async (_req, res) => {
      const enabled = loadPlatformApiConfig().e2eFailureEndpointEnabled === "true";
      const isProd = (loadStageConfig().platformEnv ?? "") === "production";
      const prodApproved = loadPlatformApiConfig().e2eAllowProdSyntheticFailure === "true";
      if (!enabled || (isProd && !prodApproved)) {
        res.json(404, { code: "NOT_FOUND", message: "Not found" });
        return;
      }
      throw new UnexpectedError("api.error.e2eSyntheticFailure");
    },
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
    operationName: "session.get",
    handler: async (req, res) => {
      // Fixture session takes precedence (Tier 1 E2E determinism)
      const fixtureActor = getFixtureSession();
      if (fixtureActor) {
        res.json(200, fixtureActor);
        return;
      }
      // Real session: read from HTTP-only cookie(s) ? Redis. Try every presented
      // platform_session so a stale cookie cannot shadow a valid one (ADR-ACT-0278).
      const candidateIds = parseSessionCookies(req.raw.headers["cookie"]);
      if (candidateIds.length > 0) {
        try {
          const store = getSessionStore();
          for (const id of candidateIds) {
            const record = await store.find(id);
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
    auditEvent: AuditAction.UserLoggedOut,
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
      // Tenant-aware (ADR-0037): merge the tenant stored provider config over the
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
      const identity = classifyHostIdentity(host, loadPlatformApiConfig().apexDomain);
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
    auditEvent: AuditAction.AuthSettingsProvidersChanged,
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
    auditEvent: AuditAction.AuthSettingsIdpChanged,
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
    auditEvent: AuditAction.AuthSettingsIdpChanged,
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
    auditEvent: AuditAction.AuthSettingsIdpChanged,
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
    auditEvent: AuditAction.AuthSettingsIdpDiscoveryRequested,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const result = await importOidcDiscovery(req.body, {
        fetcher: createOidcHttpFetcher(),
        audit: createPostgresAuditEventPort(getApplicationPool()),
        actor: {
          organisationId: tenantCtx.organisationId,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          ipAddress: req.raw.socket.remoteAddress,
        },
      });
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
    auditEvent: AuditAction.AuthSettingsIdpTested,
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
    auditEvent: AuditAction.AuthSettingsIdpMappingChanged,
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
    auditEvent: AuditAction.AuthSettingsMfaChanged,
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
    path: "/api/auth/settings/lockout",
    operationName: "auth.settings.lockout.get",
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
      res.json(200, await adapter.getLockoutPolicy());
    },
  },
  {
    method: "PATCH",
    path: "/api/auth/settings/lockout",
    operationName: "auth.settings.lockout.set",
    requiresAuth: true,
    requiredPermission: "tenant.auth.settings.write",
    resource: "admin:auth",
    umaScope: "write" as const,
    auditEvent: AuditAction.AuthSettingsLockoutChanged,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      const result = await mutateAuthSetting(
        {
          rawBody: req.body,
          tenantCtx,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          auditAction: AuditAction.AuthSettingsLockoutChanged,
          buildAuditMetadata: buildLockoutAuditMetadata,
          schema: LockoutBodySchema,
          mutate: (body, cred) =>
            new KeycloakRealmAdminAdapter({
              url: getKeycloakConfigForRealm(tenantCtx!.realmName).url,
              realm: tenantCtx!.realmName,
              adminClientId: cred.clientId,
              adminClientSecret: cred.clientSecret,
            }).setLockoutPolicy(body),
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
    auditEvent: AuditAction.OrganisationUpdated,
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
    auditEvent: AuditAction.AuthSettingsCredentialAttached,
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
    auditEvent: AuditAction.AuthSettingsCredentialRotated,
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
    auditEvent: AuditAction.AuthSettingsCredentialRepaired,
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
    auditEvent: AuditAction.SupportSessionCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const SupportSessionRequestSchema = z.object({
        targetOrganisationId: z.uuid("targetOrganisationId must be a valid UUID"),
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
  {
    method: "POST",
    path: "/api/admin/support-session/approval-request",
    operationName: "admin.support-session.approval-request",
    requiresAuth: true,
    requiredPermission: "platform.admin.access",
    resource: "platform:support",
    umaScope: "enter" as const,
    auditEvent: AuditAction.SupportSessionCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const Schema = z.object({
        targetOrganisationId: z.uuid("targetOrganisationId must be a valid UUID"),
        supportAccessReason: z.string().min(1, "supportAccessReason must not be empty").max(500),
        workflowId: z.string().min(1, "workflowId must not be empty").max(200),
      });
      const parsed = Schema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const actor = req.actor!;
      const auditPort = createPostgresAuditEventPort(getApplicationPool());
      const workflowDeps = {
        workflows: workflowOrchestrator(),
      } as const;
      const result = await requestSupportApproval(
        {
          actorUserId: actor.userId,
          actorRoles: actor.roles,
          actorDisplayName: actor.displayName,
          targetOrganisationId: parsed.data.targetOrganisationId,
          targetTenantId: parsed.data.targetOrganisationId,
          supportAccessReason: parsed.data.supportAccessReason,
          workflowId: parsed.data.workflowId,
          sourceHost:
            (req.raw.headers["x-forwarded-host"] as string | undefined) ?? req.raw.headers["host"],
          ipAddress:
            (req.raw.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
            req.raw.socket?.remoteAddress,
        },
        { sessions: getSessionStore(), audit: auditPort, ...workflowDeps }
      );
      res.json(201, { workflowId: result.workflowId });
    },
  },
  {
    method: "POST",
    path: "/api/admin/support-session/approval-grant",
    operationName: "admin.support-session.approval-grant",
    requiresAuth: true,
    requiredPermission: "platform.admin.access",
    resource: "platform:support",
    umaScope: "enter" as const,
    auditEvent: AuditAction.SupportSessionCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const Schema = z.object({
        targetOrganisationId: z.uuid("targetOrganisationId must be a valid UUID"),
        supportAccessReason: z.string().min(1, "supportAccessReason must not be empty").max(500),
        workflowId: z.string().min(1, "workflowId must not be empty").max(200),
        approvedBy: z.string().min(1, "approvedBy must not be empty").max(200),
      });
      const parsed = Schema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const actor = req.actor!;
      const auditPort = createPostgresAuditEventPort(getApplicationPool());
      const workflowDeps = {
        workflows: workflowOrchestrator(),
      } as const;
      const result = await approveSupportApproval(
        {
          actorUserId: actor.userId,
          actorRoles: actor.roles,
          actorDisplayName: actor.displayName,
          targetOrganisationId: parsed.data.targetOrganisationId,
          targetTenantId: parsed.data.targetOrganisationId,
          supportAccessReason: parsed.data.supportAccessReason,
          workflowId: parsed.data.workflowId,
          approvedBy: parsed.data.approvedBy,
          sourceHost:
            (req.raw.headers["x-forwarded-host"] as string | undefined) ?? req.raw.headers["host"],
          ipAddress:
            (req.raw.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
            req.raw.socket?.remoteAddress,
        },
        { sessions: getSessionStore(), audit: auditPort, ...workflowDeps }
      );
      res.json(201, {
        supportSessionId: result.supportSessionId,
        targetOrganisationId: result.targetOrganisationId,
        supportAccessReason: result.supportAccessReason,
        expiresInSeconds: 3600,
      });
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
    auditEvent: AuditAction.AuthSettingsIdpChanged,
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
    auditEvent: AuditAction.VanityDomainAdded,
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
    auditEvent: AuditAction.VanityDomainRemoved,
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
    auditEvent: AuditAction.MemberInvited,
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
    auditEvent: AuditAction.MemberRoleChanged,
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
    auditEvent: AuditAction.MemberRemoved,
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
    auditEvent: AuditAction.MemberUsernameChanged,
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
    auditEvent: AuditAction.MemberStatusChanged,
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
    auditEvent: AuditAction.InvitationResent,
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
    auditEvent: AuditAction.GroupCreated,
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
    auditEvent: AuditAction.GroupUpdated,
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
    auditEvent: AuditAction.GroupDeleted,
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
    auditEvent: AuditAction.FeatureToggled,
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
    auditEvent: AuditAction.ConfigValueChanged,
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
    auditEvent: AuditAction.ConfigValueCleared,
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
    auditEvent: AuditAction.EmailSenderChanged,
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
    auditEvent: AuditAction.EmailSenderTested,
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
    auditEvent: AuditAction.VanityDomainChallengeCreated,
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
    auditEvent: AuditAction.VanityDomainVerified,
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
      const status = domainVerifyStatus(result.kind);
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
    auditEvent: AuditAction.TenantDomainDisabled,
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
      await createPostgresAuditEventPort(getApplicationPool()).emit(
        createAuditEvent({
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          tenantId: tenantCtx.organisationId,
          action: AuditAction.TenantDomainDisabled,
          resource: "tenant_domain",
          resourceId: domain,
          metadata: {
            domain,
            authClientStatus: record?.authClientStatus ?? "unknown",
            before: record?.disabledAt ? "disabled" : "enabled_or_unknown",
            after: "disabled",
          },
          correlationId: req.requestId,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        })
      );
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
    auditEvent: AuditAction.TenantDomainAuthClientActivated,
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
    auditEvent: AuditAction.TenantDomainAuthClientDeactivated,
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
    auditEvent: AuditAction.TenantDomainRoutingLocalProven,
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
    auditEvent: AuditAction.TenantDomainCanonicalSet,
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
        redirectActive: result.record.redirectPolicy !== "no_redirect",
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
    auditEvent: AuditAction.TenantDomainCanonicalUnset,
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
        redirectActive: result.record.redirectPolicy !== "no_redirect",
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
    auditEvent: AuditAction.StorageProbed,
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
  {
    method: "GET",
    path: "/api/org/storage/objects",
    operationName: "org.storage.objects.list",
    requiresAuth: true,
    requiredPermission: "tenant.storage.read",
    resource: "admin:storage",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) return res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      const repo = new PostgresStorageObjectRepository(getApplicationPool());
      res.json(200, await repo.listForTenant(tenantCtx.organisationId));
    },
  },
  {
    method: "POST",
    path: "/api/org/storage/objects",
    operationName: "org.storage.objects.create",
    requiresAuth: true,
    requiredPermission: "tenant.storage.write",
    resource: "admin:storage",
    umaScope: "write" as const,
    auditEvent: AuditAction.StorageObjectCreated,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) return res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      const body = z
        .object({
          objectKey: z.string().min(1),
          contentType: z.string().min(1),
          body: z.string().min(1),
        })
        .safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const { createStorageObject } = await import("../usecases/storage-objects.ts");
      const deps = await buildStorageObjectDeps(tenantCtx.organisationId);
      if (!deps) {
        res.json(503, { code: "STORAGE_NOT_CONFIGURED", message: "Storage not configured" });
        return;
      }
      const obj = await createStorageObject(
        { organisationId: tenantCtx.organisationId, actorId: req.actor!.userId, ...body.data },
        deps
      );
      res.json(201, obj);
    },
  },
  {
    method: "GET",
    path: "/api/org/storage/objects/:objectKey",
    operationName: "org.storage.objects.downloadUrl",
    requiresAuth: true,
    requiredPermission: "tenant.storage.read",
    resource: "admin:storage",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) return res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      const objectKey = decodeURIComponent(req.params["objectKey"] ?? "");
      const { getStorageObjectDownloadUrl } = await import("../usecases/storage-objects.ts");
      const deps = await buildStorageObjectDeps(tenantCtx.organisationId);
      if (!deps) {
        res.json(503, { code: "STORAGE_NOT_CONFIGURED", message: "Storage not configured" });
        return;
      }
      const result = await getStorageObjectDownloadUrl(
        tenantCtx.organisationId,
        objectKey,
        300,
        deps
      );
      if (!result) return res.json(404, { code: "NOT_FOUND", message: "Object not found" });
      res.json(200, result);
    },
  },
  {
    method: "POST",
    path: "/api/org/storage/objects/:objectKey/scan",
    operationName: "org.storage.objects.scan",
    requiresAuth: true,
    requiredPermission: "tenant.storage.write",
    resource: "admin:storage",
    umaScope: "write" as const,
    auditEvent: AuditAction.StorageObjectScanClean,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) return res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      const objectKey = decodeURIComponent(req.params["objectKey"] ?? "");
      const { scanStorageObject } = await import("../usecases/storage-objects.ts");
      const deps = await buildStorageObjectDeps(tenantCtx.organisationId);
      if (!deps) {
        res.json(503, { code: "STORAGE_NOT_CONFIGURED", message: "Storage not configured" });
        return;
      }
      const result = await scanStorageObject(
        tenantCtx.organisationId,
        objectKey,
        req.actor!.userId,
        deps
      );
      if (!result) return res.json(404, { code: "NOT_FOUND", message: "Object not found" });
      res.json(200, result);
    },
  },
  {
    method: "DELETE",
    path: "/api/org/storage/objects/:objectKey",
    operationName: "org.storage.objects.delete",
    requiresAuth: true,
    requiredPermission: "tenant.storage.write",
    resource: "admin:storage",
    umaScope: "write" as const,
    auditEvent: AuditAction.StorageObjectDeleted,
    scope: "tenant" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) return res.json(400, { code: "NO_TENANT", message: "No tenant context" });
      const objectKey = decodeURIComponent(req.params["objectKey"] ?? "");
      const { deleteStorageObject } = await import("../usecases/storage-objects.ts");
      const deps = await buildStorageObjectDeps(tenantCtx.organisationId);
      if (!deps) {
        res.json(503, { code: "STORAGE_NOT_CONFIGURED", message: "Storage not configured" });
        return;
      }
      await deleteStorageObject(tenantCtx.organisationId, objectKey, req.actor!.userId, deps);
      res.json(200, { deleted: true });
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
    auditEvent: AuditAction.WebhookCreated,
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
    auditEvent: AuditAction.WebhookUpdated,
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
    auditEvent: AuditAction.WebhookDeleted,
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
    auditEvent: AuditAction.WebhookSecretRotated,
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
    auditEvent: AuditAction.WebhookTested,
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
    auditEvent: AuditAction.WebhookRedriven,
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
    auditEvent: AuditAction.WebhookRedriven,
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
      const identity = classifyHostIdentity(host, loadPlatformApiConfig().apexDomain);
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
        redisConfigured: () => !!loadPlatformApiConfig().redisUrl,
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
    auditEvent: AuditAction.SubOrganisationCreated,
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
    method: "POST",
    path: "/api/admin/sub-tenants",
    operationName: "admin.sub-tenants.create",
    requiresAuth: true,
    requiredPermission: "tenant.suborgs.create",
    resource: "organisation:sub-organisations",
    umaScope: "create" as const,
    auditEvent: AuditAction.SubOrganisationCreated,
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
    auditEvent: AuditAction.SubOrganisationUpdated,
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
    auditEvent: AuditAction.SubOrganisationDeactivated,
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
    auditEvent: AuditAction.VanityDomainChallengeCreated,
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
    auditEvent: AuditAction.VanityDomainVerified,
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
    auditEvent: AuditAction.OrganisationUpdated,
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
    auditEvent: AuditAction.GraphqlOperationExecuted,
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
    auditEvent: AuditAction.EntitlementGranted,
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
  // ---------------------------------------------------------------------------
  // Delegated admin roles (V1C-04 / ADR-0063). Operator-scoped grant/list/revoke
  // of tenant-scoped delegated administration. deny-by-default + audited; a
  // tenant can never self-grant. The usecase enforces authority + fail-closed
  // scope validation; persistence runs under the documented auth wrappers.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/delegations",
    operationName: "admin.tenants.delegations.list",
    requiresAuth: true,
    requiredPermission: "platform.delegations.read",
    resource: "admin:delegations",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { makeDelegationsUseCases } = await import("../usecases/delegations.ts");
      const uc = makeDelegationsUseCases(await buildDelegationDeps());
      const result = await uc.listDelegationsForTenant(tenantId, {
        systemAdmin: req.actor!.roles.includes("system-admin"),
        tenantAdmin: req.actor!.roles.includes("tenant-admin"),
        userId: req.actor!.userId,
      });
      if (result.kind === "static_permission_denied") {
        res.json(403, { code: "FORBIDDEN", message: result.message });
        return;
      }
      res.json(200, { delegations: result.delegations });
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/delegations",
    operationName: "admin.tenants.delegations.grant",
    requiresAuth: true,
    requiredPermission: "platform.delegations.write",
    resource: "admin:delegations",
    umaScope: "write" as const,
    auditEvent: AuditAction.DelegationGranted,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = GrantDelegationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid delegation request",
        });
        return;
      }
      const { makeDelegationsUseCases } = await import("../usecases/delegations.ts");
      const uc = makeDelegationsUseCases(await buildDelegationDeps());
      const result = await uc.delegateGrant(
        {
          organisationId: tenantId,
          granterUserId: req.actor!.userId,
          granteeUserId: parsed.data.granteeUserId,
          grantedBy: req.actor!.userId,
          scope: parsed.data.scope,
          expiresAt: parsed.data.expiresAt ?? null,
        },
        {
          systemAdmin: req.actor!.roles.includes("system-admin"),
          tenantAdmin: req.actor!.roles.includes("tenant-admin"),
          userId: req.actor!.userId,
        }
      );
      if (result.kind === "static_permission_denied") {
        res.json(403, { code: "FORBIDDEN", message: result.message });
        return;
      }
      if (result.kind === "delegation_already_active") {
        res.json(409, { code: "CONFLICT", message: "Delegation already active" });
        return;
      }
      res.json(200, { delegation: result.delegation });
    },
  },
  {
    method: "DELETE",
    path: "/api/admin/tenants/:tenantId/delegations/:delegationId",
    operationName: "admin.tenants.delegations.revoke",
    requiresAuth: true,
    requiredPermission: "platform.delegations.write",
    resource: "admin:delegations",
    umaScope: "write" as const,
    auditEvent: AuditAction.DelegationRevoked,
    scope: "global" as const,
    handler: async (req, res) => {
      const delegationId = req.params["delegationId"] ?? "";
      if (!UUID_RE.test(delegationId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid delegation id" });
        return;
      }
      const { makeDelegationsUseCases } = await import("../usecases/delegations.ts");
      const uc = makeDelegationsUseCases(await buildDelegationDeps());
      const result = await uc.delegateRevoke(delegationId, {
        systemAdmin: req.actor!.roles.includes("system-admin"),
        tenantAdmin: req.actor!.roles.includes("tenant-admin"),
        userId: req.actor!.userId,
      });
      if (result.kind === "static_permission_denied") {
        res.json(403, { code: "FORBIDDEN", message: result.message });
        return;
      }
      if (result.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Delegation not found" });
        return;
      }
      res.json(200, { revoked: true });
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
    auditEvent: AuditAction.MeterEventRecorded,
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
        await createPostgresAuditEventPort(getApplicationPool()).emit(
          createAuditEvent({
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            tenantId,
            action: AuditAction.MeterEventRecorded,
            resource: "meter_event",
            resourceId: parsed.data.idempotencyKey,
            metadata: {
              meterKey: parsed.data.meterKey,
              quantity: parsed.data.quantity,
              subjectId: parsed.data.subjectId,
              source: parsed.data.source,
              occurredAt: parsed.data.occurredAt,
              before: "not_recorded_or_deduplicated",
              after: "recorded_or_deduplicated",
            },
            correlationId: req.requestId,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          })
        );
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
    auditEvent: AuditAction.QuotaSet,
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
    auditEvent: AuditAction.ApiKeyCreated,
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
    auditEvent: AuditAction.ApiKeyRevoked,
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
    auditEvent: AuditAction.RateLimitSet,
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
    auditEvent: AuditAction.SearchQueried,
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
            await buildSearchDeps(),
            {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            }
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
    auditEvent: AuditAction.SearchReindexed,
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
    auditEvent: AuditAction.EventRedriven,
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
    // "me" is a SELF resource — readable wherever the user is authenticated, not
    // host-gated. A system-admin has no tenant FQDN; without dropping the tenant
    // scope their own Account page 403s on the apex (ADR-ACT-0278).
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      // No tenant context (system-admin on the apex / operator without an org):
      // return an identity-derived default so the Account page renders instead of
      // failing. Tenant users get their tenant-scoped profile as before.
      if (!tenantCtx) {
        res.json(200, {
          displayName: req.actor!.displayName ?? "",
          locale: "en-GB",
          timezone: "UTC",
        });
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
    auditEvent: AuditAction.ProfileUpdated,
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
    // Self resource — not host-gated (see me:profile GET). System-admin without a
    // tenant gets an empty set so the Account page renders (ADR-ACT-0278).
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool());
      if (!tenantCtx) {
        res.json(200, { preferences: [] });
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
    auditEvent: AuditAction.NotificationPreferencesChanged,
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
    auditEvent: AuditAction.NotificationTested,
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
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/announcements",
    operationName: "admin.announcements.create",
    requiresAuth: true,
    requiredPermission: "platform.notifications.write",
    resource: "admin:notifications",
    umaScope: "write" as const,
    auditEvent: AuditAction.NotificationTested,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const parsed = z
        .object({
          subject: z.string().min(1).max(200),
          message: z.string().min(1).max(2000),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid announcement",
        });
        return;
      }
      const { createSupportAnnouncement } = await import("../usecases/support-announcements.ts");
      const pool = getApplicationPool();
      const { listOrgMembers } = await import("../usecases/members.ts");
      const { dispatchNotification } = await import("../usecases/notifications.ts");
      const notifDeps = await buildNotificationsDeps();
      const announcement = await createSupportAnnouncement(
        {
          idempotencyKey: req.requestId,
          organisationId: tenantId,
          subject: parsed.data.subject,
          message: parsed.data.message,
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
        },
        { pool, audit: createPostgresAuditEventPort(pool) }
      );
      const members = (await listOrgMembers(tenantId, pool)).members;
      let delivered = 0;
      let suppressed = 0;
      for (const member of members) {
        const results = await dispatchNotification(
          {
            organisationId: tenantId,
            userId: member.userId,
            category: "system",
            subject: parsed.data.subject,
            payload: { message: parsed.data.message, announcement: true },
          },
          notifDeps,
          { operator: true }
        );
        for (const r of results) {
          if (r.status === "sent") delivered += 1;
          if (r.status === "suppressed") suppressed += 1;
        }
      }
      res.json(201, {
        id: announcement.id,
        tenantId,
        subject: parsed.data.subject,
        delivered,
        suppressed,
      });
    },
  },
  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/announcements",
    operationName: "admin.announcements.list",
    requiresAuth: true,
    requiredPermission: "platform.notifications.read",
    resource: "admin:notifications",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listSupportAnnouncements } = await import("../usecases/support-announcements.ts");
      const pool = getApplicationPool();
      const items = await listSupportAnnouncements(tenantId, {
        pool,
        audit: createPostgresAuditEventPort(pool),
      });
      res.json(200, { items });
    },
  },
  {
    method: "POST",
    path: "/api/admin/support/tickets",
    operationName: "admin.support.tickets.create",
    requiresAuth: true,
    requiredPermission: "platform.support.write",
    resource: "admin:support",
    umaScope: "write" as const,
    auditEvent: AuditAction.NotificationTested,
    scope: "global" as const,
    handler: async (req, res) => {
      const parsed = z
        .object({
          organisationId: z.uuid(),
          subject: z.string().min(1).max(200),
          body: z.string().min(1).max(2000),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const pool = getApplicationPool();
      const { createSupportTicket } = await import("../usecases/support-tickets.ts");
      res.json(
        201,
        await createSupportTicket(
          {
            ...parsed.data,
            idempotencyKey: req.requestId,
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
          },
          { pool, audit: createPostgresAuditEventPort(pool) }
        )
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/support/tickets",
    operationName: "admin.support.tickets.list",
    requiresAuth: true,
    requiredPermission: "platform.support.read",
    resource: "admin:support",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { listSupportTickets } = await import("../usecases/support-tickets.ts");
      res.json(200, {
        items: await listSupportTickets(organisationId, { pool: getApplicationPool() }),
      });
    },
  },
  {
    method: "GET",
    path: "/api/admin/support/health",
    operationName: "admin.support.health",
    requiresAuth: true,
    requiredPermission: "platform.support.read",
    resource: "admin:support",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const organisationId =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(organisationId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const { getCustomerHealth } = await import("../usecases/support-tickets.ts");
      res.json(200, await getCustomerHealth(organisationId, { pool: getApplicationPool() }));
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
    auditEvent: AuditAction.AlertRuleSet,
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
    auditEvent: AuditAction.IncidentOpened,
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
    auditEvent: AuditAction.IncidentUpdated,
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
    path: "/api/admin/observability",
    operationName: "admin.observability.get",
    requiresAuth: true,
    requiredPermission: "platform.observability.read",
    resource: "admin:observability",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getObservabilityControlReport } =
        await import("../usecases/observability-control.ts");
      res.json(200, await getObservabilityControlReport());
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
  {
    method: "GET",
    path: "/api/admin/backup",
    operationName: "admin.backup.get",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:backup",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getBackupControlReport } = await import("../usecases/backup-control.ts");
      res.json(200, await getBackupControlReport());
    },
  },
  {
    method: "GET",
    path: "/api/admin/security",
    operationName: "admin.security.get",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:security",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getSecurityControlReport } = await import("../usecases/security-control.ts");
      res.json(200, await getSecurityControlReport());
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
    auditEvent: AuditAction.ScheduledJobSet,
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
    auditEvent: AuditAction.ScheduledJobRun,
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
    auditEvent: AuditAction.ScheduledJobSet,
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
    auditEvent: AuditAction.SecretRefCreated,
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
    auditEvent: AuditAction.SecretRefRevoked,
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
    auditEvent: AuditAction.SecretRefDeleted,
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
    auditEvent: AuditAction.ProviderConfigSet,
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
    auditEvent: AuditAction.ProviderConfigSet,
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
      await createPostgresAuditEventPort(getApplicationPool()).emit(
        createAuditEvent({
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          tenantId: req.actor!.userId,
          action: AuditAction.ProviderConfigSet,
          resource: "provider_config",
          resourceId: id,
          metadata: { lifecycleState: parsed.data.lifecycleState },
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        })
      );
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
    auditEvent: AuditAction.ProviderConfigDeleted,
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
  {
    method: "GET",
    path: "/api/admin/provider-bindings",
    operationName: "admin.providerBindings.get",
    requiresAuth: true,
    requiredPermission: "platform.providers.read",
    resource: "admin:provider_configs",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { buildProviderBindingReport } = await import("../usecases/provider-binding-report.ts");
      const environment =
        new URL(req.raw.url ?? "", "http://localhost").searchParams.get("environment") ??
        "development";
      const env = environment as "development" | "test" | "staging" | "production";
      const report = await buildProviderBindingReport({
        environment: env,
        providerConfigs: await buildProviderConfigDeps(),
      });
      res.json(200, report);
    },
  },
  // ---------------------------------------------------------------------------
  // Click-through services (ADR-ACT-0233 / ADR-0072). Operator's view of the composed
  // Compose GUI services: click-through URL, access gating (same decision as the
  // forward-auth gate), isolation invariant, and OpenBao-credential-validated
  // readiness. Read-only; never returns a secret.
  // ---------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/admin/clickthrough",
    operationName: "admin.clickthrough.list",
    requiresAuth: true,
    requiredPermission: "platform.providers.read",
    resource: "admin:provider_configs",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { listClickthroughServices } = await import("../usecases/clickthrough-services.ts");
      res.json(200, await listClickthroughServices({ roles: req.actor?.roles ?? [] }));
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

  {
    method: "GET",
    path: "/api/admin/tenants/:tenantId/export",
    operationName: "admin.tenants.export",
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
      const pool = getApplicationPool();
      const [{ getHistory }, { listOrgMembers }, { listTenantDomains }] = await Promise.all([
        import("../usecases/history.ts"),
        import("../usecases/members.ts"),
        import("../usecases/tenant-domains.ts"),
      ]);
      const [history, members, domains] = await Promise.all([
        getHistory(tenantId, { limit: 200, offset: 0 }, await buildHistoryDeps()),
        listOrgMembers(tenantId, pool),
        listTenantDomains(tenantId, pool),
      ]);
      const { buildPortableTenantExport } = await import("../usecases/data-portability.ts");
      const archive = await buildPortableTenantExport(
        {
          tenantId,
          sourceCommit: loadHealthMetadataConfig().gitSha || "unknown",
          entries: [
            { path: "identity/members.json", content: members, order: 1 },
            { path: "config/domains.json", content: domains, order: 2 },
            { path: "audit/history.json", content: history, order: 4 },
          ],
        },
        { secretStore: await selectSecretStore(pool), actorId: req.actor!.userId }
      );
      res.json(200, {
        tenantId,
        archive: archive.archive.toString("base64"),
        digest: archive.digest,
        keyRef: archive.keyRef,
        manifest: archive.manifest,
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/import",
    operationName: "admin.tenants.import",
    requiresAuth: true,
    requiredPermission: "platform.audit.read_all",
    resource: "admin:history",
    umaScope: "write" as const,
    auditEvent: AuditAction.TenantImportApplied,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const body = z.object({ archive: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
        return;
      }
      const { applyPortableTenantImport, verifyPortableTenantArchive } =
        await import("../usecases/data-portability.ts");
      const { PostgresPortableTenantImportApplier } =
        await import("../adapters/postgres-portable-tenant-import-applier.ts");
      const archive = Buffer.from(body.data.archive, "base64");
      const pool = getApplicationPool();
      const secretStore = await selectSecretStore(pool);
      const { manifest, digest } = await verifyPortableTenantArchive(archive, {
        tenantId,
        secretStore,
      });
      await createPostgresAuditEventPort(pool).emit(
        createAuditEvent({
          actorId: req.actor!.userId,
          actorRoles: req.actor!.roles,
          tenantId,
          action: AuditAction.TenantImportApplied,
          resource: "tenant_import",
          resourceId: digest,
          metadata: {
            schemaVersion: manifest.schemaVersion,
            entries: manifest.entries.length,
            sourceCommit: manifest.sourceCommit,
            before: "portable_import_not_applied_or_resumable",
            after: "portable_import_apply_requested",
          },
          correlationId: req.requestId,
          sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
        })
      );
      const existing = await pool.query<{
        completed_orders: number[];
        failed_order: number | null;
        error: string | null;
      }>(
        `SELECT completed_orders, failed_order, error
           FROM public.portable_import_progress
          WHERE organisation_id = $1 AND archive_digest = $2`,
        [tenantId, digest]
      );
      const previous = existing.rows[0];
      const progress = await applyPortableTenantImport(archive, {
        tenantId,
        secretStore,
        applier: new PostgresPortableTenantImportApplier(pool, tenantId, digest),
        ...(previous
          ? {
              resume: {
                completedOrders: previous.completed_orders,
                ...(previous.failed_order != null ? { failedOrder: previous.failed_order } : {}),
                ...(previous.error != null ? { error: previous.error } : {}),
              },
            }
          : {}),
      });
      res.json(200, {
        tenantId,
        verified: true,
        imported: progress.failedOrder == null,
        digest,
        progress,
        schemaVersion: manifest.schemaVersion,
        entries: manifest.entries.length,
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/suspend",
    operationName: "admin.tenants.suspend",
    requiresAuth: true,
    requiredPermission: "platform.tenants.delete",
    resource: "admin:tenants",
    umaScope: "delete" as const,
    auditEvent: AuditAction.OrganisationUpdated,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const pool = getApplicationPool();
      res.json(
        200,
        await suspendTenant(
          tenantId,
          { actorId: req.actor!.userId, actorRoles: req.actor!.roles },
          {
            pool,
            audit: createPostgresAuditEventPort(pool),
            coordinator: await buildTenantLifecycleCoordinator(pool),
          }
        )
      );
    },
  },
  {
    method: "POST",
    path: "/api/admin/tenants/:tenantId/delete",
    operationName: "admin.tenants.delete",
    requiresAuth: true,
    requiredPermission: "platform.tenants.delete",
    resource: "admin:tenants",
    umaScope: "delete" as const,
    auditEvent: AuditAction.OrganisationUpdated,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantId = req.params["tenantId"] ?? "";
      if (!UUID_RE.test(tenantId)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "Invalid tenant id" });
        return;
      }
      const pool = getApplicationPool();
      res.json(
        200,
        await deleteTenant(
          tenantId,
          { actorId: req.actor!.userId, actorRoles: req.actor!.roles },
          {
            pool,
            audit: createPostgresAuditEventPort(pool),
            coordinator: await buildTenantLifecycleCoordinator(pool),
          }
        )
      );
    },
  },
  // -------------------------------------------------------------------
  // V1C-12c Legal Hold operator routes (ADR-0064 / V1C-12c, decisionRef V1C-12c).
  // Sole platform owner of legal hold; sole consumer seam for retention (V1C-12b)
  // and object storage (V1C-15). Audit-before-change on every set/release.
  // -------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/data/legal-holds",
    operationName: "admin.data.legalHold.set",
    requiresAuth: true,
    requiredPermission: "platform.data.write",
    resource: "admin:data",
    umaScope: "write" as const,
    auditEvent: AuditAction.LegalHoldSet,
    scope: "global" as const,
    handler: async (req, res) => {
      const { setLegalHold } = await import("../usecases/legal-hold.ts");
      const { PostgresLegalHoldRepository } = await import("../adapters/postgres-legal-hold.ts");
      const parsed = SetLegalHoldBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const r = await setLegalHold(
        {
          organisationId: parsed.data.organisationId,
          resourceTable: parsed.data.resourceTable,
          rowId: parsed.data.rowId,
          reason: parsed.data.reason,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          repository: new PostgresLegalHoldRepository(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (r.kind === "invalid") {
        res.json(400, { code: "VALIDATION_ERROR", message: r.message });
        return;
      }
      res.json(201, r.hold);
    },
  },
  {
    method: "DELETE",
    path: "/api/admin/data/legal-holds",
    operationName: "admin.data.legalHold.release",
    requiresAuth: true,
    requiredPermission: "platform.data.write",
    resource: "admin:data",
    umaScope: "delete" as const,
    auditEvent: AuditAction.LegalHoldReleased,
    scope: "global" as const,
    handler: async (req, res) => {
      const { releaseLegalHold } = await import("../usecases/legal-hold.ts");
      const { PostgresLegalHoldRepository } = await import("../adapters/postgres-legal-hold.ts");
      const parsed = ReleaseLegalHoldBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const r = await releaseLegalHold(
        {
          organisationId: parsed.data.organisationId,
          resourceTable: parsed.data.resourceTable,
          rowId: parsed.data.rowId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          repository: new PostgresLegalHoldRepository(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (r.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Legal hold not found" });
        return;
      }
      res.json(200, r.hold);
    },
  },
  {
    method: "GET",
    path: "/api/admin/data/legal-holds",
    operationName: "admin.data.legalHold.list",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:data",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { listLegalHoldsAsOperator } = await import("../usecases/legal-hold.ts");
      const { PostgresLegalHoldRepository } = await import("../adapters/postgres-legal-hold.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const org = url.searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(org)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "organisationId must be a UUID" });
        return;
      }
      const list = await listLegalHoldsAsOperator(org, {
        repository: new PostgresLegalHoldRepository(getApplicationPool()),
        audit: createPostgresAuditEventPort(getApplicationPool()),
      });
      res.json(200, { holds: list });
    },
  },
  // -------------------------------------------------------------------
  // V1C-12b Retention operator routes (ADR-0064 / V1C-12b, decisionRef V1C-12b).
  // Sole platform owner of retention policy lifecycle. CONSUMES the legal-hold
  // flag (V1C-12c) — the tick is the central seam where held rows are preserved
  // (decisionRef V1C-12b invariant). Audit-before-change on set/disable. The
  // tick itself is owned by a scheduled internal worker, NOT a BFF route (it
  // has no human actor; a BFF tick would put caller-token attribution onto a
  // job whose actor is the scheduler).
  // -------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/admin/data/retention-policies",
    operationName: "admin.data.retentionPolicy.set",
    requiresAuth: true,
    requiredPermission: "platform.data.write",
    resource: "admin:data",
    umaScope: "write" as const,
    auditEvent: AuditAction.RetentionPolicySet,
    scope: "global" as const,
    handler: async (req, res) => {
      const { setRetentionPolicy } = await import("../usecases/retention.ts");
      const { PostgresRetentionRepository } = await import("../adapters/postgres-retention.ts");
      const parsed = SetRetentionPolicyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const r = await setRetentionPolicy(
        {
          organisationId: parsed.data.organisationId,
          resourceTable: parsed.data.resourceTable,
          ttlSeconds: parsed.data.ttlSeconds,
          filter: parsed.data.filter,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          repository: new PostgresRetentionRepository(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          guard: {
            repository: new (
              await import("../adapters/postgres-legal-hold.ts")
            ).PostgresLegalHoldRepository(getApplicationPool()),
          },
        }
      );
      if (r.kind === "invalid") {
        res.json(400, { code: "VALIDATION_ERROR", message: r.message });
        return;
      }
      res.json(201, r.policy);
    },
  },
  {
    method: "DELETE",
    path: "/api/admin/data/retention-policies",
    operationName: "admin.data.retentionPolicy.disable",
    requiresAuth: true,
    requiredPermission: "platform.data.write",
    resource: "admin:data",
    umaScope: "delete" as const,
    auditEvent: AuditAction.RetentionPolicyRemoved,
    scope: "global" as const,
    handler: async (req, res) => {
      const { disableRetentionPolicy } = await import("../usecases/retention.ts");
      const { PostgresRetentionRepository } = await import("../adapters/postgres-retention.ts");
      const parsed = DisableRetentionPolicyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const r = await disableRetentionPolicy(
        {
          organisationId: parsed.data.organisationId,
          resourceTable: parsed.data.resourceTable,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          repository: new PostgresRetentionRepository(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          guard: {
            repository: new (
              await import("../adapters/postgres-legal-hold.ts")
            ).PostgresLegalHoldRepository(getApplicationPool()),
          },
        }
      );
      if (r.kind === "not_found") {
        res.json(404, { code: "NOT_FOUND", message: "Retention policy not found" });
        return;
      }
      res.json(200, r.policy);
    },
  },
  {
    method: "GET",
    path: "/api/admin/data/retention-policies",
    operationName: "admin.data.retentionPolicy.list",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:data",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { listRetentionPoliciesAsOperator } = await import("../usecases/retention.ts");
      const { PostgresRetentionRepository } = await import("../adapters/postgres-retention.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const org = url.searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(org)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "organisationId must be a UUID" });
        return;
      }
      const policies = await listRetentionPoliciesAsOperator(org, {
        repository: new PostgresRetentionRepository(getApplicationPool()),
        audit: createPostgresAuditEventPort(getApplicationPool()),
        guard: {
          repository: new (
            await import("../adapters/postgres-legal-hold.ts")
          ).PostgresLegalHoldRepository(getApplicationPool()),
        },
      });
      res.json(200, { policies });
    },
  },
  {
    method: "GET",
    path: "/api/admin/data/compliance-report",
    operationName: "admin.data.complianceReport.get",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:data",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { generateComplianceReport } = await import("../usecases/compliance-report.ts");
      const { PostgresLegalHoldRepository } = await import("../adapters/postgres-legal-hold.ts");
      const { PostgresRetentionRepository } = await import("../adapters/postgres-retention.ts");
      const { PostgresObservabilityRepository } =
        await import("../adapters/postgres-observability-repository.ts");
      const { getTenantStorageReadiness } = await import("../usecases/tenant-storage.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const org = url.searchParams.get("organisationId") ?? "";
      if (!UUID_RE.test(org)) {
        res.json(400, { code: "VALIDATION_ERROR", message: "organisationId must be a UUID" });
        return;
      }
      const report = await generateComplianceReport(org, {
        metrics: new PostgresObservabilityRepository(getApplicationPool()),
        incidents: new PostgresObservabilityRepository(getApplicationPool()),
        legalHolds: new PostgresLegalHoldRepository(getApplicationPool()),
        retention: new PostgresRetentionRepository(getApplicationPool()),
        storage: await getTenantStorageReadiness(buildStorageReadinessDeps(org)),
      });
      res.json(200, report);
    },
  },
  {
    method: "POST",
    path: "/api/admin/data/residency",
    operationName: "admin.data.residency.set",
    requiresAuth: true,
    requiredPermission: "platform.data.write",
    resource: "admin:data",
    umaScope: "write" as const,
    auditEvent: AuditAction.OrganisationUpdated,
    scope: "global" as const,
    handler: async (req, res) => {
      const { setTenantResidency } = await import("../usecases/data-residency.ts");
      const parsed = SetResidencyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        });
        return;
      }
      const r = await setTenantResidency(
        {
          organisationId: parsed.data.organisationId,
          residencyTag: parsed.data.residencyTag,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          repository: {
            async getResidencyTag(orgId: string): Promise<string | null> {
              const { rows } = await getApplicationPool().query<{ residency_tag: string | null }>(
                "SELECT residency_tag FROM public.organisations WHERE id = $1 LIMIT 1",
                [orgId]
              );
              return rows[0]?.residency_tag ?? null;
            },
            async setResidencyTag(orgId: string, residencyTag: string): Promise<void> {
              await getApplicationPool().query(
                "UPDATE public.organisations SET residency_tag = $2, updated_at = now() WHERE id = $1",
                [orgId, residencyTag]
              );
            },
          },
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      if (r.kind === "invalid") {
        res.json(400, { code: "VALIDATION_ERROR", message: r.message });
        return;
      }
      res.json(200, { organisationId: parsed.data.organisationId, residencyTag: r.residencyTag });
    },
  },
  {
    method: "GET",
    path: "/api/admin/billing/readiness",
    operationName: "admin.billing.readiness",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:billing",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getBillingBoundaryReadiness } = await import("../usecases/billing-readiness.ts");
      res.json(200, await getBillingBoundaryReadiness());
    },
  },
  {
    method: "GET",
    path: "/api/admin/billing",
    operationName: "admin.billing.get",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:billing",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getBillingControlReport } = await import("../usecases/billing-control.ts");
      res.json(200, await getBillingControlReport());
    },
  },
  {
    method: "GET",
    path: "/api/admin/billing/catalog/products",
    operationName: "admin.billing.catalog.products.list",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { listBillingCatalogProducts } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      res.json(200, {
        products: await listBillingCatalogProducts({
          catalog: new PostgresBillingCatalogAdapter(getApplicationPool()),
        }),
      });
    },
  },
  {
    method: "GET",
    path: "/api/org/billing/catalog",
    operationName: "org.billing.catalog.get",
    requiresAuth: true,
    requiredPermission: "tenant.billing.read",
    resource: "tenant:billing",
    umaScope: "read" as const,
    scope: "tenant" as const,
    handler: async (_req, res) => {
      const { listBillingCatalogProducts, listBillingCatalogPlans, listBillingCatalogPrices } =
        await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const catalog = new PostgresBillingCatalogAdapter(getApplicationPool());
      res.json(200, {
        products: await listBillingCatalogProducts({ catalog }),
        plans: await listBillingCatalogPlans({ catalog }),
        prices: await listBillingCatalogPrices({ catalog }),
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/billing/catalog/products",
    operationName: "admin.billing.catalog.products.create",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "write" as const,
    auditEvent: AuditAction.BillingCatalogProductCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const { CreateBillingProductRequestSchema } = await import("@platform/contracts-admin");
      const { createBillingCatalogProduct } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const body = CreateBillingProductRequestSchema.safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const product = await createBillingCatalogProduct(
        {
          ...body.data,
          actorId: req.actor!.userId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          catalog: new PostgresBillingCatalogAdapter(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      res.json(201, { product });
    },
  },
  {
    method: "GET",
    path: "/api/admin/billing/catalog/plans",
    operationName: "admin.billing.catalog.plans.list",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { listBillingCatalogPlans } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const productId = url.searchParams.get("productId") ?? undefined;
      res.json(200, {
        plans: await listBillingCatalogPlans(
          { catalog: new PostgresBillingCatalogAdapter(getApplicationPool()) },
          productId
        ),
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/billing/catalog/plans",
    operationName: "admin.billing.catalog.plans.create",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "write" as const,
    auditEvent: AuditAction.BillingCatalogPlanCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const { CreateBillingPlanRequestSchema } = await import("@platform/contracts-admin");
      const { createBillingCatalogPlan } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const body = CreateBillingPlanRequestSchema.safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const plan = await createBillingCatalogPlan(
        {
          ...body.data,
          actorId: req.actor!.userId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          catalog: new PostgresBillingCatalogAdapter(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      res.json(201, { plan });
    },
  },
  {
    method: "GET",
    path: "/api/admin/billing/catalog/prices",
    operationName: "admin.billing.catalog.prices.list",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { listBillingCatalogPrices } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const planId = url.searchParams.get("planId") ?? undefined;
      res.json(200, {
        prices: await listBillingCatalogPrices(
          { catalog: new PostgresBillingCatalogAdapter(getApplicationPool()) },
          planId
        ),
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/billing/catalog/prices",
    operationName: "admin.billing.catalog.prices.create",
    requiresAuth: true,
    requiredPermission: "platform.billing.*",
    resource: "admin:billing",
    umaScope: "write" as const,
    auditEvent: AuditAction.BillingCatalogPriceCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const { CreateBillingPriceRequestSchema } = await import("@platform/contracts-admin");
      const { createBillingCatalogPrice } = await import("../usecases/billing-catalog.ts");
      const { PostgresBillingCatalogAdapter } =
        await import("../adapters/postgres-billing-catalog.ts");
      const body = CreateBillingPriceRequestSchema.safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const price = await createBillingCatalogPrice(
        {
          ...body.data,
          actorId: req.actor!.userId,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
          },
        },
        {
          catalog: new PostgresBillingCatalogAdapter(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
        }
      );
      res.json(201, { price });
    },
  },
  {
    method: "GET",
    path: "/api/admin/governance/catalog",
    operationName: "admin.governance.catalog.list",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      res.json(200, {
        datasets: await port.listDatasets(),
        classifications: await port.listClassifications(),
      });
    },
  },
  {
    method: "POST",
    path: "/api/admin/governance/catalog",
    operationName: "admin.governance.catalog.create",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "write" as const,
    auditEvent: AuditAction.DataGovernanceDatasetCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const body = z
        .object({
          owner: z.string().min(1),
          classification: z.enum(["none", "pii", "sensitive"]),
          lineageEdges: z.array(z.string()).optional(),
        })
        .safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      const { createDataset } = await import("../usecases/data-governance.ts");
      res.json(
        201,
        await createDataset(
          {
            ...body.data,
            actorId: req.actor!.userId,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          { port, audit: createPostgresAuditEventPort(getApplicationPool()) }
        )
      );
    },
  },
  {
    method: "POST",
    path: "/api/admin/governance/catalog/classify",
    operationName: "admin.governance.catalog.classify",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "write" as const,
    auditEvent: AuditAction.DataGovernanceColumnClassified,
    scope: "global" as const,
    handler: async (req, res) => {
      const body = z
        .object({
          datasetId: z.uuid(),
          columnName: z.string().min(1),
          sampleValue: z.string().min(1),
        })
        .safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      const { classifyColumn } = await import("../usecases/data-governance.ts");
      res.json(
        201,
        await classifyColumn(
          {
            ...body.data,
            actorId: req.actor!.userId,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          { port, audit: createPostgresAuditEventPort(getApplicationPool()) }
        )
      );
    },
  },
  {
    method: "GET",
    path: "/api/admin/governance/dsr",
    operationName: "admin.governance.dsr.list",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const tenantCtx = await resolveTenantFromRequest(req.raw, getApplicationPool()).catch(
        () => null
      );
      if (!tenantCtx) {
        res.json(400, { code: "NO_TENANT", message: "No tenant context" });
        return;
      }
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      res.json(200, await port.listDsrs(tenantCtx.organisationId));
    },
  },
  {
    method: "POST",
    path: "/api/admin/governance/dsr",
    operationName: "admin.governance.dsr.create",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "write" as const,
    auditEvent: AuditAction.DataGovernanceDsrCreated,
    scope: "global" as const,
    handler: async (req, res) => {
      const body = z
        .object({
          organisationId: z.uuid(),
          subjectId: z.string().min(1),
          type: z.enum(["access", "erasure", "portability"]),
          reason: z.string().min(8),
        })
        .safeParse(req.body);
      if (!body.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: body.error.message });
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      const { createDsr } = await import("../usecases/data-governance.ts");
      res.json(
        201,
        await createDsr(
          {
            ...body.data,
            actorId: req.actor!.userId,
            actor: {
              actorId: req.actor!.userId,
              actorRoles: req.actor!.roles,
              sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
            },
          },
          { port, audit: createPostgresAuditEventPort(getApplicationPool()) }
        )
      );
    },
  },
  {
    method: "POST",
    path: "/api/admin/governance/dsr/:dsrId/fulfill",
    operationName: "admin.governance.dsr.fulfill",
    requiresAuth: true,
    requiredPermission: "platform.governance.*",
    resource: "admin:governance",
    umaScope: "write" as const,
    auditEvent: AuditAction.DataGovernanceDsrFulfilled,
    scope: "global" as const,
    handler: async (req, res) => {
      const params = z.object({ dsrId: z.uuid() }).safeParse(req.params);
      if (!params.success)
        return res.json(400, { code: "VALIDATION_ERROR", message: params.error.message });
      const port = new PostgresDataGovernanceAdapter(getApplicationPool());
      const { fulfillDsr } = await import("../usecases/data-governance.ts");
      try {
        res.json(
          200,
          await fulfillDsr(
            {
              dsrId: params.data.dsrId,
              actorId: req.actor!.userId,
              actor: {
                actorId: req.actor!.userId,
                actorRoles: req.actor!.roles,
                sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
              },
            },
            { port, audit: createPostgresAuditEventPort(getApplicationPool()) }
          )
        );
      } catch (err) {
        res.json(409, {
          code: "DSR_FULFILLMENT_FAILED",
          message: err instanceof Error ? err.message : "DSR fulfilment failed",
        });
      }
    },
  },
  {
    method: "GET",
    path: "/api/admin/workflows/readiness",
    operationName: "admin.workflows.readiness",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:workflows",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getWorkflowReadiness } = await import("../usecases/workflow-readiness.ts");
      res.json(200, await getWorkflowReadiness());
    },
  },
  {
    method: "GET",
    path: "/api/admin/workflows",
    operationName: "admin.workflows.get",
    requiresAuth: true,
    requiredPermission: "platform.data.read",
    resource: "admin:workflows",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (_req, res) => {
      const { getWorkflowReadiness } = await import("../usecases/workflow-readiness.ts");
      const { getComposedProviderReadiness } = await import("../usecases/composed-providers.ts");
      const composed = await getComposedProviderReadiness();
      const report = await getWorkflowReadiness();
      res.json(200, { report, composed });
    },
  },
  {
    method: "POST",
    path: "/api/admin/workflows/start",
    operationName: "admin.workflows.start",
    requiresAuth: true,
    requiredPermission: "platform.workflow.write",
    resource: "admin:workflows",
    umaScope: "create" as const,
    auditEvent: AuditAction.WorkflowStarted,
    scope: "global" as const,
    handler: async (req, res) => {
      const body = req.body as
        | {
            workflowKey?: string;
            tenantId?: string;
            workflowId?: string;
            payload?: Record<string, unknown>;
          }
        | undefined;
      if (!body?.workflowKey || !body?.tenantId || !body?.workflowId) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "workflowKey, tenantId, and workflowId are required",
        });
        return;
      }
      const temporal = temporalProvider();
      if (!temporal) {
        res.json(503, { code: "NOT_CONFIGURED", message: "Temporal is not configured" });
        return;
      }
      const input = {
        workflowKey: body.workflowKey,
        tenantId: body.tenantId,
        workflowId: body.workflowId,
        payload: body.payload ?? {},
      };
      await auditAdminWorkflowMutation({
        actor: req.actor!,
        action: AuditAction.WorkflowStarted,
        workflowId: input.workflowId,
        workflowKey: input.workflowKey,
        tenantId: input.tenantId,
        requestId: req.requestId,
        sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
      });
      res.json(200, await temporal.startWorkflow(input));
    },
  },
  {
    method: "POST",
    path: "/api/admin/workflows/:workflowId/signal",
    operationName: "admin.workflows.signal",
    requiresAuth: true,
    requiredPermission: "platform.workflow.write",
    resource: "admin:workflows",
    umaScope: "create" as const,
    auditEvent: AuditAction.WorkflowSignaled,
    scope: "global" as const,
    handler: async (req, res) => {
      const workflowId = req.params["workflowId"] ?? "";
      const body = req.body as
        | { signalName?: string; payload?: Record<string, unknown> }
        | undefined;
      if (!workflowId || !body?.signalName) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "workflowId and signalName are required",
        });
        return;
      }
      const temporal = temporalProvider();
      if (!temporal) {
        res.json(503, { code: "NOT_CONFIGURED", message: "Temporal is not configured" });
        return;
      }
      await auditAdminWorkflowMutation({
        actor: req.actor!,
        action: AuditAction.WorkflowSignaled,
        workflowId,
        signalName: body.signalName,
        requestId: req.requestId,
        sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
      });
      await temporal.signalWorkflow(workflowId, body.signalName, body.payload ?? {});
      res.json(200, { ok: true });
    },
  },
  {
    method: "POST",
    path: "/api/admin/workflows/:workflowId/cancel",
    operationName: "admin.workflows.cancel",
    requiresAuth: true,
    requiredPermission: "platform.workflow.write",
    resource: "admin:workflows",
    umaScope: "create" as const,
    auditEvent: AuditAction.WorkflowCancelled,
    scope: "global" as const,
    handler: async (req, res) => {
      const workflowId = req.params["workflowId"] ?? "";
      if (!workflowId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "workflowId is required" });
        return;
      }
      const temporal = temporalProvider();
      if (!temporal) {
        res.json(503, { code: "NOT_CONFIGURED", message: "Temporal is not configured" });
        return;
      }
      await auditAdminWorkflowMutation({
        actor: req.actor!,
        action: AuditAction.WorkflowCancelled,
        workflowId,
        requestId: req.requestId,
        sourceHost: req.raw.headers["x-forwarded-host"] as string | undefined,
      });
      await temporal.cancelWorkflow(workflowId);
      res.json(200, { ok: true });
    },
  },
  {
    method: "GET",
    path: "/api/admin/workflows/:workflowId",
    operationName: "admin.workflows.status",
    requiresAuth: true,
    requiredPermission: "platform.workflow.read",
    resource: "admin:workflows",
    umaScope: "read" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const workflowId = req.params["workflowId"] ?? "";
      if (!workflowId) {
        res.json(400, { code: "VALIDATION_ERROR", message: "workflowId is required" });
        return;
      }
      const temporal = temporalProvider();
      if (!temporal) {
        res.json(503, { code: "NOT_CONFIGURED", message: "Temporal is not configured" });
        return;
      }
      const temporalStatus = await temporal.getWorkflowStatus(workflowId);
      const windmill = windmillProvider();
      const windmillStatus = windmill
        ? await windmill.getRunStatus(workflowId).catch(() => null)
        : null;
      res.json(200, { temporal: temporalStatus, windmill: windmillStatus });
    },
  },
  {
    // -------------------------------------------------------------------
    // Manual retention tick (system-admin, ADR-0064 / V1C-12b).
    // Operator-only trigger for ops + smoke tests. The cadence-driven tick
    // runs from the in-process worker (`server/retention-worker-runtime.ts`),
    // which is started by `server/http.ts` on boot. This route is the
    // break-glass / proof surface: same audit trail, idempotent re-runs
    // (recordOutcome uses ON CONFLICT).
    // -------------------------------------------------------------------
    method: "POST",
    path: "/api/admin/data/retention-policies/tick",
    operationName: "admin.data.retentionPolicy.tick",
    requiresAuth: true,
    requiredPermission: "platform.admin.access",
    resource: "admin:data",
    umaScope: "create" as const,
    scope: "global" as const,
    handler: async (req, res) => {
      const { runRetentionTick } = await import("../usecases/retention.ts");
      const { PostgresRetentionRepository } = await import("../adapters/postgres-retention.ts");
      const { PostgresLegalHoldRepository } = await import("../adapters/postgres-legal-hold.ts");
      const url = new URL(req.raw.url ?? "", "http://localhost");
      const org = url.searchParams.get("organisationId");
      const candidateLimitRaw = url.searchParams.get("candidateLimit");
      const candidateLimit = Math.min(Math.max(Number(candidateLimitRaw) || 200, 1), 1000);
      if (!org || !UUID_RE.test(org)) {
        res.json(400, {
          code: "VALIDATION_ERROR",
          message: "organisationId query param must be a UUID",
        });
        return;
      }
      // The actor is the human caller (req.actor) — NOT the scheduler. This
      // route is a manual break-glass trigger; audit must show the human who
      // initiated it, not the background scheduler actor. The worker-side
      // tick uses V1C12B_SCHEDULER_ACTOR, exported from the runtime for
      // traceability.
      const result = await runRetentionTick(
        {
          organisationId: org,
          candidateLimit,
          actor: {
            actorId: req.actor!.userId,
            actorRoles: req.actor!.roles,
            sourceHost:
              (req.raw.headers["x-forwarded-host"] as string | undefined) ??
              "platform-retention-tick-route",
          },
        },
        {
          repository: new PostgresRetentionRepository(getApplicationPool()),
          audit: createPostgresAuditEventPort(getApplicationPool()),
          guard: {
            repository: new PostgresLegalHoldRepository(getApplicationPool()),
          },
        }
      );
      res.json(200, result);
    },
  },
];
