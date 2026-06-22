/**
 * Provider-ID proof entrypoint for postgres-portable-tenant-import-applier.
 *
 * The substantive proof is data-portability-runtime-proof.ts, which validates
 * encrypted archive import/export, manifest/digest verification, rollback,
 * resume progress, and durable portable import application semantics.
 */

import "./data-portability-runtime-proof.ts";
