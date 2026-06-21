// ---------------------------------------------------------------------------
// Service catalog v2 usecase (ADR-0055 / ADR-ACT-0254)
//
// Generalises the existing platform-services / service-clickthrough registries
// into a single provider-aware catalog seam. Phase-1 delivers a static seed +
// the build/filter logic + the no-mock-in-production invariant. Each entry
// carries an environment classification (ADR-0056), a clickthrough visibility
// (ADR-ACT-0233), provider bindings, and whether it requires an entitlement.
//
// No secrets and no provider credentials ever appear in a catalog entry.
// ---------------------------------------------------------------------------

import type { ServiceCatalogEntry, ServiceCatalogResponse } from "@platform/contracts-admin";
import type { ProviderRegistry } from "../ports/provider-registry.ts";

// Static Phase-1 seed. Mirrors the USF registry decisions; additive over the
// existing platform-services/service-clickthrough registries (not a rewrite).
const SERVICE_CATALOG_SEED: readonly ServiceCatalogEntry[] = [
  {
    serviceKey: "postgres",
    serviceName: "Relational storage (Postgres)",
    category: "data-platform",
    environmentModel: "per-environment",
    visibility: "not_exposed",
    decision: "build",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "postgres (composed)",
    productionProvider: "managed Postgres",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "schema-per-tenant + RLS; non-superuser app role (ADR-ACT-0189).",
    proofRefs: ["proof:service-catalog-registry"],
  },
  {
    serviceKey: "minio",
    serviceName: "Object storage (MinIO)",
    category: "storage",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "build",
    requiresEntitlement: true,
    entitlementKey: "storage",
    localProvider: "minio (composed)",
    productionProvider: "S3-compatible adapter",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "per-tenant prefix + isolation probe.",
    proofRefs: ["proof:service-catalog-registry", "proof:tenant-storage"],
  },
  {
    serviceKey: "keycloak",
    serviceName: "Identity / authentication (Keycloak)",
    category: "authentication",
    environmentModel: "per-environment",
    visibility: "tenant_scoped_safe",
    decision: "build",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "keycloak (composed)",
    productionProvider: "managed Keycloak",
    mockProvider: "mock-oidc (fixture)",
    forbiddenInProduction: false,
    isolationNotes: "realm-scoped; admin console requires Keycloak's own auth (ADR-ACT-0233).",
    proofRefs: ["proof:service-catalog-registry", "proof:auth-settings"],
  },
  {
    serviceKey: "loki",
    serviceName: "Logs (Grafana Loki)",
    category: "observability-ops",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "build",
    requiresEntitlement: true,
    entitlementKey: "advanced_observability",
    localProvider: "loki + alloy (composed)",
    productionProvider: "Loki with S3 backend",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "label-based; tenant-scoped query enforced server-side.",
    proofRefs: ["proof:service-catalog-registry", "proof:tenant-observability"],
  },
  {
    serviceKey: "prometheus",
    serviceName: "Metrics (Prometheus)",
    category: "observability-ops",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "prometheus (composed)",
    productionProvider: "Prometheus with bounded labels",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "scrape-only; no secret labels; platform owns query access.",
    proofRefs: ["proof:service-catalog-registry", "proof:metrics-prometheus"],
  },
  {
    serviceKey: "tempo",
    serviceName: "Traces (Tempo)",
    category: "observability-ops",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "tempo (composed)",
    productionProvider: "Tempo",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "OTLP ingest only; platform controls tenant labels and query access.",
    proofRefs: ["proof:service-catalog-registry", "proof:metrics-prometheus"],
  },
  {
    serviceKey: "alertmanager",
    serviceName: "Alert routing (Alertmanager)",
    category: "observability-ops",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "alertmanager (composed)",
    productionProvider: "Alertmanager",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "routes into platform-owned notification and incident lifecycle.",
    proofRefs: ["proof:service-catalog-registry", "proof:alerting"],
  },
  {
    serviceKey: "temporal",
    serviceName: "Durable workflows (Temporal)",
    category: "developer-platform",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "temporal (composed)",
    productionProvider: "Temporal",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "platform API remains auth authority; workflow IDs carry tenant ID.",
    proofRefs: ["proof:service-catalog-registry", "proof:workflow-readiness-route"],
  },
  {
    serviceKey: "windmill",
    serviceName: "Operator automation (Windmill)",
    category: "developer-platform",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "windmill (composed)",
    productionProvider: "Windmill",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "scripts and operator jobs only; not a workflow state machine owner.",
    proofRefs: ["proof:service-catalog-registry", "proof:workflow-readiness-route"],
  },
  {
    serviceKey: "lago",
    serviceName: "Billing (Lago)",
    category: "finance",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "lago (composed)",
    productionProvider: "Lago",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "subscription engine owned externally; platform owns tenant UI and API.",
    proofRefs: ["proof:service-catalog-registry", "proof:billing-readiness-route"],
  },
  {
    serviceKey: "pgbackrest",
    serviceName: "Backup / PITR (pgBackRest)",
    category: "data-platform",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "pgbackrest (composed)",
    productionProvider: "pgBackRest",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "WAL archive + restore boundary for PITR.",
    proofRefs: ["proof:service-catalog-registry", "proof:backup-local"],
  },
  {
    serviceKey: "clamav",
    serviceName: "Object malware scanning (ClamAV)",
    category: "security",
    environmentModel: "per-environment",
    visibility: "global_only",
    decision: "compose",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "clamav (composed)",
    productionProvider: "ClamAV",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "fail-closed quarantine scan boundary for uploaded objects.",
    proofRefs: ["proof:service-catalog-registry", "proof:compliance-report-route"],
  },
  {
    serviceKey: "webhook-delivery",
    serviceName: "Outbound webhooks (built-in)",
    category: "developer-platform",
    environmentModel: "per-environment",
    visibility: "not_exposed",
    decision: "build",
    requiresEntitlement: true,
    entitlementKey: "webhooks",
    localProvider: "built-in delivery worker (composed)",
    productionProvider: "built-in",
    mockProvider: null,
    forbiddenInProduction: false,
    isolationNotes: "tenant-scoped subscriptions; secret returned once.",
    proofRefs: ["proof:service-catalog-registry", "proof:webhooks"],
  },
  {
    serviceKey: "localstack",
    serviceName: "AWS mock (LocalStack)",
    category: "developer-platform",
    environmentModel: "mock-only",
    visibility: "global_only",
    decision: "build",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "localstack (cloud-mocks profile)",
    productionProvider: null,
    mockProvider: "localstack",
    forbiddenInProduction: true,
    isolationNotes: "MOCK ONLY; its secretsmanager is not the secrets capability.",
    proofRefs: ["proof:service-catalog-registry"],
  },
  {
    serviceKey: "wiremock",
    serviceName: "HTTP API mock (WireMock)",
    category: "developer-platform",
    environmentModel: "mock-only",
    visibility: "not_exposed",
    decision: "build",
    requiresEntitlement: false,
    entitlementKey: null,
    localProvider: "wiremock (external-mocks profile)",
    productionProvider: null,
    mockProvider: "wiremock",
    forbiddenInProduction: true,
    isolationNotes: "MOCK ONLY; not routed through forward-auth; never linked in UI.",
    proofRefs: ["proof:service-catalog-registry"],
  },
];

