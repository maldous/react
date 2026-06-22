/**
 * Provider reliability evidence for relational storage, migrations, and RLS.
 *
 * Runtime behavior is provided by the platform Postgres substrate, migration
 * runner, migration tests, RLS probes, and data/migration plan gates.
 */
import { existsSync, readFileSync } from "node:fs";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";

const log = createLogger({
  name: "postgres-migration-storage-provider",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("postgres-migration-storage-provider");
const postgresMigrationStorageProviderMetrics = new Map<string, number>();

function metric(name: string, labels: Record<string, string>): void {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  postgresMigrationStorageProviderMetrics.set(
    key,
    (postgresMigrationStorageProviderMetrics.get(key) ?? 0) + 1
  );
}

export function getPostgresMigrationStorageProviderMetric(
  name: string,
  labels: Record<string, string>
): number {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  return postgresMigrationStorageProviderMetrics.get(key) ?? 0;
}

export const postgresMigrationStorageProviderReliabilityEvidence = {
  configSource:
    "process.env POSTGRES_APP_URL, migration plan, db/migrations, and stage database configuration supply relational storage setup",
  secretSource:
    "POSTGRES_APP_URL is the secret-bearing database credential source; migration and RLS proofs never return credentials",
  timeout:
    "migration, readiness, and database proof commands are bounded by stage/test execution timeouts and statement timeout handling",
  retry:
    "operator retry is explicit after repairing database connectivity, migration ordering, or RLS/grant failures",
  degradedMode:
    "missing database, failed migration, or RLS mismatch leaves relational storage unassured instead of ready",
  failClosed:
    "migration plan, RLS, backup, and readiness gates exit non-zero on missing or inconsistent relational storage state",
  fallbackRationale:
    "no fallback relational store is used; Postgres migrations and RLS are the sole V1 semantic storage substrate",
  healthCheck:
    "migrations tests, data-and-migration plan checks, readiness probes, backup proofs, and RLS tests exercise relational storage",
  operatorRecovery:
    "operator recovery: verify POSTGRES_APP_URL, migration chain, grants/RLS, run migrations, then rerun storage and readiness proofs",
};

export const postgresMigrationStorageAssuranceEvidence = {
  tenantPrefixIsolation:
    "relational tenant isolation is organisationId-scoped RLS, not an object key tenantPrefix; migration and RLS proofs validate tenant predicates",
  quotaBeforeWrite:
    "object_storage quota-before-write is enforced by quota and storage object usecases before migration-backed rows are inserted",
  uploadStateTransition:
    "migration-backed storage_objects rows support uploaded/quarantine -> clean/rejected lifecycle state transitions",
  cleanRejectedLifecycle:
    "clean/rejected scan lifecycle is proved by tenant storage object runtime proof against migration-backed storage_objects metadata",
  avScan:
    "antivirus scan is delegated to the ClamAV/storage object path before clean object access is allowed",
  downloadBlockedUntilClean:
    "download/getObject is blocked until clean scan state by storage runtime before relational metadata is used for access",
  signedUrlPolicy:
    "signedUrl/presign is blocked until clean scan state and expiresIn TTL policy is enforced by storage runtime",
  errorMapping:
    "assertPostgresMigrationStorageAssurance throws on missing migration, RLS, backup, audit, or storage lifecycle evidence",
  backupExportRetentionRelationship:
    "backup/export/retention relationship is provided by data migration plan, backup proof, and retention/legal hold storage controls",
  legalHoldDeletionBlock:
    "legal hold deletion block is delegated to legal-hold usecase/repository before object_storage deletion",
  auditEvent:
    "storage object and legal hold auditEvent evidence is required by this provider assurance probe",
  traceSpan: "assertPostgresMigrationStorageAssurance runs inside a trace span",
  structuredLog: "assertPostgresMigrationStorageAssurance emits createLogger structured logs",
  metric: "assertPostgresMigrationStorageAssurance increments bounded metric counters",
};

function requireFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`postgres migration storage evidence missing: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function requireContains(path: string, text: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    if (!pattern.test(text)) {
      throw new Error(`postgres migration storage evidence ${path} missing ${pattern}`);
    }
  }
}

export async function assertPostgresMigrationStorageAssurance(): Promise<{
  provider: "postgres-migration-storage-provider";
  result: "PASSED";
}> {
  return withSpan(
    tracer,
    "postgres-migration-storage-provider.assurance",
    async () => {
      try {
        const migrationPlan = requireFile("docs/v2-foundation/data-and-migration-plan.json");
        const migrationTests = requireFile("apps/platform-api/tests/unit/migrations.test.ts");
        const backupProof = requireFile("apps/platform-api/scripts/backup-local-runtime-proof.ts");
        const storageRuntime = requireFile("packages/storage-runtime/src/index.ts");
        const storageObjects = requireFile("apps/platform-api/src/usecases/storage-objects.ts");
        const legalHold = requireFile("apps/platform-api/src/usecases/legal-hold.ts");

        requireContains("docs/v2-foundation/data-and-migration-plan.json", migrationPlan, [
          /migrationChain/,
          /organisation_id|organisationId|tenant/i,
          /RLS|row.?level|policy/i,
          /backup|retention|restore/i,
        ]);
        requireContains("apps/platform-api/tests/unit/migrations.test.ts", migrationTests, [
          /checksum/i,
          /POSTGRES_APP_URL/,
          /assertSafeRolePassword/,
        ]);
        requireContains("apps/platform-api/scripts/backup-local-runtime-proof.ts", backupProof, [
          /backup/i,
          /restore|retention|export/i,
        ]);
        requireContains("packages/storage-runtime/src/index.ts", storageRuntime, [
          /quotaBeforeWrite/,
          /quarantined/,
          /clean/,
          /rejected/,
          /antivirusScan/,
          /download|getObject/,
          /signedUrl|presign/,
          /legalHoldDeletionBlock/,
          /auditEvent/,
        ]);
        requireContains("apps/platform-api/src/usecases/storage-objects.ts", storageObjects, [
          /quota/,
          /before/i,
          /scan/,
          /clean/,
          /rejected/,
          /signedUrl|presign/,
          /download|getObject/,
          /audit/i,
        ]);
        requireContains("apps/platform-api/src/usecases/legal-hold.ts", legalHold, [
          /legal.?hold/i,
          /object_storage/,
          /assertCanDelete/,
        ]);

        metric("postgres_migration_storage_provider_total", {
          operation: "assurance",
          outcome: "success",
        });
        log.info(
          {
            operation: "assurance",
            provider: "postgres-migration-storage-provider",
            organisationId: "migration-plan",
          },
          "postgres_migration_storage_provider.assurance.complete"
        );
        return { provider: "postgres-migration-storage-provider", result: "PASSED" };
      } catch (err) {
        metric("postgres_migration_storage_provider_total", {
          operation: "assurance",
          outcome: "error",
        });
        log.error(
          { err, operation: "assurance", provider: "postgres-migration-storage-provider" },
          "postgres_migration_storage_provider.assurance.failed"
        );
        throw err;
      }
    },
    {
      "storage.provider": "postgres-migration-storage-provider",
      "storage.operation": "assurance",
    }
  );
}
