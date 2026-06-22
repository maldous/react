/**
 * Tenant domain lifecycle operations (ADR-ACT-0232).
 *
 * Activation, deactivation, local routing probe, and canonical management for
 * custom domains — all under `tenant.domains.write` (domain-only operations no
 * longer require `tenant.auth.settings.write`; the auth-client mutation goes
 * through an injected AuthClientDomainPort).
 *
 * Guards are PURE functions of the registry record so every rule is
 * deterministic and unit-tested. All operations are audit-first (the audit
 * event is emitted before the external mutation, ADR-ACT-0154 pattern) and
 * carry safe metadata only (domain names — public DNS values; never secrets).
 *
 * Honesty rules:
 *   - activation requires DNS-verified ownership
 *   - routing_local_active is set ONLY when the live local probe proved the
 *     expected tenant context; the probe never claims public routing
 *   - canonical requires verified + auth-client-active + proven routing, and
 *     flips redirect_policy to redirect_slug_to_canonical as the local
 *     cutover proof once canonical is set
 */

import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  TenantDomainRecord,
  TenantDomainRegistryPort,
} from "../ports/tenant-domain-registry.ts";
import type { LocalRoutingProbePort } from "../ports/domain-routing-probe.ts";

export interface AuthClientDomainPort {
  /** Add https://{domain}/auth/callback + origin to the tenant BFF client. */
  addRedirectOrigin(domain: string): Promise<void>;
  /** Remove the redirect URI + origin from the tenant BFF client. */
  removeRedirectOrigin(domain: string): Promise<void>;
}

export interface LifecycleActor {
  actorId: string;
  actorRoles: string[];
}

export interface LifecycleDeps {
  registry: TenantDomainRegistryPort;
  audit: AuditEventPort;
}

// ---------------------------------------------------------------------------
// Pure guards
// ---------------------------------------------------------------------------

export type ActivationGuard =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_verified" | "already_active" };

export function canActivateAuthClient(record: TenantDomainRecord | null): ActivationGuard {
  if (!record || record.disabledAt) return { ok: false, reason: "not_found" };
  if (record.ownershipStatus !== "verified") return { ok: false, reason: "not_verified" };
  if (record.authClientStatus === "active") return { ok: false, reason: "already_active" };
  return { ok: true };
}

export type CanonicalGuard =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "not_verified" | "auth_client_inactive" | "routing_not_proven";
    };

export function canSetCanonical(record: TenantDomainRecord | null): CanonicalGuard {
  if (!record || record.disabledAt) return { ok: false, reason: "not_found" };
  if (record.ownershipStatus !== "verified") return { ok: false, reason: "not_verified" };
  if (record.authClientStatus !== "active") return { ok: false, reason: "auth_client_inactive" };
  if (record.routingStatus === "routing_unknown")
    return { ok: false, reason: "routing_not_proven" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type ActivationResult =
  | { kind: "ok"; record: TenantDomainRecord }
  | { kind: "not_found" }
  | { kind: "not_verified" }
  | { kind: "already_active" };

export async function activateDomainAuthClient(
  input: { organisationId: string; domain: string } & LifecycleActor,
  deps: LifecycleDeps & { authClient: AuthClientDomainPort }
): Promise<ActivationResult> {
  const domain = input.domain.toLowerCase();
  const record = await deps.registry.getDomain(input.organisationId, domain);
  const guard = canActivateAuthClient(record);
  if (!guard.ok) return { kind: guard.reason };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.TenantDomainAuthClientActivated,
      resource: "tenant_domain",
      resourceId: domain,
      metadata: { domain, before: record!.authClientStatus, after: "active" },
    })
  );
  // Keycloak mutation FIRST — the registry only records 'active' after the
  // client update actually succeeded (a thrown error leaves it inactive).
  await deps.authClient.addRedirectOrigin(domain);
  await deps.registry.markAuthClientActive(input.organisationId, domain);
  const updated = await deps.registry.getDomain(input.organisationId, domain);
  return { kind: "ok", record: updated! };
}

export type DeactivationResult = { kind: "ok" } | { kind: "not_found" } | { kind: "not_active" };

