import type {
  CapabilityCategory,
  CapabilityImplementationStatus,
  CapabilityReadiness,
  CapabilitySummary,
  EmailSenderReadinessStatus,
  TenantDomainReadinessStatus,
  TenantStorageReadinessStatus,
  TenantObservabilityReadinessStatus,
  WebhookReadinessStatus,
  TenantReadinessResponse,
  TenantReadinessStatus,
} from "@platform/contracts-admin";
import type { AuthReadinessStatus } from "./auth-settings-readiness.ts";

// ---------------------------------------------------------------------------
// Enterprise control-plane Capability Registry (ADR-0045 / ADR-ACT-0213)
//
// A single, server-owned inventory of every enterprise control-plane capability,
// with its implementation status and how its per-tenant readiness is determined.
// Readiness is NEVER faked: a capability is `ready` only via a live check
// (`readinessKind` that consumes a real signal) or a documented local invariant
// (`invariant-ready`). Anything not yet verifiable is `deferred`/`unknown`.
//
// Live IO (probing the credential, counting admins, listing IdPs) happens in the
// route; `buildTenantReadiness` is a PURE function of the gathered signals so the
// mapping + aggregation are deterministic and unit-tested.
// ---------------------------------------------------------------------------

/** How a capability's per-tenant readiness is computed from the signals. */
export type ReadinessKind =
  | "tenant-context" // ready by virtue of a resolved tenant
  | "auth-credential" // from the auth-settings credential readiness probe
  | "credential-derived" // depends on the credential being configured
  | "idp-count" // optional; ready when ≥1 IdP, else incomplete
  | "admin-count" // ready when ≥1 active tenant-admin, else blocked
  | "providers" // resolved (env default or tenant override) → ready
  | "email-sender" // from the tenant email sender readiness (ADR-0047)
  | "tenant-domains" // from the tenant custom-domain readiness (ADR-0048)
  | "tenant-storage" // from the tenant storage readiness (ADR-0049)
  | "tenant-observability" // from the tenant observability readiness (ADR-0050)
  | "tenant-webhooks" // from the tenant webhooks readiness (ADR-0051)
  | "invariant-ready" // ready by construction (documented local invariant)
  | "deferred"; // not yet checkable — never reported ready

export interface CapabilityDefinition {
  key: string;
  category: CapabilityCategory;
  adminRoute: string | null;
  /** Permission required to manage it (documentation; route gating is separate). */
  requiredPermission: string | null;
  implementationStatus: CapabilityImplementationStatus;
  required: boolean;
  readinessKind: ReadinessKind;
  /** Optional i18n key for a missing-action hint when not ready. */
  detailKey: string | null;
}

function cap(
  key: string,
  category: CapabilityCategory,
  opts: Partial<Omit<CapabilityDefinition, "key" | "category">>
): CapabilityDefinition {
  return {
    key,
    category,
    adminRoute: opts.adminRoute ?? null,
    requiredPermission: opts.requiredPermission ?? null,
    implementationStatus: opts.implementationStatus ?? "implemented",
    required: opts.required ?? false,
    readinessKind: opts.readinessKind ?? "deferred",
    detailKey: opts.detailKey ?? null,
  };
}

const A = "feature.admin.readiness.cap"; // i18n key prefix
const labelKey = (key: string): string => `${A}.${key}.label`;
const descriptionKey = (key: string): string => `${A}.${key}.description`;

