/**
 * Provider-ID proof entrypoint for tenant-secret-crypto.
 *
 * The substantive proof is secret-store-contract-runtime-proof.ts, which validates
 * tenant secret encryption/decryption behavior, non-secret storage contracts, and
 * fail-closed decrypt behavior when encrypted material cannot be opened.
 */

import "./secret-store-contract-runtime-proof.ts";
