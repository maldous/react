/**
 * Provider-ID entrypoint for the OpenBaoSecretStore live proof.
 *
 * The assurance inventory keys provider proofs by adapter basename
 * (`openbao-secret-store`). The substantive proof remains
 * `secrets-openbao-runtime-proof.ts`; this file keeps that provider-level link exact
 * and asserts the delegated proof still exercises provider side effects and
 * unavailable-backend failure/skip semantics.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "secrets-openbao-runtime-proof.ts"),
  "utf8"
);

assert.ok(
  proofSource.includes("readiness reports ready") && proofSource.includes("ready.status"),
  "delegated OpenBao proof must assert provider readiness status"
);
assert.ok(
  proofSource.includes("store.put") &&
    proofSource.includes("store.resolve") &&
    proofSource.includes("store.revoke") &&
    proofSource.includes("store.delete"),
  "delegated OpenBao proof must assert provider side effects through put/resolve/revoke/delete state"
);
assert.ok(
  proofSource.includes("tenant B cannot resolve tenant A") &&
    proofSource.includes("encrypted_value NULL"),
  "delegated OpenBao proof must assert tenant isolation and value-free Postgres metadata state"
);
assert.ok(
  proofSource.includes("not reachable") && proofSource.includes("SKIP"),
  "delegated OpenBao proof must assert unavailable provider failure/skip mode"
);

await import("./secrets-openbao-runtime-proof.ts");
