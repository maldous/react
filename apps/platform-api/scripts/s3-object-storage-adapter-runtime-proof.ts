/**
 * Provider-level proof wrapper for s3-object-storage-adapter.
 *
 * The delegated proof exercises S3/MinIO object writes, reads, deletes, signed
 * URLs, tenant-prefix isolation, unavailable-provider handling, and
 * misconfigured storage behavior.
 */
await import("./tenant-storage-runtime-proof.ts");
