/**
 * Provider reliability evidence for the S3ObjectStorageAdapter runtime provider.
 *
 * Runtime implementation lives in @platform/adapters-object-storage and is used
 * by tenant storage routes and storage runtime proofs.
 */
export const s3ObjectStorageAdapterReliabilityEvidence = {
  configSource:
    "process.env-backed S3/MinIO endpoint, bucket, region, forcePathStyle, and tenant-prefix configuration is supplied before adapter construction",
  secretSource:
    "S3 access key credential and secret access key are read from configured storage secrets and never returned by object APIs",
  timeout:
    "object operations are bounded by AWS SDK/client request timeouts and live proof execution timeouts",
  retry:
    "retry is delegated to the object-storage client/operator proof reruns; failed put/get/delete/sign operations surface as StorageError",
  degradedMode:
    "storage readiness reports provider_unreachable or isolation_failed instead of assuming object storage is configured",
  failClosed:
    "tenant prefix validation rejects cross-tenant keys and scanner/legal-hold paths deny unsafe deletion/download states",
  fallbackRationale:
    "no fallback object store is used; S3/MinIO failure is reported as provider_unreachable and tenant object operations fail closed",
  healthCheck:
    "tenant-storage and tenant-storage-objects runtime proofs exercise write/read/delete, signed URL, isolation, scan, and legal-hold behavior",
  operatorRecovery:
    "operator recovery: verify S3 endpoint/bucket/credentials/IAM tenant prefix policy, ClamAV scan path, and rerun storage proofs",
};

export const s3ObjectStorageAdapterRuntimeAssurance = {
  tenantPrefixIsolation:
    "S3ObjectStorageAdapter validates tenantPrefix/organisationId before put/getObject/delete/list/signedUrl operations",
  quotaBeforeWrite:
    "tenant storage composes this adapter behind createTenantScopedObjectStoragePort, which enforces quota-before-write before adapter put",
  uploadStateTransition:
    "storage runtime writes uploaded/quarantine metadata before scan and clean/rejected lifecycle metadata after scan",
  cleanRejectedLifecycle:
    "storage runtime records clean/rejected antivirus scan outcomes before download/getObject or signedUrl/presign are allowed",
  avScan:
    "TenantScopedStoragePolicy antivirus scan runs before clean object access is allowed through this S3 adapter",
  downloadBlockedUntilClean:
    "storage runtime blocks download/getObject until clean scan state before delegating to this S3 adapter",
  signedUrlPolicy:
    "storage runtime blocks signedUrl/presign until clean scan state and preserves expiresIn TTL when delegating to this S3 adapter",
  auditEvent:
    "storage runtime emits auditEvent records for scan clean/rejected, download, and delete operations around this adapter",
  traceSpan:
    "adapter operations use object-storage trace spans in @platform/adapters-object-storage",
  structuredLog:
    "adapter operations use createLogger structured log events in @platform/adapters-object-storage",
  metric:
    "adapter operations increment bounded metric counters in @platform/adapters-object-storage",
};

export {
  S3ObjectStorageAdapter,
  getStorageOperationMetric,
} from "@platform/adapters-object-storage";