export async function deactivateDomainAuthClient(
  input: { organisationId: string; domain: string } & LifecycleActor,
  deps: LifecycleDeps & { authClient: AuthClientDomainPort }
): Promise<DeactivationResult> {
  const domain = input.domain.toLowerCase();
  const record = await deps.registry.getDomain(input.organisationId, domain);
  if (!record) return { kind: "not_found" };
  if (record.authClientStatus !== "active") return { kind: "not_active" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.TenantDomainAuthClientDeactivated,
      resource: "tenant_domain",
      resourceId: domain,
      metadata: { domain, wasCanonical: record.canonical, before: "active", after: "inactive" },
    })
  );
  await deps.authClient.removeRedirectOrigin(domain);
  await deps.registry.markAuthClientInactive(input.organisationId, domain);
  return { kind: "ok" };
}

export interface RoutingProbeOutcome {
  reachable: boolean;
  tenantContextMatched: boolean;
  routing: "routing_unknown" | "routing_local_active";
  record: TenantDomainRecord | null;
}

/**
 * Live LOCAL routing probe. Marks routing_local_active ONLY on a positive
 * probe; a failed/unreachable probe records nothing (status stays whatever it
 * was — an earlier proven state is not erased by a transient probe failure,
 * but it is also never upgraded). Local-only by construction.
 */
export async function probeDomainLocalRouting(
  input: { organisationId: string; domain: string; expectedSlug: string } & LifecycleActor,
  deps: LifecycleDeps & { probe: LocalRoutingProbePort }
): Promise<RoutingProbeOutcome | { kind: "not_found" }> {
  const domain = input.domain.toLowerCase();
  const record = await deps.registry.getDomain(input.organisationId, domain);
  if (!record) return { kind: "not_found" };

  const result = await deps.probe.probe(domain, input.expectedSlug);
  const matched = result.reachable && result.tenantContextMatched;
  if (matched) {
    await deps.audit.emit(
      createAuditEvent({
        actorId: input.actorId,
        actorRoles: input.actorRoles,
        tenantId: input.organisationId,
        action: AuditAction.TenantDomainRoutingLocalProven,
        resource: "tenant_domain",
        resourceId: domain,
        metadata: {
          domain,
          probe: "local",
          before: record.routingStatus,
          after: "routing_local_active",
        },
      })
    );
    await deps.registry.markRoutingLocalActive(input.organisationId, domain);
  }
  return {
    reachable: result.reachable,
    tenantContextMatched: result.tenantContextMatched,
    routing: matched ? "routing_local_active" : "routing_unknown",
    record: await deps.registry.getDomain(input.organisationId, domain),
  };
}

export type CanonicalResult =
  | { kind: "ok"; record: TenantDomainRecord }
  | { kind: "not_found" }
  | { kind: "not_verified" }
  | { kind: "auth_client_inactive" }
  | { kind: "routing_not_proven" };

export async function setCanonicalDomain(
  input: { organisationId: string; domain: string } & LifecycleActor,
  deps: LifecycleDeps
): Promise<CanonicalResult> {
  const domain = input.domain.toLowerCase();
  const record = await deps.registry.getDomain(input.organisationId, domain);
  const guard = canSetCanonical(record);
  if (!guard.ok) return { kind: guard.reason };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.TenantDomainCanonicalSet,
      resource: "tenant_domain",
      resourceId: domain,
      metadata: { domain, redirectPolicy: record!.redirectPolicy, before: false, after: true },
    })
  );
  await deps.registry.setCanonical(input.organisationId, domain);
  const updated = await deps.registry.getDomain(input.organisationId, domain);
  return { kind: "ok", record: updated! };
}

export async function unsetCanonicalDomain(
  input: { organisationId: string; domain: string } & LifecycleActor,
  deps: LifecycleDeps
): Promise<{ kind: "ok"; record: TenantDomainRecord } | { kind: "not_found" }> {
  const domain = input.domain.toLowerCase();
  const record = await deps.registry.getDomain(input.organisationId, domain);
  if (!record) return { kind: "not_found" };

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.TenantDomainCanonicalUnset,
      resource: "tenant_domain",
      resourceId: domain,
      metadata: { domain, before: record.canonical, after: false },
    })
  );
  await deps.registry.unsetCanonical(input.organisationId, domain);
  const updated = await deps.registry.getDomain(input.organisationId, domain);
  return { kind: "ok", record: updated! };
}
