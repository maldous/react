import type {
  PlatformConsoleAccess,
  PlatformConsoleUrlKind,
  PlatformServiceCategory,
  PlatformServiceStatus,
  PlatformServiceSummary,
  PlatformServicesReadinessResponse,
  PlatformViewerMode,
  PlatformWorkerStatus,
  PlatformWorkerSummary,
} from "@platform/contracts-admin";
import type { WorkerHeartbeat } from "../server/worker-registry.ts";
import { CLICKTHROUGH_SERVICES } from "./service-clickthrough.ts";

// ---------------------------------------------------------------------------
// Platform operations cockpit — service registry + readiness (ADR-ACT-0228,
// hardened by ADR-ACT-0235).
//
// A SAFE allowlist of local services with bounded service-specific health checks +
// known-safe LOCAL console URLs (localhost only). NEVER reads or returns secrets/DSNs/
// raw env — only the allowlisted port-derived URLs below. Every probe is timeout-bounded
// by the caller so a slow/down service cannot stall the cockpit.
//
// Honest statuses: `healthy` requires a 2xx response AND a passing service-specific
// body check where one exists; any other HTTP response is `degraded` (reachable but
// unhealthy — never faked healthy); no response is `unreachable`; an unwired service
// is `not_configured`.
//
// Console links follow the ADR-ACT-0233 clickthrough policy (single source of truth):
// global-only consoles are emitted ONLY for a system-admin viewer; not-exposed services
// never carry a link; tenant_safe requires a REAL isolation invariant in the policy.
// ---------------------------------------------------------------------------

export type ServiceProbeKind = "http" | "postgres" | "redis";

/** Result of a bounded HTTP probe; null = no response (network error / timeout). */
export interface HttpProbeResult {
  statusCode: number;
  /** Response body (caller-truncated); used only for service-specific health checks. */
  body: string;
}

interface ServiceDef {
  key: string;
  category: PlatformServiceCategory;
  kind: ServiceProbeKind;
  /** All entries are local dev infra → localhost console links, never production. */
  localOnly: boolean;
  /** Resolve the health URL (http kind) from env port vars; undefined → not_configured. */
  healthUrl?: (e: NodeJS.ProcessEnv) => string | undefined;
  /** Resolve a safe LOCAL operator console URL, or undefined. */
  consoleUrl?: (e: NodeJS.ProcessEnv) => string | undefined;
  /**
   * Service-specific health check over a 2xx response body. Return "degraded" when
   * the body reports an unhealthy state; null when the body looks healthy.
   */
  classifyBody?: (body: string) => "degraded" | null;
  /**
   * Console exposure when the service is NOT covered by the ADR-ACT-0233 clickthrough
   * policy (policy classification wins when present). Defaults to "not_exposed".
   */
  fallbackConsoleAccess?: PlatformConsoleAccess;
  detailKey?: string;
}

const at = (e: NodeJS.ProcessEnv, portVar: string, def: string, path = ""): string =>
  `http://localhost:${e[portVar] ?? def}${path}`;

// `undefined` = unparseable (distinct from a legal JSON `null` body).
const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

/** Structured JSON health check: a malformed body on a JSON endpoint is
 * DEGRADED (ADR-ACT-0236) — a 200 with garbage is not a healthy service. */
const jsonBodyCheck =
  (healthy: (parsed: unknown) => boolean) =>
  (body: string): "degraded" | null => {
    const parsed = parseJson(body);
    if (parsed === undefined) return "degraded";
    return healthy(parsed) ? null : "degraded";
  };

/** Grafana /api/health: valid JSON; `database` (where present) must be "ok". */
const grafanaBodyCheck = jsonBodyCheck((parsed) => {
  if (typeof parsed !== "object" || parsed === null) return false;
  const database = (parsed as { database?: unknown }).database;
  return database === undefined || database === "ok";
});

/** LocalStack /_localstack/health: valid JSON; no service may report "error". */
const localstackBodyCheck = jsonBodyCheck((parsed) => {
  if (typeof parsed !== "object" || parsed === null) return false;
  const services = (parsed as { services?: Record<string, unknown> }).services ?? {};
  return !Object.values(services).some((s) => s === "error");
});

/** SonarQube /api/system/status: valid JSON with status === "UP". */
const sonarqubeBodyCheck = jsonBodyCheck(
  (parsed) =>
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { status?: unknown }).status === "UP"
);

