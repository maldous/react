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
// Permission resolution — ADR-0021
//
// Permissions are the authoritative enforcement primitive. Roles are
// convenience bundles that map to a fixed permission set. This function is
// the single source of truth for that mapping so that both fixture sessions
// (session.ts) and real login (auth callback) use identical permission sets.
// ---------------------------------------------------------------------------

const ROLE_PERMISSION_MAP: Record<AnyRole, string[]> = {
  "system-admin": [
    "organisation.read",
    "organisation.update",
    "member.read",
    "member.invite",
    "member.update_role",
    "profile.read_self",
    "profile.update_self",
    "admin.access",
    "audit.read",
  ],
  "tenant-admin": [
    "organisation.read",
    "organisation.update",
    "member.read",
    "member.invite",
    "member.update_role",
    "profile.read_self",
    "profile.update_self",
    "admin.access",
    "audit.read",
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

// Validates that an Organisation slug is well-formed
export function validateOrganisationSlug(slug: string): string[] {
  const errors: string[] = [];
  if (!slug || slug.trim().length === 0) errors.push("slug is required");
  if (!/^[a-z0-9-]+$/.test(slug))
    errors.push("slug must contain only lowercase letters, digits, and hyphens");
  if (slug.startsWith("-") || slug.endsWith("-"))
    errors.push("slug must not start or end with a hyphen");
  if (slug.length < 2 || slug.length > 63) errors.push("slug must be between 2 and 63 characters");
  return errors;
}
