/**
 * Service clickthrough policy (ADR-ACT-0233) — single source of truth.
 *
 * Every operational/tool UI reachable through Caddy forward-auth is classified
 * here, with its isolation invariant. forward-auth derives its resource sets
 * from this module, the Caddyfile is reconciled against it by a unit test
 * (service-clickthrough.test.ts parses docker/caddy/Caddyfile), and the proof
 * script proof:service-clickthrough-policy exercises the decisions live.
 *
 * Classifications:
 *   GLOBAL_ONLY        — system-admin only, from any host (forward-auth grants
 *                        system-admin regardless of slug; Caddy only routes the
 *                        service on the apex block).
 *   TENANT_SCOPED_SAFE — tenant-admin allowed on their OWN slug only. Requires
 *                        a REAL isolation invariant (below), not a hopeful one.
 *   NOT_EXPOSED        — never routed through forward-auth; direct port only.
 *
 * ADR-ACT-0230 findings resolved here:
 *   - Mailpit was TENANT_SCOPED_SAFE with a claimed "tenant-domain-filtered
 *     view" that does not exist — the tenant route proxied the SHARED inbox.
 *     Reclassified GLOBAL_ONLY; the tenant Caddy route is removed.
 *   - Sentry was TENANT_SCOPED_SAFE in forward-auth but Caddy never routed a
 *     tenant path (dead grant). Reclassified GLOBAL_ONLY to match reality.
 *   - Custom domains (Caddy catch-all vhost) expose NO tool clickthroughs.
 */

export type ClickthroughClassification = "global_only" | "tenant_scoped_safe" | "not_exposed";

export interface ClickthroughService {
  /** Stable id (matches the landing-page tool link + i18n key). */
  id: string;
  /** forward-auth resource name (admin:<id>). */
  resource: string;
  classification: ClickthroughClassification;
  /** The REAL guarantee that makes the classification safe. */
  isolationInvariant: string;
  /** Caddy path prefix on the apex vhost, or null when not path-proxied. */
  apexPath: string | null;
  /** Caddy path prefix on the tenant wildcard vhost, or null. */
  tenantPath: string | null;
  /**
   * Human click-through landing path, when the tool's useful UI is NOT at the apex
   * root (which the Caddy route serves). ClickHouse's apex root returns the bare
   * "Ok." HTTP probe response; its interactive UI is at /play. When set, this is the
   * URL surfaced to operators; the apexPath still governs the Caddy route + auth
   * reconciliation (it must remain the wildcard the Caddyfile declares). Optional.
   */
  landingPath?: string;
  /**
   * Mock/dev-only service (no production deployment). Such a service must NOT present
   * a click-through "Open" link in production — it is not running there, so the apex
   * route 502s (Bad Gateway). The link is locked (url null) in production environments;
   * mirrors the service-catalog `forbiddenInProduction` / `mock-only` classification.
   * Optional; defaults to false.
   */
  devOnly?: boolean;
}