/** Keycloak OIDC discovery: valid JSON with a non-empty issuer. */
const keycloakBodyCheck = jsonBodyCheck((parsed) => {
  if (typeof parsed !== "object" || parsed === null) return false;
  const issuer = (parsed as { issuer?: unknown }).issuer;
  return typeof issuer === "string" && issuer.length > 0;
});

// The allowlist. Console URLs are localhost operator links only.
export const SERVICE_REGISTRY: readonly ServiceDef[] = [
  { key: "postgres", category: "data", kind: "postgres", localOnly: true },
  {
    key: "redis",
    category: "data",
    kind: "redis",
    localOnly: true,
    // Structural check only (wired at startup) — surfaced as `configured`,
    // never `healthy`; the caveat is shown in the UI via this detail key.
    detailKey: "feature.admin.platform.svc.redis.detail",
  },
  {
    key: "clickhouse",
    category: "data",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "CLICKHOUSE_HTTP_PORT", "8124", "/ping"),
    consoleUrl: (e) => at(e, "CLICKHOUSE_HTTP_PORT", "8124", "/play"),
  },
  {
    key: "minio",
    category: "storage",
    kind: "http",
    localOnly: true,
    healthUrl: (e) =>
      (e["MINIO_ENDPOINT"] ?? at(e, "MINIO_API_PORT", "9000")) + "/minio/health/live",
    consoleUrl: (e) => at(e, "MINIO_CONSOLE_PORT", "9001"),
  },
  {
    key: "mailpit",
    category: "mail",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "MAILPIT_UI_PORT", "8025", "/mailpit/api/v1/info"),
    consoleUrl: (e) => at(e, "MAILPIT_UI_PORT", "8025", "/mailpit"),
  },
  {
    key: "otel_collector",
    category: "observability",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "OTEL_HEALTH_PORT", "13133", "/"),
  },
  {
    key: "loki",
    category: "observability",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => (e["LOKI_URL"] ?? at(e, "LOKI_PORT", "3100")) + "/ready",
  },
  {
    key: "grafana",
    category: "observability",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "GRAFANA_PORT", "3200", "/api/health"),
    consoleUrl: (e) => at(e, "GRAFANA_PORT", "3200"),
    classifyBody: grafanaBodyCheck,
  },
  {
    key: "keycloak",
    category: "auth",
    kind: "http",
    localOnly: true,
    healthUrl: (e) =>
      at(e, "KEYCLOAK_PORT", "8090", "/kc/realms/master/.well-known/openid-configuration"),
    consoleUrl: (e) => at(e, "KEYCLOAK_PORT", "8090", "/kc"),
    classifyBody: keycloakBodyCheck,
  },
  {
    key: "mock_oidc",
    category: "auth",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "MOCK_OIDC_PORT", "9080", "/healthz"),
    detailKey: "feature.admin.platform.svc.mock_oidc.detail",
  },
  {
    key: "pgadmin",
    category: "data",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "PGADMIN_PORT", "5050", "/pgadmin/misc/ping"),
    consoleUrl: (e) => at(e, "PGADMIN_PORT", "5050", "/pgadmin"),
  },
  {
    key: "wiremock",
    category: "mocks",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "WIREMOCK_PORT", "8089", "/__admin/health"),
    // No consoleUrl: WireMock is NOT_EXPOSED (ADR-ACT-0233) — never linked in the UI.
  },
  {
    key: "localstack",
    category: "mocks",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "LOCALSTACK_PORT", "4566", "/_localstack/health"),
    classifyBody: localstackBodyCheck,
  },
  {
    key: "sonarqube",
    category: "quality",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "SONAR_PORT", "9064", "/sonar/api/system/status"),
    consoleUrl: (e) => at(e, "SONAR_PORT", "9064", "/sonar"),
    classifyBody: sonarqubeBodyCheck,
  },
  {
    key: "web_caddy",
    category: "web",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "WEB_HTTP_PORT", "80", "/healthz"),
    consoleUrl: (e) => at(e, "WEB_HTTP_PORT", "80"),
    // Apex super-admin app surface — not in the clickthrough policy (it IS the app),
    // but the console link is operator-facing: system-admin only.
    fallbackConsoleAccess: "global_only",
  },
];

