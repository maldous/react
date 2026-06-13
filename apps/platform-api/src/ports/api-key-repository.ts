// ---------------------------------------------------------------------------
// API key repository port (ADR-0065 / ADR-ACT-0257).
//
// Tenant-scoped programmatic credentials. The repository stores ONLY the hash +
// salt + non-secret prefix — never the plaintext secret. Tenant self-service uses
// withTenant (RLS-scoped); operator/cross-tenant reads + verification use
// withSystemAdmin (rls_bypass). No method returns the secret or the hash.
// ---------------------------------------------------------------------------

import type { ApiKeyScope } from "@platform/contracts-admin";

/** Stored API-key row, minus the secret (which is never persisted in plaintext). */
export interface ApiKeyRecord {
  id: string;
  organisationId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyRecordInput {
  organisationId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  keySalt: string;
  scopes: ApiKeyScope[];
  createdBy: string;
  expiresAt?: string | undefined;
}

/** Verification material for a presented prefix — salt + hash + tenant + lifecycle. */
export interface ApiKeyVerificationRow {
  id: string;
  organisationId: string;
  keyHash: string;
  keySalt: string;
  scopes: ApiKeyScope[];
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface ApiKeyRepository {
  /** Persist a new key (hash/salt already computed). Returns the stored summary record. */
  create(input: CreateApiKeyRecordInput): Promise<ApiKeyRecord>;
  /** Tenant self-list (RLS-scoped). Never returns secret/hash. */
  listForTenant(organisationId: string): Promise<ApiKeyRecord[]>;
  /** Operator list for a target tenant (rls_bypass). Never returns secret/hash. */
  listForTenantAsOperator(organisationId: string): Promise<ApiKeyRecord[]>;
  /** Revoke a tenant's own key. Returns false when the key is absent for that tenant. */
  revokeForTenant(organisationId: string, keyId: string): Promise<boolean>;
  /** Resolve verification material by the non-secret prefix (operator/rls_bypass). */
  findVerificationByPrefix(keyPrefix: string): Promise<ApiKeyVerificationRow | null>;
  /** Record a successful use (best-effort last_used_at touch). */
  touchLastUsed(keyId: string): Promise<void>;
}
