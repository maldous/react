/**
 * DelegatedAdminRoles port (ADR-0063 / V1C-04).
 *
 * Persistence-only interface for tenant-scoped + cross-tenant delegated
 * administration grants. Audit emission is the usecase-layer responsibility
 * (ADR-ACT-0154 audit-before-mutation pattern) — this port does NOT emit
 * audit events. The implementation (PostgresDelegatedAdminRoles in
 * apps/platform-api/src/adapters/) lives behind this port so the use-case
 * can be tested with in-memory fakes per the campaign-conventional
 * groups.test.ts pattern.
 *
 * Hot-path note: `findActiveForGranteeAndScope` is called by the auth
 * resolution on every grantee request. The Turn-2 risk-register entry
 * records the requirement that resolvePermissions cache these lookups
 * per session / per request, NOT hit Postgres on every request.
 */

/** A row representing one active or historical delegation grant. */
export interface DelegatedRole {
  id: string;
  organisationId: string;
  granterUserId: string;
  granteeUserId: string;
  scope: string;
  grantedAt: string; // ISO-8601
  grantedBy: string;
  /** null = never expires. ISO-8601 when present. */
  expiresAt: string | null;
  /** non-null = soft-deleted; the row stays for audit. ISO-8601 when present. */
  revokedAt: string | null;
  /** Actor who originated the revocation; null while active. PLAINTEXT (Keycloak user ID). */
  revokedBy: string | null;
}

/** Input to grantDelegation. The actor + grantee + scope + TTL are required. */
export interface GrantDelegationInput {
  organisationId: string;
  granterUserId: string;
  granteeUserId: string;
  grantedBy: string;
  scope: string;
  /** null = never expires; ISO-8601 string when present. */
  expiresAt: string | null;
}

/** Persistence port for the delegated admin roles capability. */
export interface DelegatedAdminRolesPort {
  /**
   * Inserts a new delegation row. Writes through `withSystemAdmin` in the
   * postgres adapter because the BFF's use-case layer has already validated
   * the grantor authority and tenant scoping; the persistence layer does
   * not duplicate those checks.
   *
   * Returns the persisted DelegatedRole with the auto-generated id +
   * grantedAt timestamp populated.
   */
  grantDelegation(input: GrantDelegationInput): Promise<DelegatedRole>;

  /**
   * Soft-deletes an active delegation by setting `revoked_at = now()` +
   * `revoked_by = actorId`. Returns true if a row was updated; false if
   * the delegation id is unknown OR the row was already revoked.
   *
   * Writes through `withSystemAdmin` per the audit-first ordering
   * (the usecase fires the audit BEFORE invoking revoke; the adapter
   * does not emit audit).
   */
  revokeDelegation(delegationId: string, revokedBy: string): Promise<boolean>;

  /**
   * Tenant-scoped list of ALL delegations (active + expired + revoked) for
   * a given tenant. Powers the tenant-admin UI (`/api/admin/delegated-admin/roles`).
   * Uses `withTenant` so RLS enforces tenant isolation.
   */
  listForTenant(organisationId: string): Promise<DelegatedRole[]>;

  /**
   * Cross-tenant aggregate: all currently-active delegations for a grantee.
   * Used by the platform-admin console + the authorisation-resolution
   * pre-warming step. Filters out expired (expires_at <= now()) AND
   * revoked (revoked_at IS NOT NULL) rows. Reads through `withSystemAdmin`
   * because the caller may be the platform-admin regardless of tenant.
   */
  listActiveForGrantee(granteeUserId: string): Promise<DelegatedRole[]>;

  /**
   * Hot-path lookup: a single active delegation for a (grantee, scope) tuple,
   * or null if none exists. Used by the authorisation hot-path.
   * Filters out expired AND revoked rows.
   *
   * Read-through `withSystemAdmin` because the grantee look-up is
   * tenant-agnostic during auth resolution; per-tenant restriction comes
   * from the calling tenant context layer, not this row filter.
   */
  findActiveForGranteeAndScope(granteeUserId: string, scope: string): Promise<DelegatedRole | null>;
}