const labelKey = (key: string): string => `feature.admin.platform.svc.${key}.label`;

const CLICKTHROUGH_BY_ID = new Map(CLICKTHROUGH_SERVICES.map((s) => [s.id, s.classification]));

/**
 * Console exposure for a cockpit service: the ADR-ACT-0233 clickthrough policy is
 * authoritative when the service is classified there; otherwise the registry fallback
 * (default not_exposed — fail closed).
 */
export function consoleAccessFor(def: Pick<ServiceDef, "key" | "fallbackConsoleAccess">) {
  const classification = CLICKTHROUGH_BY_ID.get(def.key);
  if (classification === "tenant_scoped_safe") return "tenant_safe" as const;
  if (classification === "global_only" || classification === "not_exposed") return classification;
  return def.fallbackConsoleAccess ?? ("not_exposed" as const);
}

// ---------------------------------------------------------------------------
// Host authority (ADR-ACT-0236). "No tenant context" must never mean "safe
// global context": the system-operator view exists ONLY on the apex host.
// ---------------------------------------------------------------------------

export type ReadinessHostKind =
  | "apex"
  | "tenant_slug"
  | "reserved_subdomain"
  | "invalid_subdomain"
  | "custom_domain_candidate"
  | "malformed";

export type ReadinessAccess =
  | { kind: "ok"; viewerMode: PlatformViewerMode }
  | { kind: "no_tenant" }
  | { kind: "invalid_operations_origin" };

/**
 * Pure host-authority decision for the readiness endpoint:
 *   - a tenant-resolved host (slug FQDN or ACTIVE custom domain) yields the
 *     tenant-safe view for EVERY viewer — a system-admin on a tenant host is
 *     deliberately downgraded (support-mode escalation is not implemented;
 *     documented policy choice, ADR-ACT-0236)
 *   - a system-admin on the APEX host gets the system-operator view
 *   - a system-admin on any other host (reserved/unknown subdomain, unresolved
 *     custom host, malformed) is REFUSED — unknown hosts never become implicit
 *     operations origins
 *   - everyone else without tenant context gets no_tenant
 */
export function resolveReadinessAccess(input: {
  isSystemAdmin: boolean;
  hostKind: ReadinessHostKind;
  tenantResolved: boolean;
}): ReadinessAccess {
  if (input.tenantResolved) return { kind: "ok", viewerMode: "tenant_operator" };
  if (input.isSystemAdmin) {
    if (input.hostKind === "apex") return { kind: "ok", viewerMode: "system_operator" };
    return { kind: "invalid_operations_origin" };
  }
  return { kind: "no_tenant" };
}

