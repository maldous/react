// ---------------------------------------------------------------------------
// API keys usecase (ADR-0065 / ADR-ACT-0257)
//
// Server-generated, tenant-scoped, entitlement-gated (`api_access`) programmatic
// credentials. The plaintext secret is returned EXACTLY ONCE on creation; only a
// salted+peppered hash is stored. List/read never expose the secret or the hash.
// Create + revoke are audited (audit-before-change). Authentication verifies a
// presented secret in constant time and rejects revoked/expired keys.
// ---------------------------------------------------------------------------

import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import { AuditAction, createAuditEvent, type AuditEventPort } from "@platform/audit-events";
import type { ApiKeyScope, ApiKeySummary, CreateApiKeyResponse } from "@platform/contracts-admin";
import type { ApiKeyRecord, ApiKeyRepository } from "../ports/api-key-repository.ts";
import type { EntitlementRepository } from "../ports/entitlement-repository.ts";
import { generateApiKey, prefixForSecret, verifyApiKey } from "./api-key-crypto.ts";

/** Entitlement that gates minting API keys (deny-by-default). */
export const API_ACCESS_ENTITLEMENT = "api_access";

export interface ApiKeysDeps {
  apiKeys: ApiKeyRepository;
  entitlements: EntitlementRepository;
  audit: AuditEventPort;
}

export interface ApiKeyActor {
  actorId: string;
  actorRoles: string[];
  sourceHost?: string;
}

async function isEntitled(
  entitlements: EntitlementRepository,
  organisationId: string
): Promise<boolean> {
  return (await entitlements.getGrant(organisationId, API_ACCESS_ENTITLEMENT))?.state === "granted";
}

/** Derive the lifecycle state for a stored record (no live verification). */
function stateOf(record: ApiKeyRecord, now: number): ApiKeySummary["state"] {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return "expired";
  return "active";
}

function toSummary(record: ApiKeyRecord, now: number): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scopes: record.scopes,
    state: stateOf(record, now),
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}

export type CreateApiKeyResult =
  | { kind: "ok"; response: CreateApiKeyResponse }
  | { kind: "not_entitled" };

/**
 * Mint a new API key for the tenant. Requires the `api_access` entitlement
 * (deny-by-default). Audit-before-change: the audit write happens before the key
 * is persisted, so a failed audit aborts creation. Returns the plaintext secret
 * exactly once.
 */
export async function createApiKey(
  input: {
    organisationId: string;
    name: string;
    scopes?: ApiKeyScope[];
    expiresAt?: string;
    actor: ApiKeyActor;
  },
  deps: ApiKeysDeps,
  nowMs: number = Date.now()
): Promise<CreateApiKeyResult> {
  if (!(await isEntitled(deps.entitlements, input.organisationId))) {
    return { kind: "not_entitled" };
  }
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
    throw new ValidationError("api.error.invalidExpiry", {
      safeDetails: { field: "expiresAt" },
    });
  }
  const scopes = input.scopes && input.scopes.length ? input.scopes : (["read"] as ApiKeyScope[]);
  const generated = generateApiKey();

  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.ApiKeyCreated,
      resource: "api_key",
      resourceId: generated.keyPrefix,
      // Non-secret metadata only — never the secret or the hash.
      metadata: { name: input.name, scopes, keyPrefix: generated.keyPrefix },
      sourceHost: input.actor.sourceHost,
    })
  );

  const record = await deps.apiKeys.create({
    organisationId: input.organisationId,
    name: input.name,
    keyPrefix: generated.keyPrefix,
    keyHash: generated.keyHash,
    keySalt: generated.keySalt,
    scopes,
    createdBy: input.actor.actorId,
    expiresAt: input.expiresAt,
  });

  return {
    kind: "ok",
    response: {
      apiKey: toSummary(record, nowMs),
      secret: generated.secret,
      secretShownOnce: true,
    },
  };
}

/** List a tenant's API keys (self or operator). Never returns the secret or hash. */
export async function listApiKeys(
  organisationId: string,
  deps: ApiKeysDeps,
  opts: { operator?: boolean } = {},
  nowMs: number = Date.now()
): Promise<{ apiKeys: ApiKeySummary[] }> {
  const records = opts.operator
    ? await deps.apiKeys.listForTenantAsOperator(organisationId)
    : await deps.apiKeys.listForTenant(organisationId);
  return { apiKeys: records.map((r) => toSummary(r, nowMs)) };
}

export type RevokeApiKeyResult = { kind: "ok" } | { kind: "not_found" };

/** Revoke a tenant's own API key (audited). Idempotent — re-revoking is not_found. */
export async function revokeApiKey(
  input: { organisationId: string; keyId: string; actor: ApiKeyActor },
  deps: ApiKeysDeps
): Promise<RevokeApiKeyResult> {
  await deps.audit.emit(
    createAuditEvent({
      actorId: input.actor.actorId,
      actorRoles: input.actor.actorRoles,
      tenantId: input.organisationId,
      action: AuditAction.ApiKeyRevoked,
      resource: "api_key",
      resourceId: input.keyId,
      sourceHost: input.actor.sourceHost,
    })
  );
  const revoked = await deps.apiKeys.revokeForTenant(input.organisationId, input.keyId);
  return revoked ? { kind: "ok" } : { kind: "not_found" };
}

export interface AuthenticatedApiKey {
  organisationId: string;
  keyId: string;
  scopes: ApiKeyScope[];
}

/**
 * Authenticate a presented plaintext secret. Resolves the key by its non-secret
 * prefix, verifies the hash in constant time, and rejects revoked/expired keys.
 * A stored hash can never be presented as a plaintext secret (the prefix shape
 * differs and the hash verification fails). Returns null on any failure.
 */
export async function authenticateApiKey(
  secret: string,
  deps: ApiKeysDeps,
  nowMs: number = Date.now()
): Promise<AuthenticatedApiKey | null> {
  const prefix = prefixForSecret(secret);
  if (!prefix) return null;
  const row = await deps.apiKeys.findVerificationByPrefix(prefix);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && Date.parse(row.expiresAt) <= nowMs) return null;
  if (!verifyApiKey(secret, row.keySalt, row.keyHash)) return null;

  // Deny-by-default: the tenant must still hold the api_access entitlement.
  if (!(await isEntitled(deps.entitlements, row.organisationId))) {
    throw new ForbiddenError("api.error.notEntitled", {
      safeDetails: { entitlement: API_ACCESS_ENTITLEMENT },
    });
  }
  await deps.apiKeys.touchLastUsed(row.id).catch(() => {});
  return { organisationId: row.organisationId, keyId: row.id, scopes: row.scopes };
}
