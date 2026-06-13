// ---------------------------------------------------------------------------
// Environment registry repository port (ADR-0072 / ADR-ACT-0274).
//
// The application's canonical understanding of the deployment ladder. NON-SECRET
// intent (executor, profiles, mocks, destructive/preserve policy, urls) is sourced
// from the tracked manifests config/environments/<stage>.json; this port projects
// that intent plus operational lifecycle state. No plaintext secret ever crosses it
// — secrets live in the secret store (ADR-0069), bindings in provider_configs.
// ---------------------------------------------------------------------------

export type EnvironmentStage = "development" | "test" | "staging" | "production";
export type EnvironmentExecutor = "tilt" | "compose";
export type MockPolicy = "mocks-allowed" | "no-mocks";
export type DataPreservation = "ephemeral" | "preserve";
export type ProviderConfigStatus = "unconfigured" | "partial" | "ready";
export type BootstrapStatus = "unbootstrapped" | "bootstrapping" | "bootstrapped" | "degraded";

export interface EnvironmentRecord {
  environmentId: string;
  name: string;
  stage: EnvironmentStage;
  executor: EnvironmentExecutor;
  composeProject: string;
  baseUrl: string | null;
  apiUrl: string | null;
  domain: string | null;
  allowedProfiles: string[];
  allowedMocks: string[];
  mockPolicy: MockPolicy;
  destructiveAllowed: boolean;
  dataPreservation: DataPreservation;
  secretStoreProvider: string;
  providerConfigStatus: ProviderConfigStatus;
  bootstrapStatus: BootstrapStatus;
  metadata: Record<string, unknown>;
  lastBootstrappedAt: string | null;
  lastReconciledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpsertEnvironmentInput {
  environmentId: string;
  name: string;
  stage: EnvironmentStage;
  executor: EnvironmentExecutor;
  composeProject: string;
  baseUrl: string | null;
  apiUrl: string | null;
  domain: string | null;
  allowedProfiles: string[];
  allowedMocks: string[];
  mockPolicy: MockPolicy;
  destructiveAllowed: boolean;
  dataPreservation: DataPreservation;
  secretStoreProvider: string;
  metadata: Record<string, unknown>;
}

export interface EnvironmentRegistryRepository {
  list(): Promise<EnvironmentRecord[]>;
  get(environmentId: string): Promise<EnvironmentRecord | null>;
  upsert(input: UpsertEnvironmentInput): Promise<EnvironmentRecord>;
  setProviderConfigStatus(environmentId: string, status: ProviderConfigStatus): Promise<boolean>;
  /** Record a bootstrap transition; stamps last_bootstrapped_at when status=bootstrapped. */
  setBootstrapStatus(environmentId: string, status: BootstrapStatus): Promise<boolean>;
  /** Stamp last_reconciled_at = now(). */
  markReconciled(environmentId: string): Promise<boolean>;
  delete(environmentId: string): Promise<boolean>;
}
