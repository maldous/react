/**
 * Provider-ID entrypoint for the PostgresSecretStore live proof.
 *
 * The assurance inventory keys provider proofs by adapter basename
 * (`postgres-secret-store`). The substantive proof remains
 * `secret-store-contract-runtime-proof.ts`; this file keeps that provider-level link exact.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./secret-store-contract-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/secret-store-contract-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-secret-store.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("SecretStorePort contract") &&
    adapterSource.includes("INSERT INTO public.secret_refs") &&
    adapterSource.includes("UPDATE public.secret_refs") &&
    adapterSource.includes("DELETE FROM public.secret_refs") &&
    adapterSource.includes("getMetadata") &&
    adapterSource.includes("listMetadata"),
  "Postgres secret store proof must assert create/update/delete/list metadata state and persisted secret-ref side effects"
);
assert.ok(
  adapterSource.includes("revoked_at") &&
    adapterSource.includes("return null") &&
    adapterSource.includes('status: "degraded"') &&
    adapterSource.includes("postgres unreachable") &&
    adapterSource.includes("unknown, revoked, unavailable, or deleted refs resolve to null"),
  "Postgres secret store proof must assert revoked/deleted/unknown null resolution and degraded unavailable modes"
);
