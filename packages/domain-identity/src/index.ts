export const packageName = "@platform/domain-identity";

// --- Value types (pure TypeScript, no Zod) ---

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: string; // "keycloak" | "github" etc.
  providerSubject: string;
  createdAt: Date;
}

export interface Organisation {
  id: string;
  slug: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  id: string;
  userId: string;
  organisationId: string;
  role: TenantRole;
  createdAt: Date;
  updatedAt: Date;
}

export type TenantRole = "tenant-admin" | "manager" | "member" | "viewer";
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
    "platform.clickthrough.wiremock",
    "platform.clickhouse",
    "platform.audit.read_all",
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
    "tenant.auth.settings.read",
    "tenant.auth.settings.write",
    "tenant.audit.read",
    "tenant.clickthrough.keycloak",
    "tenant.clickthrough.mailpit",
    "tenant.clickthrough.sentry",
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
