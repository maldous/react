/**
 * Provider-level proof wrapper for backup-restore-scripts.
 *
 * The delegated proof exercises pg_dump/pg_restore script configuration,
 * protected-environment refusal, dump integrity, restore guards, unavailable
 * database failure, and misconfigured restore confirmation failure.
 */
await import("./backup-local-runtime-proof.ts");
