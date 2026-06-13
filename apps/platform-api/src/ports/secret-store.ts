// ---------------------------------------------------------------------------
// Secret store port (ADR-0069 / ADR-ACT-0265) — Tier-1 kernel: runtime secrets.
//
// A central, audited, tenant-scoped secret store. Callers PUT a secret by logical
// name and receive an OPAQUE `secretRef` (`secret:<uuid>`); the plaintext value is
// never returned by any metadata/list path. `resolve()` is the ONLY value-returning
// method and is server-internal (a consumer fetching its own configured secret) —
// it is NEVER wired to an HTTP response. The built-in Postgres provider is the
// durable default (encrypted at rest); the composed OpenBao provider is a Phase-1
// kernel candidate behind this same port (delivered only when live-proven).
//
// Invariants enforced by the usecase + adapters:
//   - metadata/list/readiness expose NO secret value and NO secret-bearing field;
//   - a revoked secret cannot be resolved (returns null) but keeps its metadata;
//   - tenant A can never resolve or read tenant B's ref (org-scoped + RLS);
//   - readiness is probed honestly — OpenBao unreachable ⇒ degraded, never faked.
// ---------------------------------------------------------------------------

export type SecretProvider = "builtin" | "openbao";

/** Safe, value-free description of a stored secret. Returned by put/get/list. */
export interface SecretMetadata {
  /** Opaque reference used by callers — never the value. */
  ref: string;
  /** Logical name within the tenant (e.g. "smtp/password"). */
  name: string;
  /** Which backend holds the value. */
  provider: SecretProvider;
  /** Bumped on each rotation (put over an existing name). */
  version: number;
  revoked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
}

export interface PutSecretInput {
  organisationId: string;
  name: string;
  /** Plaintext IN only — stored encrypted (builtin) or in OpenBao; never echoed back. */
  value: string;
  actorId: string;
}

export interface SecretStoreReadiness {
  provider: SecretProvider;
  status: "ready" | "degraded";
  detail: string;
}

export interface SecretStore {
  /** Create or rotate a secret by name. Returns metadata + the opaque ref — NEVER the value. */
  put(input: PutSecretInput): Promise<SecretMetadata>;
  /** Metadata for one ref (value-free), or null. Tenant-scoped. */
  getMetadata(organisationId: string, ref: string): Promise<SecretMetadata | null>;
  /** All non-deleted secret metadata for the tenant (value-free). */
  list(organisationId: string): Promise<SecretMetadata[]>;
  /**
   * Server-internal value read for a consumer that owns the ref. Returns null when the
   * ref is unknown to the tenant, revoked, or (OpenBao) the backend is unavailable.
   * NEVER exposed on an HTTP response.
   */
  resolve(organisationId: string, ref: string): Promise<string | null>;
  /** Soft-disable: the value can no longer be resolved; metadata remains. */
  revoke(organisationId: string, ref: string, actorId: string): Promise<boolean>;
  /** Hard delete: removes metadata + value (builtin) / backend entry (openbao). */
  delete(organisationId: string, ref: string, actorId: string): Promise<boolean>;
  /** Honest backend probe (never faked). */
  readiness(): Promise<SecretStoreReadiness>;
}
