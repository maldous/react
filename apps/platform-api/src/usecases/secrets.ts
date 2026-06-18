// ---------------------------------------------------------------------------
// Secrets usecase (ADR-0069 / ADR-ACT-0265) — Tier-1 kernel: runtime secrets.
//
// Operator-managed central secret store behind SecretStorePort. Mutations are
// audit-before-change (metadata only — the value NEVER appears in an audit row).
// The read/list surface returns value-free metadata; the plaintext is only ever
// available server-internally via store.resolve() and is never wired to a response.
// Server-authoritative; the active backend (built-in Postgres or composed OpenBao)
// is selected at the composition root behind this port.
// ---------------------------------------------------------------------------

import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  SecretRefListResponse,
  SecretRefSummary,
  SecretStoreReadinessResponse,
} from "@platform/contracts-admin";
import type { SecretMetadata, SecretStore } from "../ports/secret-store.ts";

export interface SecretsDeps {
  store: SecretStore;
  audit: AuditEventPort;
}

export interface SecretsActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

function toSummary(m: SecretMetadata): SecretRefSummary {
  return {
    ref: m.ref,
    name: m.name,
    provider: m.provider,
    version: m.version,
    revoked: m.revoked,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    revokedAt: m.revokedAt,
  };
}

export async function listSecrets(
  organisationId: string,
  deps: SecretsDeps
): Promise<SecretRefListResponse> {
  const metas = await deps.store.list(organisationId);
  return { secrets: metas.map(toSummary) };
}

/** Create or rotate a secret by name. Audit-before-change; returns metadata only. */
export async function putSecret(
  input: { organisationId: string; name: string; value: string; actor: SecretsActor },
  deps: SecretsDeps
): Promise<SecretRefSummary> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.SecretRefCreated,
      resource: "secret_ref",
      resourceId: input.name,
      // metadata carries the NAME only — never the value or the resolved ref content.
      metadata: { name: input.name },
      sourceHost: input.actor.sourceHost,
    })
  );
  const meta = await deps.store.put({
    organisationId: input.organisationId,
    name: input.name,
    value: input.value,
    actorId: input.actor.actorId,
  });
  return toSummary(meta);
}

export type SecretMutationResult = { kind: "ok" } | { kind: "not_found" };

export async function revokeSecret(
  input: { organisationId: string; ref: string; actor: SecretsActor },
  deps: SecretsDeps
): Promise<SecretMutationResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.SecretRefRevoked,
      resource: "secret_ref",
      resourceId: input.ref,
      sourceHost: input.actor.sourceHost,
    })
  );
  const ok = await deps.store.revoke(input.organisationId, input.ref, input.actor.actorId);
  return ok ? { kind: "ok" } : { kind: "not_found" };
}

export async function deleteSecret(
  input: { organisationId: string; ref: string; actor: SecretsActor },
  deps: SecretsDeps
): Promise<SecretMutationResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.SecretRefDeleted,
      resource: "secret_ref",
      resourceId: input.ref,
      sourceHost: input.actor.sourceHost,
    })
  );
  const ok = await deps.store.delete(input.organisationId, input.ref, input.actor.actorId);
  return ok ? { kind: "ok" } : { kind: "not_found" };
}

/** Operator readiness of the active secret backend (no secret-bearing fields). */
export async function secretStoreReadiness(
  deps: SecretsDeps
): Promise<SecretStoreReadinessResponse> {
  const r = await deps.store.readiness();
  return { provider: r.provider, status: r.status, detail: r.detail };
}
