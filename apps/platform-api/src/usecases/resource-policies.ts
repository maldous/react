import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { KeycloakRealmAdminAdapter } from "@platform/adapters-keycloak";
import type { ResourcePolicy } from "@platform/authorisation-runtime";

export interface ResourcePoliciesInput {
  organisationId: string;
  realmName: string;
  actorId: string;
  actorRoles: string[];
}

export interface SetResourcePolicyInput extends ResourcePoliciesInput {
  resourceName: string;
  policy: ResourcePolicy;
}

/**
 * List all resource policies for a tenant realm.
 * Read-only — no audit emitted (matching ADR-ACT-0154 pattern: reads don't audit).
 */
export async function getResourcePolicies(
  input: ResourcePoliciesInput,
  deps: { adapter: KeycloakRealmAdminAdapter }
): Promise<{ policies: ResourcePolicy[] }> {
  const policies = await deps.adapter.getResourcePolicy("*");
  return { policies };
}

/**
 * Set a resource policy for a tenant realm.
 * Audit emitted before Keycloak mutation (ADR-ACT-0154 pattern).
 */
export async function setResourcePolicy(
  input: SetResourcePolicyInput,
  deps: { adapter: KeycloakRealmAdminAdapter; audit: AuditEventPort }
): Promise<{ kind: "ok" }> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.AuthSettingsIdpChanged,
      resource: "resource_policy",
      resourceId: input.resourceName,
      metadata: {
        resourceName: input.resourceName,
        policyType: input.policy.type,
        policyName: input.policy.name,
      },
    })
  );
  await deps.adapter.setResourcePolicy(input.resourceName, input.policy);
  return { kind: "ok" };
}
