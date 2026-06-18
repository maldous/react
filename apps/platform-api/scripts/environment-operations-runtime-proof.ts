/**
 * Environment operations PROOF (ADR-0072 / ADR-ACT-0274).
 *
 * Proves the controlled environment-operation boundary deterministically with an
 * injected fake runner (NO Docker / shell required — always runs):
 *  - the operation set is a closed enum: no arbitrary command can be expressed, and
 *    every resolved command is an argv (never a shell string);
 *  - dry-run resolves the whitelisted argv WITHOUT executing;
 *  - a provider profile not in the env's allowedProfiles is rejected;
 *  - a mock profile cannot start in staging/production;
 *  - container stop/restart never passes -v/--volumes (no data-destructive reset);
 *  - rotateSecret keys and proof names are pattern-validated;
 *  - every operation requires the right platform.environment.* permission and is
 *    audited (EnvironmentOperationInvoked).
 *
 * Usage: npm run proof:environment-operations
 */

import type { AuditEvent, AuditEventPort } from "@platform/audit-events";
import { ComposeEnvironmentOperationAdapter } from "../src/adapters/compose-environment-operation.ts";
import { EnvironmentOperationRejected } from "../src/ports/environment-operation.ts";
import type { EnvironmentRecord } from "../src/ports/environment-registry-repository.ts";
import {
  runEnvironmentOperation,
  requiredPermissionFor,
} from "../src/usecases/environment-operations.ts";
import {
  ENVIRONMENT_PERMISSIONS,
  type EnvironmentActor,
} from "../src/usecases/environment-registry.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}` + (detail ? ` — ${detail}` : ""));
  if (!ok) failures++;
}
function capturingAudit(): { port: AuditEventPort; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    port: {
      emit: async (e) => {
        events.push(e);
      },
      query: async () => events,
    },
  };
}

