import { createAuditEvent, type AuditEventPort, AuditAction } from "@platform/audit-events";
import type { RealmReadinessProbe } from "@platform/authorisation-runtime";
import type {
  TenantAdminCredential,
  TenantCredentialStore,
} from "../ports/tenant-credential-store.ts";

// ---------------------------------------------------------------------------
// Auth Settings readiness + operator credential attach (ADR-0041 / ADR-ACT-0209)
//
// Readiness lets the SPA distinguish a credential that is configured and working
// from one that is missing, invalid, lacks realm-management rights, or whose
// realm is unreachable — so the Auth section can offer editing only when it is
// actually safe, and otherwise show a precise "why not" instead of an opaque 503.
//
// The probe vocabulary comes from the RealmAdminPort (`RealmReadinessProbe`),
// decided by HTTP status at the Keycloak boundary. We map it to the tenant-facing
// status here. The credential secret is never returned, logged, or audited.
// ---------------------------------------------------------------------------

export type AuthReadinessStatus =
  | "configured"
  | "missing_credential"
  | "invalid_credential"
  | "forbidden_realm_operation"
  | "realm_unreachable";

/** Minimal port surface the readiness/attach usecases need from a realm adapter. */
export interface ReadinessProbe {
  probeReadiness(): Promise<RealmReadinessProbe>;
}

const PROBE_TO_STATUS: Record<
  Exclude<RealmReadinessProbe, "ok">,
  Exclude<AuthReadinessStatus, "configured" | "missing_credential">
> = {
  invalid_credential: "invalid_credential",
  forbidden: "forbidden_realm_operation",
  unreachable: "realm_unreachable",
};

function mapProbe(probe: RealmReadinessProbe): Exclude<AuthReadinessStatus, "missing_credential"> {
  return probe === "ok" ? "configured" : PROBE_TO_STATUS[probe];
}

export interface ReadinessDeps {
  credentialStore: TenantCredentialStore;
  /** Build a probe-capable adapter scoped to this credential + realm. */
  makeProbe: (credential: TenantAdminCredential, realmName: string) => ReadinessProbe;
}

/**
 * Classify the per-tenant Auth Settings credential. Tenant context (organisationId,
 * realmName) must come from the resolved FQDN/session — never the request body.
 */
export async function getAuthSettingsReadiness(
  input: { organisationId: string; realmName: string },
  deps: ReadinessDeps
): Promise<{ status: AuthReadinessStatus }> {
  const credential = await deps.credentialStore.getAuthSettingsCredential(input.organisationId);
  if (!credential) return { status: "missing_credential" };
  const probe = await deps.makeProbe(credential, input.realmName).probeReadiness();
  return { status: mapProbe(probe) };
}

// ---------------------------------------------------------------------------
// Operator-seeded attach (system-admin, global scope)
//
// For tenants that predate automated provisioning. The credential is VALIDATED
// via the readiness probe BEFORE it is stored, so we never persist a credential
// that cannot reach the realm. The secret is never returned, logged, or placed
// in audit metadata — the audit records the clientId only.
// ---------------------------------------------------------------------------

export type AttachCredentialResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "configured" }
  | { kind: "invalid_credential" }
  | { kind: "forbidden_realm_operation" }
  | { kind: "realm_unreachable" };

export interface AttachCredentialInput {
  organisationId: string;
  realmName: string;
  clientId: string;
  clientSecret: string;
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
  ipAddress?: string;
}

export interface AttachCredentialDeps extends ReadinessDeps {
  audit: AuditEventPort;
}

/** attach = first credential; rotate = replace a working one; repair = restore a
 * missing/broken one. All share the validate-before-store primitive (ADR-0044). */
export type CredentialOperation = "attach" | "rotate" | "repair";

const OPERATION_AUDIT_ACTION: Record<CredentialOperation, string> = {
  attach: AuditAction.AuthSettingsCredentialAttached,
  rotate: AuditAction.AuthSettingsCredentialRotated,
  repair: AuditAction.AuthSettingsCredentialRepaired,
};

/**
 * Validate a candidate credential against the tenant realm and, only if it
 * passes, store it (encrypted) with lifecycle metadata. On any non-`ok` probe
 * the existing credential is PRESERVED (nothing is written) and the classified
 * status is returned. Audit-first; the secret never reaches audit, logs, or the
 * result. Shared by attach/rotate/repair — they differ only in the audit action.
 */
export async function applyCredentialLifecycle(
  operation: CredentialOperation,
  input: AttachCredentialInput,
  deps: AttachCredentialDeps
): Promise<AttachCredentialResult> {
  const clientId = input.clientId?.trim();
  const clientSecret = input.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return { kind: "invalid_body", message: "clientId and clientSecret are required" };
  }

  // Validate BEFORE persisting — never store (or replace) with a credential that
  // cannot reach the realm. A failure here leaves any existing credential intact.
  const candidate: TenantAdminCredential = { clientId, clientSecret };
  const probe = await deps.makeProbe(candidate, input.realmName).probeReadiness();
  if (probe !== "ok") {
    return { kind: mapProbe(probe) } as AttachCredentialResult;
  }

  // Audit-first: record the lifecycle write (clientId only — NEVER the secret).
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: input.organisationId,
      action: OPERATION_AUDIT_ACTION[operation],
      resource: "auth_settings",
      resourceId: input.realmName,
      metadata: { realmName: input.realmName, clientId, operation, readiness: "configured" },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );

  await deps.credentialStore.setAuthSettingsCredential(input.organisationId, candidate, {
    rotatedBy: input.actorId,
    validated: true,
  });
  return { kind: "configured" };
}

/** Operator attach (ADR-0041) — the first-credential case of the lifecycle. */
export function attachAuthSettingsCredential(
  input: AttachCredentialInput,
  deps: AttachCredentialDeps
): Promise<AttachCredentialResult> {
  return applyCredentialLifecycle("attach", input, deps);
}