export interface PlatformProbeDeps {
  /** Bounded HTTP probe — the response (status + truncated body), or null when none. */
  httpProbe(url: string): Promise<HttpProbeResult | null>;
  /** Bounded Postgres probe — true when `SELECT 1` succeeds. */
  pgProbe(): Promise<boolean>;
  /** Structural: is Redis wired (connected at startup)? */
  redisConfigured(): boolean;
  /** Host-authority-resolved view (resolveReadinessAccess) — gates console links. */
  viewerMode: PlatformViewerMode;
  /** The tenant host the request arrived on (tenant_operator only) — used to
   * emit ROUTED tenant-origin console links (e.g. http://{host}/kc). */
  tenantHost?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

async function probeStatus(
  def: ServiceDef,
  deps: PlatformProbeDeps
): Promise<PlatformServiceStatus> {
  const env = deps.env ?? process.env;
  if (def.kind === "postgres") return (await deps.pgProbe()) ? "healthy" : "unreachable";
  if (def.kind === "redis") return deps.redisConfigured() ? "configured" : "not_configured";
  const url = def.healthUrl?.(env);
  if (!url) return "not_configured";
  const res = await deps.httpProbe(url);
  if (!res) return "unreachable";
  // Any non-2xx response is reachable-but-unhealthy — never reported healthy.
  if (res.statusCode < 200 || res.statusCode >= 300) return "degraded";
  return def.classifyBody?.(res.body) ?? "healthy";
}

/**
 * Console link + labelling for one service under the viewer's host authority.
 * Tenant-safe links on a tenant host are ROUTED through the tenant origin
 * (Caddy/forward-auth path) — never a direct local port presented as
 * tenant-safe. Direct local ports appear only in the system-operator view,
 * explicitly labelled `direct_local` (ADR-ACT-0236).
 */
function consoleLinkFor(
  def: ServiceDef,
  consoleAccess: PlatformConsoleAccess,
  deps: PlatformProbeDeps,
  env: NodeJS.ProcessEnv
): { consoleUrl: string | null; consoleUrlKind: PlatformConsoleUrlKind | null } {
  const none = { consoleUrl: null, consoleUrlKind: null };
  if (consoleAccess === "not_exposed") return none;
  if (consoleAccess === "global_only") {
    if (deps.viewerMode !== "system_operator") return none;
    const url = def.consoleUrl?.(env) ?? null;
    return url ? { consoleUrl: url, consoleUrlKind: "direct_local" } : none;
  }
  // tenant_safe (Keycloak): tenant viewers get the tenant-origin ROUTED path;
  // the system operator gets the direct local port, labelled as such.
  if (deps.viewerMode === "tenant_operator") {
    if (def.key === "keycloak" && deps.tenantHost) {
      return { consoleUrl: `http://${deps.tenantHost}/kc`, consoleUrlKind: "routed" };
    }
    // No routed tenant path available — withhold rather than hand a tenant
    // viewer a direct local port dressed up as tenant-safe.
    return none;
  }
  const url = def.consoleUrl?.(env) ?? null;
  return url ? { consoleUrl: url, consoleUrlKind: "direct_local" } : none;
}

/** Pure-ish: probe every registry service (bounded by the injected probes), in parallel. */
export async function buildServiceSummaries(
  deps: PlatformProbeDeps
): Promise<PlatformServiceSummary[]> {
  const env = deps.env ?? process.env;
  const checkedAt = (deps.now ?? new Date()).toISOString();
  return Promise.all(
    SERVICE_REGISTRY.map(async (def) => {
      const consoleAccess = consoleAccessFor(def);
      const link = consoleLinkFor(def, consoleAccess, deps, env);
      return {
        key: def.key,
        labelKey: labelKey(def.key),
        category: def.category,
        status: await probeStatus(def, deps),
        localOnly: def.localOnly,
        consoleUrl: link.consoleUrl,
        consoleAccess,
        consoleUrlKind: link.consoleUrlKind,
        checkedAt,
        detailKey: def.detailKey ?? null,
      };
    })
  );
}

// --- workers ---------------------------------------------------------------

interface WorkerDef {
  key: string;
  intervalMs: number;
  enabled: boolean;
}

/** The known background workers (ADR-0052). Heartbeats are in-memory (reset on restart). */
export function workerRegistry(env: NodeJS.ProcessEnv = process.env): WorkerDef[] {
  return [
    {
      key: "webhook-delivery",
      intervalMs: Number(env["WEBHOOK_WORKER_INTERVAL_MS"] ?? 5000),
      enabled: env["WEBHOOK_WORKER_DISABLED"] !== "true",
    },
  ];
}

export function buildWorkerSummaries(
  getHeartbeat: (key: string) => WorkerHeartbeat | null,
  env: NodeJS.ProcessEnv = process.env
): PlatformWorkerSummary[] {
  return workerRegistry(env).map((w) => {
    const hb = getHeartbeat(w.key);
    const status: PlatformWorkerStatus = !w.enabled ? "stopped" : (hb?.status ?? "unknown");
    return {
      key: w.key,
      labelKey: `feature.admin.platform.worker.${w.key}.label`,
      enabled: w.enabled,
      intervalMs: w.intervalMs,
      lastTickAt: hb?.lastTickAt ?? null,
      lastError: hb?.lastError ?? null,
      status,
      inMemory: true,
    };
  });
}

export interface PlatformReadinessDeps extends PlatformProbeDeps {
  getHeartbeat: (key: string) => WorkerHeartbeat | null;
}

export async function buildPlatformServicesReadiness(
  deps: PlatformReadinessDeps
): Promise<PlatformServicesReadinessResponse> {
  const env = deps.env ?? process.env;
  return {
    environment: env["PLATFORM_ENV"] ?? env["NODE_ENV"] ?? "development",
    appVersion: env["GIT_SHA"] ?? env["APP_VERSION"] ?? null,
    viewerMode: deps.viewerMode,
    services: await buildServiceSummaries(deps),
    workers: buildWorkerSummaries(deps.getHeartbeat, env),
  };
}