export const CLICKTHROUGH_SERVICES: readonly ClickthroughService[] = [
  {
    id: "keycloak",
    resource: "admin:keycloak",
    classification: "tenant_scoped_safe",
    isolationInvariant:
      "Realm endpoints (/kc/realms/*) are public by design (required for login). The admin " +
      "console under /kc/* additionally requires Keycloak's OWN admin authentication — a " +
      "platform session never grants realm administration; realm scoping is enforced by " +
      "Keycloak account permissions, with the platform forward-auth gate as an additive layer.",
    apexPath: "/kc/*",
    tenantPath: "/kc/*",
  },
  {
    id: "mailpit",
    resource: "admin:mailpit",
    classification: "global_only",
    isolationInvariant:
      "NONE per tenant — Mailpit is a single shared inbox with no tenant filtering; any " +
      "view exposes all tenants' captured mail. Therefore system-admin only (ADR-ACT-0233 " +
      "revoked the former tenant grant whose claimed filtering did not exist).",
    apexPath: "/mailpit/*",
    tenantPath: null,
  },
  {
    id: "sentry",
    resource: "admin:sentry",
    classification: "global_only",
    isolationInvariant:
      "Shared Sentry instance; no per-tenant organisation isolation is proven. The former " +
      "tenant-safe entry was a dead grant (Caddy never routed a tenant path).",
    apexPath: "/sentry/*",
    tenantPath: null,
  },
  {
    id: "sonarqube",
    resource: "admin:sonarqube",
    classification: "global_only",
    isolationInvariant: "No per-tenant project isolation in the shared instance.",
    apexPath: "/sonar/*",
    tenantPath: null,
  },
  {
    id: "minio",
    resource: "admin:minio",
    classification: "global_only",
    isolationInvariant: "Console grants all-bucket access; no per-tenant ACL in the console.",
    apexPath: "/minio/*",
    tenantPath: null,
  },
  {
    id: "clickhouse",
    resource: "admin:clickhouse",
    classification: "global_only",
    isolationInvariant: "Analytics DB without per-tenant partition isolation.",
    apexPath: "/clickhouse/*",
    tenantPath: null,
    // Bare /clickhouse/ proxies to the HTTP root which answers "Ok." (the health probe
    // response), not a UI. The interactive query console is /play (ClickHouse has no SSO).
    landingPath: "/clickhouse/play",
  },
  {
    id: "localstack",
    resource: "admin:localstack",
    classification: "global_only",
    isolationInvariant: "Cloud mock with no tenant scope (dev/staging only).",
    apexPath: "/localstack/*",
    tenantPath: null,
    // Mock-only (cloud-mocks profile), forbidden in production (service-catalog). It is
    // not deployed in prod, so the apex link would 502; lock it there instead.
    devOnly: true,
  },
  {
    id: "pgadmin",
    resource: "admin:pgadmin",
    classification: "global_only",
    isolationInvariant:
      "Raw SQL access; tenant scoping via user-settable GUCs is unsafe (ADR-0029).",
    apexPath: "/pgadmin/*",
    tenantPath: null,
  },
  {
    id: "grafana",
    resource: "admin:grafana",
    classification: "global_only",
    isolationInvariant: "Platform log search — all tenants' logs are visible.",
    apexPath: "/grafana/*",
    tenantPath: null,
  },
  {
    id: "prometheus",
    resource: "admin:prometheus",
    classification: "global_only",
    isolationInvariant: "Metrics are shared infrastructure; no tenant-private console exists.",
    apexPath: "/prometheus/*",
    tenantPath: null,
  },
  {
    id: "alertmanager",
    resource: "admin:alertmanager",
    classification: "global_only",
    isolationInvariant: "Alert routing is platform-owned and shared across tenants.",
    apexPath: "/alertmanager/*",
    tenantPath: null,
  },
  {
    id: "windmill",
    resource: "admin:windmill",
    classification: "global_only",
    isolationInvariant:
      "Operator automation is system-admin only; workflows remain platform-owned.",
    apexPath: "/windmill/*",
    tenantPath: null,
  },
  {
    id: "temporal",
    resource: "admin:temporal",
    classification: "global_only",
    isolationInvariant:
      "Durable workflow orchestration is shared infrastructure, not tenant-scoped UI.",
    apexPath: "/temporal/*",
    tenantPath: null,
  },
  {
    id: "tilt",
    resource: "admin:tilt",
    classification: "global_only",
    isolationInvariant:
      "Local dev tooling. Cannot be path-proxied (its SPA calls absolute /api/*); accessed " +
      "directly on :10350 — the resource exists for completeness but no Caddy route exists.",
    apexPath: null,
    tenantPath: null,
  },
  {
    id: "wiremock",
    resource: "admin:wiremock",
    classification: "not_exposed",
    isolationInvariant:
      "Dev-only mock server; deliberately NOT routed through forward-auth and never linked " +
      "in the UI. Direct port access only (WIREMOCK_PORT).",
    apexPath: null,
    tenantPath: null,
  },
  {
    id: "openbao",
    resource: "admin:openbao",
    classification: "not_exposed",
    isolationInvariant:
      "Central runtime secrets manager UI (ADR-0069). A secrets console must never be " +
      "tenant-reachable and is not surfaced through forward-auth; operators reach it directly " +
      "on OPENBAO_PORT. The platform reads/writes secrets server-side via SecretStorePort, " +
      "never by linking the OpenBao UI. Dev mode is local-only.",
    apexPath: null,
    tenantPath: null,
  },
];

/** Resources system-admin may clickthrough (everything that is exposed at all). */
export const SYSTEM_ADMIN_RESOURCES: ReadonlySet<string> = new Set(
  CLICKTHROUGH_SERVICES.filter((s) => s.classification !== "not_exposed").map((s) => s.resource)
);

/** Resources tenant-admin may clickthrough on their OWN slug. */
export const TENANT_ADMIN_RESOURCES: ReadonlySet<string> = new Set(
  CLICKTHROUGH_SERVICES.filter((s) => s.classification === "tenant_scoped_safe").map(
    (s) => s.resource
  )
);

export interface ClickthroughDecisionInput {
  roles: string[];
  resource: string;
  /** Slug derived from the request host; null = apex/global host. */
  requestedSlug: string | null;
  /** DB-resolved slug for the session tenant; null = lookup failed / no tenant. */
  ownSlug: string | null;
}

export interface ClickthroughDecision {
  granted: boolean;
  reason:
    | "system_admin_exposed_service"
    | "tenant_admin_own_slug_safe_service"
    | "not_exposed"
    | "unknown_resource"
    | "global_only_service"
    | "not_tenant_host"
    | "tenant_mismatch"
    | "insufficient_role";
}

/**
 * Pure clickthrough access decision (ADR-ACT-0233). The forward-auth handler
 * delegates here; tests and proofs exercise the same logic path.
 */
export function decideServiceAccess(input: ClickthroughDecisionInput): ClickthroughDecision {
  const service = CLICKTHROUGH_SERVICES.find((s) => s.resource === input.resource);
  if (!service) return { granted: false, reason: "unknown_resource" };
  if (service.classification === "not_exposed") return { granted: false, reason: "not_exposed" };

  if (input.roles.includes("system-admin")) {
    return { granted: true, reason: "system_admin_exposed_service" };
  }

  if (!input.roles.includes("tenant-admin")) {
    return { granted: false, reason: "insufficient_role" };
  }
  if (service.classification !== "tenant_scoped_safe") {
    return { granted: false, reason: "global_only_service" };
  }
  if (input.requestedSlug === null) return { granted: false, reason: "not_tenant_host" };
  if (input.ownSlug === null || input.ownSlug !== input.requestedSlug) {
    return { granted: false, reason: "tenant_mismatch" };
  }
  return { granted: true, reason: "tenant_admin_own_slug_safe_service" };
}
