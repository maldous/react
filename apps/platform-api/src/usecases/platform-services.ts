import type {
  PlatformServiceCategory,
  PlatformServiceStatus,
  PlatformServiceSummary,
  PlatformServicesReadinessResponse,
  PlatformWorkerStatus,
  PlatformWorkerSummary,
} from "@platform/contracts-admin";
import type { WorkerHeartbeat } from "../server/worker-registry.ts";

// ---------------------------------------------------------------------------
// Platform operations cockpit — service registry + readiness (ADR-ACT-0228).
//
// A SAFE allowlist of local services with bounded health probes + known-safe LOCAL
// console URLs (localhost only). NEVER reads or returns secrets/DSNs/raw env — only the
// allowlisted port-derived URLs below. Every probe is timeout-bounded by the caller so a
// slow/down service cannot stall the cockpit. Honest statuses: a profile-gated service
// that is not running is `unreachable`; an unwired one is `not_configured`.
// ---------------------------------------------------------------------------

export type ServiceProbeKind = "http" | "postgres" | "redis";

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
  detailKey?: string;
}

const at = (e: NodeJS.ProcessEnv, portVar: string, def: string, path = ""): string =>
  `http://localhost:${e[portVar] ?? def}${path}`;

// The allowlist. Console URLs are localhost operator links only.
export const SERVICE_REGISTRY: readonly ServiceDef[] = [
  { key: "postgres", category: "data", kind: "postgres", localOnly: true },
  { key: "redis", category: "data", kind: "redis", localOnly: true },
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
  },
  {
    key: "keycloak",
    category: "auth",
    kind: "http",
    localOnly: true,
    healthUrl: (e) =>
      at(e, "KEYCLOAK_PORT", "8090", "/kc/realms/master/.well-known/openid-configuration"),
    consoleUrl: (e) => at(e, "KEYCLOAK_PORT", "8090", "/kc"),
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
    consoleUrl: (e) => at(e, "WIREMOCK_PORT", "8089", "/__admin"),
  },
  {
    key: "localstack",
    category: "mocks",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "LOCALSTACK_PORT", "4566", "/_localstack/health"),
  },
  {
    key: "sonarqube",
    category: "quality",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "SONAR_PORT", "9064", "/sonar/api/system/status"),
    consoleUrl: (e) => at(e, "SONAR_PORT", "9064", "/sonar"),
  },
  {
    key: "web_caddy",
    category: "web",
    kind: "http",
    localOnly: true,
    healthUrl: (e) => at(e, "WEB_HTTP_PORT", "80", "/healthz"),
    consoleUrl: (e) => at(e, "WEB_HTTP_PORT", "80"),
  },
];

const labelKey = (key: string): string => `feature.admin.platform.svc.${key}.label`;

export interface PlatformProbeDeps {
  /** Bounded HTTP probe — true when the endpoint returned ANY response. */
  httpProbe(url: string): Promise<boolean>;
  /** Bounded Postgres probe — true when `SELECT 1` succeeds. */
  pgProbe(): Promise<boolean>;
  /** Structural: is Redis wired (connected at startup)? */
  redisConfigured(): boolean;
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
  return (await deps.httpProbe(url)) ? "healthy" : "unreachable";
}

/** Pure-ish: probe every registry service (bounded by the injected probes), in parallel. */
export async function buildServiceSummaries(
  deps: PlatformProbeDeps
): Promise<PlatformServiceSummary[]> {
  const env = deps.env ?? process.env;
  const checkedAt = (deps.now ?? new Date()).toISOString();
  return Promise.all(
    SERVICE_REGISTRY.map(async (def) => ({
      key: def.key,
      labelKey: labelKey(def.key),
      category: def.category,
      status: await probeStatus(def, deps),
      localOnly: def.localOnly,
      consoleUrl: def.consoleUrl?.(env) ?? null,
      checkedAt,
      detailKey: def.detailKey ?? null,
    }))
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
    services: await buildServiceSummaries(deps),
    workers: buildWorkerSummaries(deps.getHeartbeat, env),
  };
}
