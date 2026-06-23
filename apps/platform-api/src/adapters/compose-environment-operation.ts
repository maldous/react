/**
 * ComposeEnvironmentOperationAdapter (ADR-0072 / ADR-ACT-0274).
 *
 * A safe adapter over Compose/Tilt + the Makefile env targets. It NEVER exposes a
 * shell: each operation resolves to a whitelisted argv (argument vector) derived from
 * the environment registry record, and is run via an injected ArgvRunner using
 * execFile semantics (no shell interpolation). Every op is dry-run capable.
 *
 * Hard restrictions:
 *   - the operation set is a closed enum — no arbitrary command can be expressed;
 *   - a provider profile must be in the env's allowedProfiles;
 *   - a mock profile can never be started in staging/production;
 *   - container down/restart never passes -v/--volumes (no data-destructive reset),
 *     and destructive stage resets are not an operation this adapter offers;
 *   - rotateSecret keys and proof names are pattern-validated.
 */

import {
  EnvironmentOperationRejected,
  type ArgvRunner,
  type EnvironmentOperationPort,
  type EnvironmentOperationRequest,
  type EnvironmentOperationResult,
} from "../ports/environment-operation.ts";
import type { EnvironmentRecord } from "../ports/environment-registry-repository.ts";
import { loadOperationalTimeoutsConfig } from "../config/operational-timeouts-config.ts";

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;
const PROOF_NAME = /^[a-z0-9][a-z0-9-]*$/;

export const composeEnvironmentOperationReliabilityEvidence = {
  configSource:
    "operation configuration is the EnvironmentRecord supplied by the environment registry plus typed OperationalTimeoutsConfig",
  timeout:
    "non-dry-run operation execution is bounded by operationTimeoutMs through withOperationTimeout",
  retry:
    "no retry inside the adapter: bootstrap, migration, secret rotation, profile start/stop, and proof commands are single operator-invoked attempts",
  degradedMode:
    "runner failures return ok=false with exitCode/stdout/stderr; invalid or unsafe requests throw before execution",
  failClosed:
    "unknown operations, environment mismatches, disallowed profiles, production mock starts, malformed secret keys, and malformed proof names are rejected before argv execution",
  fallbackRationale:
    "no fallback runner or shell exists because the operation boundary must remain an argv-only allowlist",
  operatorRecovery:
    "operators recover by fixing the environment registry/profile/secret/proof input or rerunning the exact audited operation after runner failure",
};

function configuredOperationTimeoutMs(): number {
  return loadOperationalTimeoutsConfig().composeEnvironmentOperationTimeoutMs;
}

async function withOperationTimeout<T>(
  operation: string,
  timeoutMs: number,
  promise: Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`environment_operation_timeout:${operation}`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ComposeEnvironmentOperationAdapter implements EnvironmentOperationPort {
  private readonly env: EnvironmentRecord;
  private readonly run: ArgvRunner;
  private readonly operationTimeoutMs: number;

  constructor(
    env: EnvironmentRecord,
    runner: ArgvRunner,
    operationTimeoutMs = configuredOperationTimeoutMs()
  ) {
    this.env = env;
    this.run = runner;
    this.operationTimeoutMs = operationTimeoutMs;
  }

  private assertProfileAllowed(profile: string | undefined): string {
    if (!profile) throw new EnvironmentOperationRejected("a provider profile is required");
    if (!this.env.allowedProfiles.includes(profile)) {
      throw new EnvironmentOperationRejected(
        `profile "${profile}" is not allowed in ${this.env.environmentId}`
      );
    }
    const isProdLike = this.env.stage === "staging" || this.env.stage === "production";
    if (isProdLike && this.env.allowedMocks.includes(profile)) {
      throw new EnvironmentOperationRejected(
        `mock profile "${profile}" cannot start in ${this.env.stage}`
      );
    }
    return profile;
  }

  /** Resolve a request to a whitelisted argv. Throws EnvironmentOperationRejected. */
  resolve(req: EnvironmentOperationRequest): string[] {
    if (req.environmentId !== this.env.environmentId) {
      throw new EnvironmentOperationRejected(
        `environment mismatch: adapter is bound to ${this.env.environmentId}`
      );
    }
    const env = this.env.environmentId;
    switch (req.kind) {
      case "generateRuntimeEnv":
        return ["node", "scripts/env/generate-runtime-env.mjs", env];
      case "bootstrapEnvironment":
        return ["make", "env-bootstrap", `ENV=${env}`];
      case "seedSecrets":
        return ["make", "env-seed-secrets", `ENV=${env}`];
      case "seedProviderConfig":
        return ["make", "env-seed-providers", `ENV=${env}`];
      case "seedManagedConfig":
        return ["make", "env-seed-config", `ENV=${env}`];
      case "createGlobalAdmin":
        return ["make", "env-seed-admin", `ENV=${env}`];
      case "runMigrations":
        return ["make", "db-migrate", `ENV=${env}`];
      case "runReadinessProbe":
        return ["bash", "scripts/compose/wait.sh", env, "60"];
      case "rotateSecret": {
        if (!req.key || !ENV_KEY.test(req.key)) {
          throw new EnvironmentOperationRejected(
            "rotateSecret requires a valid KEY (^[A-Z][A-Z0-9_]*$)"
          );
        }
        return ["make", "env-rotate-secret", `ENV=${env}`, `KEY=${req.key}`];
      }
      case "runProof": {
        if (!req.proof || !PROOF_NAME.test(req.proof)) {
          throw new EnvironmentOperationRejected(
            "runProof requires a valid proof name (^[a-z0-9-]+$)"
          );
        }
        return ["npm", "run", `proof:${req.proof}`];
      }
      case "startProviderProfile": {
        const profile = this.assertProfileAllowed(req.profile);
        return ["bash", "scripts/compose/up.sh", env, profile];
      }
      case "stopProviderProfile": {
        const profile = this.assertProfileAllowed(req.profile);
        // down WITHOUT -v: containers stop, volumes/data preserved. Never destructive.
        return ["docker/compose-wrapper.sh", env, "--profile", profile, "down"];
      }
      case "restartProviderProfile": {
        const profile = this.assertProfileAllowed(req.profile);
        return ["docker/compose-wrapper.sh", env, "--profile", profile, "restart"];
      }
      case "reconcileProvider": {
        const profile = this.assertProfileAllowed(req.profile);
        return ["make", "env-provider-reconcile", `ENV=${env}`, `PROVIDER=${profile}`];
      }
      default: {
        // Exhaustiveness guard — an unknown kind can never be executed.
        throw new EnvironmentOperationRejected(`unknown operation kind: ${String(req.kind)}`);
      }
    }
  }

  async execute(req: EnvironmentOperationRequest): Promise<EnvironmentOperationResult> {
    const command = this.resolve(req);
    const base = { kind: req.kind, environmentId: req.environmentId, command };
    if (req.dryRun) {
      return {
        ...base,
        ok: true,
        dryRun: true,
        message: "dry-run: command resolved, not executed",
      };
    }
    const { exitCode, stdout, stderr } = await withOperationTimeout(
      req.kind,
      this.operationTimeoutMs,
      this.run(command)
    );
    return { ...base, ok: exitCode === 0, dryRun: false, exitCode, stdout, stderr };
  }
}