// A fake runner records the argv it is asked to run; it never spawns a process.
function fakeRunner(): {
  run: (a: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    run: async (argv) => {
      calls.push(argv);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

function envRecord(over: Partial<EnvironmentRecord>): EnvironmentRecord {
  return {
    environmentId: "dev",
    name: "Development",
    stage: "development",
    executor: "tilt",
    composeProject: "react",
    baseUrl: null,
    apiUrl: null,
    domain: null,
    allowedProfiles: ["default", "observability", "identity-mocks"],
    allowedMocks: ["identity-mocks"],
    mockPolicy: "mocks-allowed",
    destructiveAllowed: true,
    dataPreservation: "ephemeral",
    secretStoreProvider: "openbao",
    providerConfigStatus: "unconfigured",
    bootstrapStatus: "unbootstrapped",
    metadata: {},
    lastBootstrappedAt: null,
    lastReconciledAt: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

const ALL = Object.values(ENVIRONMENT_PERMISSIONS);
const actor = (perms: string[] = ALL): EnvironmentActor => ({
  actorId: "00000000-0000-0000-0000-000000000000",
  actorRoles: ["system-admin"],
  actorPermissions: perms,
});

async function rejected(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof EnvironmentOperationRejected;
  }
}
async function forbidden(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return (e as { code?: string }).code === "FORBIDDEN";
  }
}

async function main(): Promise<void> {
  console.log("# Environment operations PROOF\n");

  // dev (mocks-allowed) + prod (no-mocks) adapters with a fake runner.
  const devRunner = fakeRunner();
  const dev = new ComposeEnvironmentOperationAdapter(envRecord({}), devRunner.run);
  const prod = new ComposeEnvironmentOperationAdapter(
    envRecord({
      environmentId: "prod",
      stage: "production",
      executor: "compose",
      composeProject: "react-prod",
      allowedProfiles: ["default", "observability"],
      allowedMocks: [],
      mockPolicy: "no-mocks",
      destructiveAllowed: false,
      dataPreservation: "preserve",
    }),
    fakeRunner().run
  );

  // 1. dry-run resolves an argv (array) without executing.
  const dry = await dev.execute({ kind: "generateRuntimeEnv", environmentId: "dev", dryRun: true });
  check(
    "dry-run resolves an argv without executing",
    dry.dryRun && Array.isArray(dry.command) && devRunner.calls.length === 0,
    dry.command.join(" ")
  );
  check(
    "resolved command is an argv, never a shell string (no shell metachars)",
    dry.command.every((a) => !/[;&|`$><]/.test(a))
  );

  // 2. allowed profile start resolves to scripts/compose/up.sh argv.
  const start = dev.resolve({
    kind: "startProviderProfile",
    environmentId: "dev",
    profile: "observability",
  });
  check(
    "allowed profile resolves to up.sh argv",
    start[0] === "bash" && start.includes("observability")
  );

  // 3. unknown profile rejected.
  check(
    "unknown provider profile is rejected",
    await rejected(async () =>
      dev.resolve({
        kind: "startProviderProfile",
        environmentId: "dev",
        profile: "totally-unknown",
      })
    )
  );

  // 4. mock profile cannot start in production.
  check(
    "mock profile cannot start in production",
    await rejected(async () =>
      prod.resolve({
        kind: "startProviderProfile",
        environmentId: "prod",
        profile: "identity-mocks",
      })
    )
  );

  // 5. stop/restart never pass -v/--volumes.
  const stop = dev.resolve({
    kind: "stopProviderProfile",
    environmentId: "dev",
    profile: "observability",
  });
  const restart = dev.resolve({
    kind: "restartProviderProfile",
    environmentId: "dev",
    profile: "observability",
  });
  check(
    "stop/restart never pass -v/--volumes",
    !stop.includes("-v") &&
      !stop.includes("--volumes") &&
      !restart.includes("-v") &&
      !restart.includes("--volumes")
  );

  // 6. rotateSecret + proof name pattern validation.
  check(
    "rotateSecret rejects a malformed KEY",
    await rejected(async () =>
      dev.resolve({ kind: "rotateSecret", environmentId: "dev", key: "bad key; rm -rf" })
    )
  );
  check(
    "rotateSecret accepts a valid KEY",
    dev
      .resolve({ kind: "rotateSecret", environmentId: "dev", key: "API_KEY_PEPPER" })
      .includes("KEY=API_KEY_PEPPER")
  );
  check(
    "runProof rejects a malformed proof name",
    await rejected(async () =>
      dev.resolve({ kind: "runProof", environmentId: "dev", proof: "x && curl evil" })
    )
  );

  // 7. environment mismatch rejected (adapter bound to one env).
  check(
    "cross-environment request is rejected",
    await rejected(async () => dev.resolve({ kind: "generateRuntimeEnv", environmentId: "prod" }))
  );

  // 8. permission enforcement + audit via the usecase.
  const audit = capturingAudit();
  const deps = { operations: dev, audit: audit.port };
  check(
    "operation without the required permission is Forbidden",
    await forbidden(() =>
      runEnvironmentOperation(deps, actor([]), {
        kind: "bootstrapEnvironment",
        environmentId: "dev",
        dryRun: true,
      })
    )
  );
  check(
    "bootstrap requires the bootstrap permission",
    requiredPermissionFor("bootstrapEnvironment") === ENVIRONMENT_PERMISSIONS.bootstrap
  );
  check(
    "rotateSecret requires the rotate_secret permission",
    requiredPermissionFor("rotateSecret") === ENVIRONMENT_PERMISSIONS.rotateSecret
  );

  const okRun = await runEnvironmentOperation(deps, actor(), {
    kind: "bootstrapEnvironment",
    environmentId: "dev",
    dryRun: true,
  });
  check(
    "authorized operation is audited (EnvironmentOperationInvoked) + dry-run ok",
    okRun.ok && audit.events.some((e) => e.action === "environment.operation_invoked")
  );

  console.log(`\n` + (failures === 0 ? "# PASS" : `# FAIL (${failures})`));
  process.exit(failures === 0 ? 0 : 1);
}

void main();
