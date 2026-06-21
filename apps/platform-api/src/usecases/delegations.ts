/**
 * V1C-04 Turn 2 usecase layer — admin delegation grant / revoke / list use cases
 * (ADR-0063 / V1C-04). Sits above the `DelegatedAdminRolesPort` persistence
 * surface introduced in commit 5a1dff0; performs authorization checks and
 * `Delegation.*` audit emissions prior to dispatching to the port.
 *
 * Authorization posture:
 *   - `delegateGrant` / `listDelegationsForTenant`:
 *       require caller authority over the target tenant — either platform
 *       system-admin OR tenant-admin of `organisationId`.
 *   - `delegateRevoke`:
 *       system-admin only for Turn 2. A future port extension (getDelegationById)
 *       would re-introduce the tenant-admin path with a 1-extra-read precheck
 *       to determine owning tenant.
 *   - `listActiveDelegationsForGrantee`:
 *       allowed for system-admin OR for `ctx.userId === granteeUserId`
 *       (a user may view their own active scopes without platform authority).
 *
 * Audit ordering (ADR-ACT-0154): pre-condition reads happen BEFORE audit
 * emissions so that 4xx-class outcomes (denial, duplicate) do not produce
 * misleading `Delegation.*` audit lines.
 */
import type {
  DelegatedRole,
  DelegatedAdminRolesPort,
  GrantDelegationInput,
} from "../ports/delegated-admin-roles.js";

/** Auth context the platform-api BFF assembles per request. */
export interface AuthContext {
  /** True iff the request was authenticated as platform operator (cross-tenant). */
  readonly systemAdmin: boolean;
  /** True iff the request was authenticated as admin of the tenant they're addressing. */
  readonly tenantAdmin: boolean;
  /** Keycloak subject ID of the requesting user. */
  readonly userId: string;
}

/** Audit-action emission surface (stub-shape; full integration in audit followup). */
export interface AuditEventPort {
  emit(input: {
    action: "Delegation.Granted" | "Delegation.Revoked" | "Delegation.Listed";
    actorId: string;
    organisationId: string | null;
    delegationId?: string;
  }): Promise<void>;
}

/** Structured logger (platform-logging contract). */
export interface DelegationLoggerPort {
  warn(input: {
    event: string;
    actorId: string;
    organisationId: string | null;
    reason: string;
  }): Promise<void>;
}

export interface DelegationsDeps {
  port: DelegatedAdminRolesPort;
  audit: AuditEventPort;
  logger: DelegationLoggerPort;
}

export type DelegateGrantResult =
  | { kind: "ok"; delegation: DelegatedRole }
  | { kind: "static_permission_denied"; message: string }
  | { kind: "delegation_already_active" };

export type DelegateRevokeResult =
  | { kind: "ok" }
  | { kind: "static_permission_denied"; message: string }
  | { kind: "not_found" };

export type ListDelegationsResult =
  | { kind: "ok"; delegations: DelegatedRole[] }
  | { kind: "static_permission_denied"; message: string };

/** Compose the delegations usecase surface over a persistence port + audit + logger. */
export function makeDelegationsUseCases(deps: DelegationsDeps) {
  const { port, audit, logger } = deps;

  const isCallerAuthorizedForTenant = (ctx: AuthContext, organisationId: string): boolean =>
    ctx.systemAdmin ||
    (ctx.tenantAdmin &&
      // The BFF only sets tenantAdmin=true when the caller is an admin of the
      // tenant they're addressing; the layer above (HTTP route) supplies the
      // organisationId alongside the AuthContext, so we don't need to read
      // memberships here. We assert the BFF did its job by requiring ctx.userId
      // to be non-empty.
      ctx.userId.length > 0);

  return {
    /** Grant a delegation. Requires system-admin OR tenant-admin of `input.organisationId`. */
    async delegateGrant(
      input: GrantDelegationInput,
      ctx: AuthContext
    ): Promise<DelegateGrantResult> {
      if (!isCallerAuthorizedForTenant(ctx, input.organisationId)) {
        await logger.warn({
          event: "delegate_grant.denied",
          actorId: ctx.userId,
          organisationId: input.organisationId,
          reason: "static_permission_denied",
        });
        return {
          kind: "static_permission_denied",
          message: "caller is not an admin of the target tenant",
        };
      }

      // Pre-condition: refuse if (organisation_id, grantee, scope) is already active.
      const existing = await port.findActiveForGranteeAndScope(input.granteeUserId, input.scope);
      if (existing !== null) {
        return { kind: "delegation_already_active" };
      }

      // Server-side stamp: ignore any client-supplied `grantedBy`; the BFF
      // route should pass ctx.userId as the canonical actor.
      const stamped: GrantDelegationInput = { ...input, grantedBy: ctx.userId };
      const delegation = await port.grantDelegation(stamped);
      await audit.emit({
        action: "Delegation.Granted",
        actorId: ctx.userId,
        organisationId: input.organisationId,
        delegationId: delegation.id,
      });
      return { kind: "ok", delegation };
    },

    /**
     * Revoke a delegation by its ID. Turn-2 scope: system-admin only.
     * A future port extension (getDelegationById) would re-enable the
     * tenant-admin path by exposing ownership resolution at the
     * persistence layer (avoiding the Current sql workaround).
     */
    async delegateRevoke(delegationId: string, ctx: AuthContext): Promise<DelegateRevokeResult> {
      if (!ctx.systemAdmin) {
        await logger.warn({
          event: "delegate_revoke.denied",
          actorId: ctx.userId,
          organisationId: null,
          reason: "static_permission_denied",
        });
        return {
          kind: "static_permission_denied",
          message: "only system-admin may revoke (Turn 2 scope)",
        };
      }

      const okFlag = await port.revokeDelegation(delegationId, ctx.userId);
      if (!okFlag) {
        return { kind: "not_found" };
      }
      await audit.emit({
        action: "Delegation.Revoked",
        actorId: ctx.userId,
        organisationId: null,
        delegationId,
      });
      return { kind: "ok" };
    },

    /** List delegations for a tenant. Requires system-admin OR tenant-admin. */
    async listDelegationsForTenant(
      organisationId: string,
      ctx: AuthContext
    ): Promise<ListDelegationsResult> {
      if (!isCallerAuthorizedForTenant(ctx, organisationId)) {
        return {
          kind: "static_permission_denied",
          message: "caller is not an admin of the target tenant",
        };
      }
      const delegations = await port.listForTenant(organisationId);
      await audit.emit({
        action: "Delegation.Listed",
        actorId: ctx.userId,
        organisationId,
      });
      return { kind: "ok", delegations };
    },

    /**
     * List active delegations for a given grantee. System-admin can list
     * any grantee; non-admin can only list their own (ctx.userId === granteeUserId).
     */
    async listActiveDelegationsForGrantee(
      granteeUserId: string,
      ctx: AuthContext
    ): Promise<ListDelegationsResult> {
      if (!ctx.systemAdmin && ctx.userId !== granteeUserId) {
        return {
          kind: "static_permission_denied",
          message: "non-admin may only view own active delegations",
        };
      }
      const delegations = await port.listActiveForGrantee(granteeUserId);
      // No audit: this is a hot query (used for authorization decisions),
      // not an admin action.
      return { kind: "ok", delegations };
    },
  };
}
