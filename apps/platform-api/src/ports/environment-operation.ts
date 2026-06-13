// ---------------------------------------------------------------------------
// Environment operation port (ADR-0072 / ADR-ACT-0274).
//
// A controlled boundary over environment bootstrap/operation actions. The set of
// operations is a CLOSED enum — there is structurally no free-form command field, so
// arbitrary shell / arbitrary compose / arbitrary docker-socket access is impossible
// by construction. The adapter resolves each operation to a whitelisted argv derived
// from the environment registry (allowed profiles/mocks, executor, destructive
// policy) and runs it WITHOUT a shell. Every operation is dry-run capable.
//
// Hard restrictions (enforced by the adapter):
//   - no arbitrary command / shell / docker socket;
//   - no unclassified provider profile (must be in the env's allowedProfiles);
//   - no mock provider profile in staging/production;
//   - no destructive operation in staging/production unless explicitly safe;
//   - readiness/ready is adapter-confirmed — never self-asserted.
// Permissioning + audit live in the usecase that wraps this port.
// ---------------------------------------------------------------------------

export type EnvironmentOperationKind =
  | "generateRuntimeEnv"
  | "bootstrapEnvironment"
  | "seedSecrets"
  | "seedProviderConfig"
  | "seedManagedConfig"
  | "createGlobalAdmin"
  | "rotateSecret"
  | "reconcileProvider"
  | "startProviderProfile"
  | "stopProviderProfile"
  | "restartProviderProfile"
  | "runMigrations"
  | "runReadinessProbe"
  | "runProof";

export interface EnvironmentOperationRequest {
  kind: EnvironmentOperationKind;
  environmentId: string;
  /** Compose profile for *ProviderProfile / reconcileProvider ops (must be allowed). */
  profile?: string;
  /** Secret key for rotateSecret. */
  key?: string;
  /** Proof name for runProof (npm run proof:<name>). */
  proof?: string;
  /** When true, resolve + return the argv but DO NOT execute. */
  dryRun?: boolean;
}

export interface EnvironmentOperationResult {
  ok: boolean;
  kind: EnvironmentOperationKind;
  environmentId: string;
  dryRun: boolean;
  /** The resolved whitelisted argv (argument vector — never a shell string). */
  command: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  message?: string;
}

/** Thrown when a request violates a hard restriction (rejected, not executed). */
export class EnvironmentOperationRejected extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`environment operation rejected: ${reason}`);
    this.name = "EnvironmentOperationRejected";
    this.reason = reason;
  }
}

export interface EnvironmentOperationPort {
  execute(req: EnvironmentOperationRequest): Promise<EnvironmentOperationResult>;
}

/** A no-shell command runner (argv only). Injected so the adapter is testable. */
export type ArgvRunner = (
  argv: string[]
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
