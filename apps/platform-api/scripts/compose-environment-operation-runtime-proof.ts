/**
 * Provider-ID proof entrypoint for the compose environment operation adapter.
 *
 * The substantive proof lives in environment-operations-runtime-proof.ts and exercises
 * the closed operation enum, argv-only dry runs, profile/mock restrictions, non-destructive
 * stop/restart behavior, pattern validation, permission checks, and audit emission.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const delegatedProofSource = readFileSync(
  join(scriptDir, "environment-operations-runtime-proof.ts"),
  "utf8"
);
const adapterSource = readFileSync(
  join(scriptDir, "../src/adapters/compose-environment-operation.ts"),
  "utf8"
);
const usecaseSource = readFileSync(
  join(scriptDir, "../src/usecases/environment-operations.ts"),
  "utf8"
);

assert.ok(
  delegatedProofSource.includes("dry.command") &&
    delegatedProofSource.includes("devRunner.calls.length === 0") &&
    delegatedProofSource.includes("Array.isArray") &&
    delegatedProofSource.includes("authorized operation is audited"),
  "delegated compose environment proof must assert dry-run command state and audited operation side effects"
);
assert.ok(
  delegatedProofSource.includes("unknown provider profile is rejected") &&
    delegatedProofSource.includes("mock profile cannot start in production") &&
    delegatedProofSource.includes("rotateSecret rejects a malformed KEY") &&
    delegatedProofSource.includes("runProof rejects a malformed proof name") &&
    delegatedProofSource.includes("cross-environment request is rejected") &&
    delegatedProofSource.includes("operation without the required permission is Forbidden"),
  "delegated compose environment proof must assert rejected, forbidden, and invalid operation failure modes"
);
assert.ok(
  adapterSource.includes("withOperationTimeout") &&
    adapterSource.includes("EnvironmentOperationRejected") &&
    adapterSource.includes("COMPOSE_ENV_OPERATION_TIMEOUT_MS") &&
    adapterSource.includes("no fallback runner or shell exists") &&
    adapterSource.includes("ok: exitCode === 0"),
  "compose environment adapter must publish timeout, fail-closed, no-fallback, and exit status semantics"
);
assert.ok(
  usecaseSource.includes("requiredPermissionFor") &&
    usecaseSource.includes("environment.operation_invoked") &&
    usecaseSource.includes("FORBIDDEN"),
  "environment operation usecase must enforce permission state and emit the operation audit event"
);

await import("./environment-operations-runtime-proof.ts");
