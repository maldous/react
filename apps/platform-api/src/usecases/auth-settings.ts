import { z } from "zod";
import { createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type {
  TenantAdminCredential,
  TenantCredentialStore,
} from "../ports/tenant-credential-store.ts";
import { classifyRealmError } from "./realm-error.ts";

// Re-export so callers can type the credential without importing the port directly
export type { TenantAdminCredential };

// ---------------------------------------------------------------------------
// Auth Settings mutation usecase (ADR-ACT-0154 / ADR-ACT-0186 / ADR-0030 §1b)
//
// Enforces audit-first discipline with per-tenant credentials for all four
// Auth Settings API mutations. Ordering (ADR-ACT-0186 adds step 3):
//   1. Validate request body — return "invalid_body" without emitting if invalid
//   2. Check tenant context  — return "no_tenant"    without emitting if absent
//   3. Resolve tenant cred   — return "no_credential" without emitting if absent
//   4. Emit audit event      — if this throws, propagate; do NOT call Keycloak
//   5. Call Keycloak adapter — only if audit succeeded; uses tenant credential
//
// Credential values never reach buildAuditMetadata, createAuditEvent, or logs.
// ---------------------------------------------------------------------------

export type AuthSettingsMutationResult =
  | { kind: "invalid_body"; message: string }
  | { kind: "no_tenant" }
  | { kind: "no_credential" }
  | { kind: "invalid_credential" }
  | { kind: "forbidden_realm_operation" }
  | { kind: "realm_unreachable" }
  | { kind: "conflict" }
  | { kind: "not_found" }
  | { kind: "ok" };

export interface AuthSettingsMutationInput<T> {
  rawBody: unknown;
  /** Null when the FQDN could not be resolved to a known tenant. */
  tenantCtx: { organisationId: string; realmName: string } | null;
  actorId: string;
  actorRoles: string[];
  auditAction: string;
  /**
   * Build safe audit metadata from the validated body.
   * Must NOT include secrets, tokens, client credentials, or raw IdP config values.
   * The tenant credential is never passed here.
   */
  buildAuditMetadata: (body: T) => Record<string, unknown>;
  schema: z.ZodType<T>;
  /**
   * The Keycloak mutation to run after a successful audit.
   * Receives the validated body AND the tenant credential — use the credential
   * to construct the KeycloakRealmAdminAdapter with tenant-scoped credentials.
   */
  mutate: (body: T, credential: TenantAdminCredential) => Promise<void>;
  sourceHost?: string;
  ipAddress?: string;
}

export interface AuthSettingsMutationDeps {
  audit: AuditEventPort;
  credentialStore: TenantCredentialStore;
}

export async function mutateAuthSetting<T>(
  input: AuthSettingsMutationInput<T>,
  deps: AuthSettingsMutationDeps
): Promise<AuthSettingsMutationResult> {
  // Step 1: Validate body first — no side effects before validation
  const parsed = input.schema.safeParse(input.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid body" };
  }

  // Step 2: Require resolved tenant context
  if (!input.tenantCtx) {
    return { kind: "no_tenant" };
  }

  const body = parsed.data;
  const { organisationId, realmName } = input.tenantCtx;

  // Step 3: Resolve per-tenant service account credential (ADR-ACT-0186).
  // A missing credential means the tenant was provisioned without a service
  // account (e.g. before this feature) — return early without an audit event
  // (misconfiguration, not an authorization failure).
  const credential = await deps.credentialStore.getAuthSettingsCredential(organisationId);
  if (!credential) {
    return { kind: "no_credential" };
  }

  // Step 4: Emit audit event BEFORE calling Keycloak.
  // If this throws, the mutation does not run.
  // The credential is NOT included in the event — it never reaches audit storage.
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      tenantId: organisationId,
      action: input.auditAction,
      resource: "auth_settings",
      resourceId: realmName,
      metadata: {
        realmName,
        ...input.buildAuditMetadata(body),
      },
      sourceHost: input.sourceHost,
      ipAddress: input.ipAddress,
    })
  );

  // Step 5: Call the Keycloak adapter with the tenant credential.
  // A realm failure here is classified (ADR-0041) so the route can surface a
  // precise status instead of an opaque 500. The audit above already recorded the
  // attempt; classification only changes how the failure is reported. An
  // unclassifiable error is rethrown so it still surfaces as a 500.
  try {
    await input.mutate(body, credential);
  } catch (err) {
    const classified = classifyRealmError(err);
    if (classified === "unknown") throw err;
    return { kind: classified };
  }

  return { kind: "ok" };
}

// ---------------------------------------------------------------------------
// Metadata builders — one per mutation type
//
// Each builder returns only safe, non-sensitive fields for the audit record.
// IdP config values are explicitly excluded as they may contain client secrets,
// SAML signing keys, or other credentials.
// ---------------------------------------------------------------------------

export interface IdpBody {
  alias: string;
  displayName: string;
  providerId: string;
  config?: Record<string, string>;
  enabled: boolean;
}

/** Safe IdP metadata for audit — config VALUES are excluded, only keys recorded. */
export function buildIdpAuditMetadata(body: IdpBody): Record<string, unknown> {
  return {
    alias: body.alias,
    displayName: body.displayName,
    providerId: body.providerId,
    enabled: body.enabled,
    // Deliberately omit config values — may contain client secrets / signing keys.
    // Record only the configuration key names so the audit is informative without
    // leaking credentials.
    configKeys: Object.keys(body.config ?? {}),
  };
}

export interface MfaBody {
  required: string;
  type?: string;
  gracePeriodSeconds?: number;
}

export function buildMfaAuditMetadata(body: MfaBody): Record<string, unknown> {
  return { required: body.required, type: body.type };
}

export interface SessionBody {
  accessTokenLifespanSeconds: number;
  ssoSessionIdleTimeoutSeconds: number;
  ssoSessionMaxLifespanSeconds: number;
  rememberMe: boolean;
}

export function buildSessionAuditMetadata(body: SessionBody): Record<string, unknown> {
  return {
    accessTokenLifespanSeconds: body.accessTokenLifespanSeconds,
    ssoSessionIdleTimeoutSeconds: body.ssoSessionIdleTimeoutSeconds,
    ssoSessionMaxLifespanSeconds: body.ssoSessionMaxLifespanSeconds,
    rememberMe: body.rememberMe,
  };
}

export interface SysadminBrokeringBody {
  enabled: boolean;
  requireMfa?: boolean;
  auditAllAccess?: boolean;
}

export function buildSysadminBrokeringAuditMetadata(
  body: SysadminBrokeringBody
): Record<string, unknown> {
  return {
    enabled: body.enabled,
    requireMfa: body.requireMfa,
    auditAllAccess: body.auditAllAccess,
  };
}
