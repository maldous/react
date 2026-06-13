// ---------------------------------------------------------------------------
// Provider configuration repository port (ADR-0070 / ADR-ACT-0266) — Tier-1 kernel.
//
// The config plane that ties a USF capability to a concrete provider instance in a
// given environment: its environment classification, lifecycle state, non-secret
// endpoint/config, and credentials BY REFERENCE (an opaque secret:<uuid> into the
// ADR-0069 secret store). No plaintext secret ever crosses this port.
//
// Invariants enforced by the usecase layer (not the store):
//   - credentialRef, when present, is an opaque secret-store ref (secret:<uuid>);
//   - a forbidden-in-production (mock) provider can never be active in production;
//   - config carries no secret-bearing keys (secrets go through credentialRef);
//   - lifecycle `ready` is adapter-confirmed — config alone never implies ready.
// ---------------------------------------------------------------------------

export type ProviderLifecycleState = "candidate" | "configured" | "degraded" | "ready" | "disabled";

export interface ProviderConfigRecord {
  id: string;
  providerKey: string;
  capability: string;
  environment: "development" | "test" | "staging" | "production";
  instanceLabel: string;
  classification: string;
  lifecycleState: ProviderLifecycleState;
  endpoint: string | null;
  /** Opaque secret-store ref (secret:<uuid>) — never a plaintext credential. */
  credentialRef: string | null;
  /** Non-secret config keys only. */
  config: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface UpsertProviderConfigInput {
  providerKey: string;
  capability: string;
  environment: "development" | "test" | "staging" | "production";
  instanceLabel: string;
  classification: string;
  lifecycleState: ProviderLifecycleState;
  endpoint: string | null;
  credentialRef: string | null;
  config: Record<string, unknown>;
  updatedBy: string;
}

export interface ProviderConfigRepository {
  list(): Promise<ProviderConfigRecord[]>;
  listForCapability(capability: string): Promise<ProviderConfigRecord[]>;
  getByKey(
    providerKey: string,
    environment: string,
    instanceLabel: string
  ): Promise<ProviderConfigRecord | null>;
  upsert(input: UpsertProviderConfigInput): Promise<ProviderConfigRecord>;
  setLifecycleState(id: string, lifecycleState: ProviderLifecycleState): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}
