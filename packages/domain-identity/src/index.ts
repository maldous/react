export const packageName = "@platform/domain-identity";

// --- Value types (pure TypeScript, no Zod) ---

/** Account status is GLOBAL: a user is one record (one email) across all tenants. */
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** Optional global account status; absent ⇒ treated as "active". */
  status?: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: string; // "keycloak" | "github" etc.
  providerSubject: string;
  /** Upstream email at link/last-seen time (informational; never overwrites tenant username). */
  email?: string | null;
  /** When the upstream identity was linked (maps to created_at). */
  createdAt: Date;
  lastSeenAt?: Date | null;
}

export interface Organisation {
  id: string;
  slug: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-scoped membership lifecycle. Runtime source of truth; type derives from it. */
export const MEMBERSHIP_STATUSES = ["invited", "active", "disabled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Membership {
  id: string;
  userId: string;
  organisationId: string;
  role: TenantRole;
  /** Tenant-scoped handle; null when unset. Case-insensitively unique within the org. */
  username?: string | null;
  status: MembershipStatus;
  /** Maps to created_at — when the membership was created (member joined). */
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
  invitedBy?: string | null;
}

/** Tenant-scoped roles. Single runtime source of truth; the type derives from it so
 * the two cannot drift (consumed by @platform/contracts-admin via a drift test). */
export const TENANT_ROLES = ["tenant-admin", "manager", "member", "viewer"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type GlobalRole = "system-admin";
export type AnyRole = TenantRole | GlobalRole;

// --- Business rules ---

export function isGlobalRole(role: AnyRole): role is GlobalRole {
  return role === "system-admin";
}

export function isTenantRole(role: AnyRole): role is TenantRole {
  return !isGlobalRole(role);
}

export function canInviteMembers(role: TenantRole | GlobalRole): boolean {
  return role === "system-admin" || role === "tenant-admin" || role === "manager";
}

export function canUpdateOrganisation(role: TenantRole | GlobalRole): boolean {
  return role === "system-admin" || role === "tenant-admin";
}

export function canUpdateMemberRole(role: TenantRole | GlobalRole): boolean {
  return role === "system-admin" || role === "tenant-admin";
}

export function canAccessAdmin(role: TenantRole | GlobalRole): boolean {
  return role === "system-admin" || role === "tenant-admin";
}

// --- Tenant username (ADR-ACT-0206) ---

/** Tenant-scoped username rules: 3–32 chars of [a-z0-9._-], not leading/trailing
 * separator. Stored as entered; uniqueness is case-insensitive within the org. The
 * username is owned by the tenant and is NEVER auto-derived/overwritten from IdP claims. */
export function validateTenantUsername(username: string): string[] {
  const errors: string[] = [];
  if (typeof username !== "string" || username.trim().length === 0) {
    errors.push("username is required");
    return errors;
  }
  if (username.length < 3 || username.length > 32) {
    errors.push("username must be between 3 and 32 characters");
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(username)) {
    errors.push(
      "username may contain only letters, digits, dot, underscore and hyphen, and must start and end with a letter or digit"
    );
  }
  return errors;
}

// --- Membership status transitions (ADR-ACT-0206) ---

/** Allowed explicit tenant-membership status transitions. 'invited' resolves to 'active'
 * on first login; admins enable/disable between 'active' and 'disabled'. Re-inviting a
 * disabled member is not a status transition (it issues a fresh invitation). */
const MEMBERSHIP_STATUS_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  invited: ["active", "disabled"],
  active: ["disabled"],
  disabled: ["active"],
};

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus
): boolean {
  if (from === to) return true; // idempotent no-op is allowed
  return MEMBERSHIP_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// Validates that a Membership's role is tenant-scoped (not global)
export function validateMembership(membership: Partial<Membership>): string[] {
  const errors: string[] = [];
  if (!membership.userId) errors.push("userId is required");
  if (!membership.organisationId) errors.push("organisationId is required");
  if (!membership.role) errors.push("role is required");
  if (membership.role && isGlobalRole(membership.role as AnyRole)) {
    errors.push("Membership.role must be tenant-scoped; system-admin is not a membership role");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Permission resolution ? ADR-0021
//
// Permissions are the authoritative enforcement primitive. Roles are
// convenience bundles that map to a fixed permission set. This function is
// the single source of truth for that mapping so that both fixture sessions
// (session.ts) and real login (auth callback) use identical permission sets.
// ---------------------------------------------------------------------------

// Note: "member.*" permission strings (member.read, member.invite, member.update_role)
// are pre-ADR-ACT-0185 legacy names carried in role bundles for backward compatibility.
// No route currently enforces them — routes use "tenant.members.*" or "platform.*".
// They remain in system-admin and manager bundles as informational signals only and
// will be cleaned up when a dedicated permissions audit ADR is opened.
const ROLE_PERMISSION_MAP: Record<AnyRole, string[]> = {
  "system-admin": [
    "organisation.read",
    "organisation.update",
    "member.read",
    "member.invite",
    "member.update_role",
    "profile.read_self",
    "profile.update_self",
    "audit.read",
    "platform.admin.access",
    "platform.tenants.create",
    "platform.tenants.read",
    "platform.tenants.update",
    "platform.tenants.delete",
    "platform.clickthrough.pgadmin",
    "platform.clickthrough.keycloak",
    "platform.clickthrough.minio",
    "platform.clickthrough.mailpit",
    "platform.clickthrough.sonarqube",
    "platform.clickthrough.sentry",
    // platform.clickthrough.wiremock removed (ADR-ACT-0233): WireMock is
    // NOT_EXPOSED — granting a clickthrough permission for it was misleading.
    // "platform.clickhouse" corrected to the contracts-auth vocabulary:
    "platform.clickthrough.clickhouse",
    "platform.clickthrough.grafana",
    "platform.audit.read_all",
    "platform.logs.read",
  ],
  "tenant-admin": [
    "organisation.read",
    "organisation.update",
    "profile.read_self",
    "profile.update_self",
    "audit.read",
    "tenant.admin.access",
    "tenant.members.read",
    "tenant.members.invite",
    "tenant.members.update_role",
    "tenant.members.delete",
    "tenant.groups.read",
    "tenant.groups.create",
    "tenant.groups.update",
    "tenant.groups.delete",
    "tenant.suborgs.read",
    "tenant.suborgs.create",
    "tenant.suborgs.update",
    "tenant.suborgs.delete",
    "tenant.features.read",
    "tenant.features.update",
    "tenant.auth.settings.read",
    "tenant.auth.settings.write",
    "tenant.config.read",
    "tenant.config.write",
    "tenant.email.settings.read",
    "tenant.email.settings.write",
    "tenant.domains.read",
    "tenant.domains.write",
    "tenant.storage.read",
    "tenant.storage.write",
    "tenant.observability.read",
    "tenant.webhooks.read",
    "tenant.webhooks.write",
    "tenant.platform.read",
    "tenant.audit.read",
    // tenant.clickthrough.mailpit + sentry removed (ADR-ACT-0233): Mailpit is a
    // shared unfiltered inbox and the Sentry tenant route never existed — both
    // are GLOBAL_ONLY. Keycloak stays: realm scoping is enforced by Keycloak's
    // own admin authentication (see usecases/service-clickthrough.ts).
    "tenant.clickthrough.keycloak",
  ],
  manager: [
    "organisation.read",
    "member.read",
    "member.invite",
    "member.update_role",
    "profile.read_self",
    "profile.update_self",
  ],
  member: ["organisation.read", "member.read", "profile.read_self", "profile.update_self"],
  viewer: ["organisation.read", "member.read", "profile.read_self", "profile.update_self"],
};

/**
 * Returns the resolved permission strings for a given role (ADR-0021).
 * Permissions are the authoritative enforcement primitive; roles are bundles.
 */
export function resolvePermissions(role: AnyRole): string[] {
  return ROLE_PERMISSION_MAP[role] ?? [];
}

// ---------------------------------------------------------------------------
// Reserved slugs ? must never be used as tenant slugs to prevent domain
// conflicts with platform environments and tool subdomains.
//
// These slugs would collide with Caddy-routed subdomains or environment
// apex domains (ADR-0033). If a tenant claimed "staging.aldous.info" it
// would shadow the real staging environment.
// ---------------------------------------------------------------------------
export const RESERVED_SLUGS = new Set([
  // Environment apex domains (ADR-0033)
  "staging",
  "prod",
  "production",
  "dev",
  "test",
  // Auth / application entry paths
  "login",
  "sso",
  "account",
  // Caddy-routed tool subdomains (compose.yaml profiles, Caddyfile)
  "kc",
  "keycloak",
  "mailpit",
  "minio",
  "sonar",
  "sonarqube",
  "wiremock",
  "clickhouse",
  "sentry",
  "otel",
  "opentelemetry",
  "pgadmin",
  "grafana",
  "monitoring",
  "localstack",
  // Common infrastructure subdomains
  "admin",
  "api",
  "www",
  "mail",
  "app",
  "auth",
  "help",
  "status",
  "docs",
  "health",
  "monitor",
  "assets",
  "static",
  "cdn",
  "support",
  // Platform-reserved terms
  "global",
  "platform",
  "root",
  "system",
  "aldous",
]);

/**
 * Check whether a slug is reserved and cannot be used as a tenant slug.
 */
export function isSlugReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

// ---------------------------------------------------------------------------
// Host identity ? ADR-ACT-0231
//
// Host identity is a first-class domain concept, distinct from organisation
// identity. Every inbound Host (or X-Forwarded-Host) value classifies into
// exactly one of these kinds. The classifier is PURE: it never touches DNS,
// the database, or the environment ? the apex domain is a parameter. Callers
// (tenant resolver, pipeline scope enforcement, forward-auth) decide what each
// kind may do; this module only names what the host IS.
// ---------------------------------------------------------------------------

export type HostIdentityKind =
  /** The configured apex itself ? the global/system host. */
  | "apex"
  /** `{slug}.{apex}` with a well-formed, non-reserved slug. May resolve to a tenant. */
  | "tenant_slug"
  /** `{slug}.{apex}` where the slug is reserved (tool/environment names). Never a tenant. */
  | "reserved_subdomain"
  /** A subdomain of the apex that can never be a tenant slug (dotted/invalid label). */
  | "invalid_subdomain"
  /** A syntactically valid hostname outside the apex zone ? possibly a registered
   * custom tenant domain; resolution against the domain registry decides. */
  | "custom_domain_candidate"
  /** Not a parseable hostname (empty, illegal characters, bad labels, IP-like noise). */
  | "malformed";

export interface HostIdentity {
  kind: HostIdentityKind;
  /** Lowercased hostname with any `:port` suffix removed. Empty when malformed. */
  hostname: string;
  /** The port suffix when one was present (e.g. "8081"), else null. */
  port: string | null;
  /** The tenant slug ? non-null only for kind === "tenant_slug". */
  slug: string | null;
}

const HOSTNAME_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG_RE = /^[a-z0-9-]+$/;

function isWellFormedHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  return hostname.split(".").every((label) => HOSTNAME_LABEL_RE.test(label));
}

/**
 * Classify a raw Host header value against the apex domain. Pure; total
 * (every input maps to exactly one kind). Port suffixes are stripped before
 * matching ? consistent with the resolver behaviour proven in ADR-ACT-0225.
 */
export function classifyHostIdentity(rawHost: string, apexDomain: string): HostIdentity {
  const trimmed = (rawHost ?? "").trim().toLowerCase();
  const malformed: HostIdentity = { kind: "malformed", hostname: "", port: null, slug: null };
  if (trimmed.length === 0) return malformed;

  const colonIdx = trimmed.indexOf(":");
  const hostname = colonIdx === -1 ? trimmed : (trimmed.slice(0, colonIdx) ?? "");
  const portPart = colonIdx === -1 ? null : trimmed.slice(colonIdx + 1);
  // A port suffix, when present, must be purely numeric (rejects IPv6 literals
  // and header smuggling like "host:port:junk" ? neither is a tenant host).
  const port = portPart === null ? null : /^\d{1,5}$/.test(portPart) ? portPart : null;
  if (portPart !== null && port === null) return malformed;
  if (!isWellFormedHostname(hostname)) return malformed;

  const apex = apexDomain.toLowerCase();
  if (hostname === apex) return { kind: "apex", hostname, port, slug: null };

  if (hostname.endsWith(`.${apex}`)) {
    const prefix = hostname.slice(0, hostname.length - apex.length - 1);
    if (!SLUG_RE.test(prefix)) {
      return { kind: "invalid_subdomain", hostname, port, slug: null };
    }
    if (isSlugReserved(prefix)) {
      return { kind: "reserved_subdomain", hostname, port, slug: null };
    }
    return { kind: "tenant_slug", hostname, port, slug: prefix };
  }

  return { kind: "custom_domain_candidate", hostname, port, slug: null };
}

// Validates that an Organisation slug is well-formed and not reserved
export function validateOrganisationSlug(slug: string): string[] {
  const errors: string[] = [];
  if (!slug || slug.trim().length === 0) errors.push("slug is required");
  if (!/^[a-z0-9-]+$/.test(slug))
    errors.push("slug must contain only lowercase letters, digits, and hyphens");
  if (slug.startsWith("-") || slug.endsWith("-"))
    errors.push("slug must not start or end with a hyphen");
  if (slug.length < 2 || slug.length > 63) errors.push("slug must be between 2 and 63 characters");
  if (RESERVED_SLUGS.has(slug))
    errors.push(`"${slug}" is reserved and cannot be used as a tenant slug`);
  return errors;
}
