/**
 * Provider-level proof wrapper for tenant-lifecycle-coordinator.
 *
 * The delegated proof exercises tenant provision/suspend/delete/export
 * coordination, export-before-delete, subsystem failure stop, and recovery
 * evidence for unavailable or misconfigured lifecycle dependencies.
 */
await import("./tenant-lifecycle-runtime-proof.ts");
