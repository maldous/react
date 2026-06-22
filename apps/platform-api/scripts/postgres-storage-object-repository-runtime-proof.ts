/**
 * Provider-ID proof entrypoint for the Postgres storage object repository.
 *
 * The substantive storage proof is tenant-storage-objects-runtime-proof.ts. It
 * validates storage object metadata lifecycle, quota-before-write, quarantine,
 * scan promotion/rejection, legal-hold delete denial, and live object flow.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./tenant-storage-objects-runtime-proof.ts";

const proofSource = readFileSync(
  "apps/platform-api/scripts/tenant-storage-objects-runtime-proof.ts",
  "utf8"
);
const adapterSource = readFileSync(
  "apps/platform-api/src/adapters/postgres-storage-object-repository.ts",
  "utf8"
);

assert.ok(
  proofSource.includes("quota blocks before write") &&
    proofSource.includes("download URL blocked until clean") &&
    proofSource.includes("scan promotes clean") &&
    proofSource.includes("scan rejects EICAR signature") &&
    proofSource.includes("live MinIO object CRUD") &&
    adapterSource.includes("INSERT INTO public.storage_objects"),
  "storage object proof must assert quota-before-write, quarantine/clean/rejected lifecycle, and live object side effects"
);
assert.ok(
  proofSource.includes("legal hold blocks deletion") &&
    proofSource.includes("ClamAV unavailable provider path fails closed") &&
    adapterSource.includes("postgres-storage-object-repository unavailable") &&
    adapterSource.includes("no fallback is allowed") &&
    adapterSource.includes("fail-closed after retry attempts"),
  "storage object proof must assert legal-hold delete denial, scanner unavailable, and repository fail-closed modes"
);