export const CAPABILITIES: readonly CapabilityDefinition[] = [
  // --- Identity ---
  cap("tenant_record", "identity", {
    implementationStatus: "implemented",
    required: true,
    readinessKind: "tenant-context",
  }),
  cap("tenant_fqdn", "identity", {
    implementationStatus: "implemented",
    required: true,
    readinessKind: "tenant-context",
  }),
  cap("tenant_admin", "identity", {
    adminRoute: "/admin/members",
    requiredPermission: "tenant.members.read",
    implementationStatus: "implemented",
    required: true,
    readinessKind: "admin-count",
    detailKey: `${A}.tenant_admin.action`,
  }),
  cap("member_administration", "identity", {
    adminRoute: "/admin/members",
    requiredPermission: "tenant.members.read",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("roles_permissions", "identity", {
    adminRoute: "/admin/members",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),

  // --- Authentication (OIDC-first) ---
  cap("auth_credential", "authentication", {
    adminRoute: null, // system-admin / API-first (ADR-0044)
    implementationStatus: "implemented",
    required: true,
    readinessKind: "auth-credential",
    detailKey: `${A}.auth_credential.action`,
  }),
  cap("auth_providers", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.read",
    implementationStatus: "implemented",
    required: true,
    readinessKind: "providers",
  }),
  cap("session_policy", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.read",
    implementationStatus: "implemented",
    required: true,
    readinessKind: "credential-derived",
  }),
  cap("mfa_policy", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.read",
    implementationStatus: "implemented",
    required: true,
    readinessKind: "credential-derived",
  }),
  cap("idp_configuration", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.read",
    implementationStatus: "implemented",
    required: false,
    readinessKind: "idp-count",
    detailKey: `${A}.idp_configuration.action`,
  }),

  // --- Configuration ---
  cap("feature_config", "configuration", {
    adminRoute: "/admin/config",
    requiredPermission: "tenant.config.read",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("branding", "configuration", {
    adminRoute: "/admin/config",
    requiredPermission: "tenant.config.read",
    implementationStatus: "partial",
    readinessKind: "invariant-ready",
  }),
  // Custom domains: DNS-ownership proof + add/remove on the tenant auth client are
  // implemented (ADR-0048). TLS issuance and live end-to-end routing/canonical
  // cutover are NOT verified, so the capability is honestly `partial`.
  cap("tenant_domains", "configuration", {
    adminRoute: "/admin/domains",
    requiredPermission: "tenant.domains.read",
    implementationStatus: "partial",
    readinessKind: "tenant-domains",
    detailKey: `${A}.tenant_domains.action`,
  }),
  cap("email_sender", "configuration", {
    adminRoute: "/admin/email",
    requiredPermission: "tenant.email.settings.read",
    implementationStatus: "implemented",
    readinessKind: "email-sender",
    detailKey: `${A}.email_sender.action`,
  }),

  // --- Operations ---
  cap("audit", "operations", {
    adminRoute: "/admin/logs",
    requiredPermission: "tenant.audit.read",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  // Storage: a live write/read/delete probe + prefix-per-tenant isolation guard are
  // implemented (ADR-0049). The aggregate signal is a cheap configured-check; the deep
  // probe runs on /api/org/storage/readiness. IAM-policy enforcement + provisioning are
  // not proven in this pass, so the capability is honestly `partial`.
  cap("storage", "operations", {
    adminRoute: "/admin/storage",
    requiredPermission: "tenant.storage.read",
    implementationStatus: "partial",
    readinessKind: "tenant-storage",
    detailKey: `${A}.storage.action`,
  }),
  // Observability: log search + a bounded tenant-scoped readiness probe + the
  // high-cardinality-label guard are implemented (ADR-0050). Traces, dashboards, and
  // metrics readiness are not wired, so the capability is honestly `partial`.
  cap("observability", "operations", {
    adminRoute: "/admin/observability",
    requiredPermission: "tenant.observability.read",
    implementationStatus: "partial",
    readinessKind: "tenant-observability",
    detailKey: `${A}.observability.action`,
  }),

  // --- Integrations ---
  // Webhooks: subscription CRUD + HMAC-signed reveal-once secret + immediate test
  // (ADR-0051) AND a durable background delivery worker with backoff/dead-letter +
  // real event fan-out (ADR-0052). End-to-end → `implemented`.
  cap("integrations_webhooks", "integrations", {
    adminRoute: "/admin/webhooks",
    requiredPermission: "tenant.webhooks.read",
    implementationStatus: "implemented",
    readinessKind: "tenant-webhooks",
    detailKey: `${A}.integrations_webhooks.action`,
  }),

  // --- OIDC enterprise sub-capabilities (ADR-0046 / ADR-ACT-0215) ---
  // discovery/issuer/JWKS/callback/test are delivered: the feature + its live
  // validation exist and are unit + runtime proven, so they are `invariant-ready`
  // (available by construction; the actual probe runs on demand). claim/group-role
  // mapping is `partial` — configured on the IdP but not yet exercised through a
  // real brokered login, so its readiness stays `deferred` (never faked). Login
  // simulation stays fully `deferred`: no honest non-interactive proof exists.
  cap("oidc_discovery", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.write",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("oidc_issuer_validation", "authentication", {
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("oidc_jwks_validation", "authentication", {
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("oidc_claim_mapping", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.write",
    implementationStatus: "partial",
    readinessKind: "deferred",
  }),
  cap("oidc_group_role_mapping", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.write",
    implementationStatus: "partial",
    readinessKind: "deferred",
  }),
  cap("oidc_test_connection", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.write",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("oidc_callback_display", "authentication", {
    adminRoute: "/admin/auth",
    requiredPermission: "tenant.auth.settings.read",
    implementationStatus: "implemented",
    readinessKind: "invariant-ready",
  }),
  cap("oidc_login_simulation", "authentication", {
    implementationStatus: "deferred",
    readinessKind: "deferred",
  }),
];

/** Live signals gathered by the route; consumed purely here. */
export interface ReadinessSignals {
  /** Auth-settings credential readiness (ADR-0041 probe). */
  authCredential: AuthReadinessStatus;
  /** Count of active tenant-admin members. */
  activeAdminCount: number;
  /** Configured IdP count, or null when it could not be determined (e.g. the
   * credential is not configured so the realm cannot be listed). */
  idpCount: number | null;
  /** Tenant email sender readiness (ADR-0047). */
  emailSender: EmailSenderReadinessStatus;
  /** Tenant custom-domain readiness (ADR-0048). */
  domainReadiness: TenantDomainReadinessStatus;
  /** Tenant storage readiness (ADR-0049) — a cheap configured-check for the aggregate. */
  storageReadiness: TenantStorageReadinessStatus;
  /** Tenant observability readiness (ADR-0050) — a bounded Loki probe. */
  observabilityReadiness: TenantObservabilityReadinessStatus;
  /** Tenant webhooks readiness (ADR-0051) — subscription counts. */
  webhooksReadiness: WebhookReadinessStatus;
}

function capabilityReadiness(kind: ReadinessKind, s: ReadinessSignals): CapabilityReadiness {
  switch (kind) {
    case "tenant-context":
      return "ready";
    case "auth-credential":
      switch (s.authCredential) {
        case "configured":
          return "ready";
        case "missing_credential":
          return "blocked";
        case "invalid_credential":
        case "forbidden_realm_operation":
        case "realm_unreachable":
          return "degraded";
        default:
          return "unknown";
      }
    case "credential-derived":
      return s.authCredential === "configured" ? "ready" : "unknown";
    case "idp-count":
      if (s.idpCount === null) return "unknown";
      return s.idpCount > 0 ? "ready" : "incomplete";
    case "admin-count":
      return s.activeAdminCount > 0 ? "ready" : "blocked";
    case "providers":
      return "ready";
    case "email-sender":
      switch (s.emailSender) {
        case "configured":
          return "ready";
        case "missing_sender":
        case "missing_credential":
          return "incomplete";
        case "invalid_credential":
        case "provider_unreachable":
          return "degraded";
        default:
          return "unknown";
      }
    case "tenant-domains":
      switch (s.domainReadiness) {
        case "verified":
          return "ready";
        case "no_domains":
        case "pending_verification":
          return "incomplete";
        case "degraded":
          return "degraded";
        default:
          return "unknown";
      }
    case "tenant-storage":
      switch (s.storageReadiness) {
        case "configured":
          return "ready";
        case "not_configured":
          return "incomplete";
        case "provider_unreachable":
        case "isolation_failed":
          return "degraded";
        default:
          return "unknown";
      }
    case "tenant-observability":
      switch (s.observabilityReadiness) {
        case "configured":
          return "ready";
        case "not_configured":
          return "incomplete";
        case "provider_unreachable":
        case "degraded":
          return "degraded";
        default:
          return "unknown";
      }
    case "tenant-webhooks":
      switch (s.webhooksReadiness) {
        case "configured":
          return "ready";
        case "no_subscriptions":
          return "incomplete";
        case "degraded":
          return "degraded";
        default:
          return "unknown";
      }
    case "invariant-ready":
      return "ready";
    case "deferred":
      return "deferred";
  }
}

// Worst-status-wins precedence over the REQUIRED capabilities.
const SEVERITY: Record<CapabilityReadiness, number> = {
  blocked: 5,
  degraded: 4,
  incomplete: 3,
  unknown: 2,
  ready: 1,
  deferred: 0,
};

function aggregate(required: CapabilityReadiness[]): TenantReadinessStatus {
  let worst: CapabilityReadiness = "ready";
  for (const r of required) {
    if (SEVERITY[r] > SEVERITY[worst]) worst = r;
  }
  // `deferred` never appears among required capabilities; clamp defensively to ready.
  return (worst === "deferred" ? "ready" : worst) as TenantReadinessStatus;
}

/** Pure: map the registry + signals → the tenant readiness response. */
export function buildTenantReadiness(signals: ReadinessSignals): TenantReadinessResponse {
  const capabilities: CapabilitySummary[] = CAPABILITIES.map((c) => ({
    key: c.key,
    category: c.category,
    labelKey: labelKey(c.key),
    descriptionKey: descriptionKey(c.key),
    adminRoute: c.adminRoute,
    implementationStatus: c.implementationStatus,
    readiness: capabilityReadiness(c.readinessKind, signals),
    required: c.required,
    detailKey: c.detailKey,
  }));
  const overall = aggregate(capabilities.filter((c) => c.required).map((c) => c.readiness));
  return { overall, capabilities };
}