export const STATIC_PROVIDER_REGISTRY: ProviderRegistry = {
  list: () => SERVICE_CATALOG_SEED,
};

export interface ServiceCatalogView {
  /** true = system-operator/global view (sees everything except `not_exposed`-to-tenant rules); */
  operator: boolean;
  /** entitlement keys the tenant holds (used to filter `requiresEntitlement` entries for tenants). */
  entitledKeys?: ReadonlySet<string>;
}

/**
 * Build the catalog for a viewer. Visibility filtering (ADR-ACT-0233):
 *   - `not_exposed` is never listed to a tenant;
 *   - `global_only` is operator-only;
 *   - `tenant_scoped_safe` is shown to tenants;
 *   - a `requiresEntitlement` entry is hidden from a tenant lacking that entitlement.
 * The operator view returns everything (no secrets are present in any entry).
 */
export function buildServiceCatalog(
  view: ServiceCatalogView,
  registry: ProviderRegistry = STATIC_PROVIDER_REGISTRY
): ServiceCatalogResponse {
  const all = registry.list();
  const services = view.operator
    ? [...all]
    : all.filter((e) => {
        if (e.visibility !== "tenant_scoped_safe") return false;
        if (e.requiresEntitlement && e.entitlementKey) {
          return view.entitledKeys?.has(e.entitlementKey) ?? false;
        }
        return true;
      });
  return { services, generatedFrom: "platform-services + service-clickthrough (ADR-0055 seed)" };
}

/**
 * Provider-environment invariant (ADR-0055): a mock/forbidden-in-production provider
 * must never be selected as the active provider in a production environment. Returns
 * the offending entries for the given environment (empty = safe).
 */
export function forbiddenProvidersForEnvironment(
  environment: string,
  registry: ProviderRegistry = STATIC_PROVIDER_REGISTRY
): ServiceCatalogEntry[] {
  const isProd = /^prod(uction)?$/i.test(environment);
  if (!isProd) return [];
  return registry.list().filter((e) => e.forbiddenInProduction);
}
