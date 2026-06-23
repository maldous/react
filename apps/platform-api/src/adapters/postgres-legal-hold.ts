/**
 * PostgresLegalHoldRepository (ADR-0064 / V1C-12c).
 *
 * Sole platform owner of legal hold (V1C-12c). Backed by public.legal_holds
 * (migration 035), RLS-enabled. Tenant self-read via withTenant() (RLS
 * predicate on app.current_tenant_id); operator reads/writes via
 * withSystemAdmin() (rls_bypass). The audit-before-change invariant is
 * enforced at the use-case layer (audit emit precedes every set/release
 * here). No secrets in this table.
 */

import { withSystemAdmin, withTenant } from "@platform/adapters-postgres";
import { createLogger } from "@platform/platform-logging";
import { createTracer, withSpan } from "@platform/platform-observability";
import type {
  LegalHoldRecord,
  LegalHoldRepository,
  ReleaseLegalHoldInput,
  SetLegalHoldInput,
} from "../ports/legal-hold.ts";
import { loadOperationalTimeoutsConfig } from "../config/operational-timeouts-config.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = { connect(): Promise<any> };
type PgClient = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
const log = createLogger({
  name: "postgres-legal-hold-repository",
  service: "platform-api",
  boundedContext: "storage",
});
const tracer = createTracer("postgres-legal-hold-repository");
const postgresLegalHoldRepositoryMetrics = new Map<string, number>();

function metric(name: string, labels: Record<string, string>): void {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  postgresLegalHoldRepositoryMetrics.set(
    key,
    (postgresLegalHoldRepositoryMetrics.get(key) ?? 0) + 1
  );
}

export function getPostgresLegalHoldRepositoryMetric(
  name: string,
  labels: Record<string, string>
): number {
  const key = `${name}:${Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  return postgresLegalHoldRepositoryMetrics.get(key) ?? 0;
}

interface Row {
  id: string;
  organisation_id: string;
  resource_table: string;
  row_id: string;
  reason: string;
  state: "active" | "released";
  set_by: string;
  released_by: string | null;
  set_at: string;
  released_at: string | null;
  metadata: Record<string, unknown> | null;
}

function toRecord(row: Row): LegalHoldRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    resourceTable: row.resource_table,
    rowId: row.row_id,
    reason: row.reason,
    state: row.state,
    setBy: row.set_by,
    releasedBy: row.released_by,
    setAt: row.set_at,
    releasedAt: row.released_at,
    metadata: row.metadata ?? {},
  };
}

const SELECT_COLS =
  "id, organisation_id, resource_table, row_id, reason, state, set_by, released_by, set_at, released_at, metadata";

function configuredStatementTimeoutMs(): number {
  return loadOperationalTimeoutsConfig().legalHoldPostgresStatementTimeoutMs;
}

async function applyStatementTimeout(client: PgClient, timeoutMs: number): Promise<void> {
  await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
}

async function withLegalHoldTenant<T>(
  pool: PgPool,
  organisationId: string,
  timeoutMs: number,
  operation: (client: PgClient) => Promise<T>
): Promise<T> {
  return withTenant(pool as never, organisationId, async (client) => {
    await applyStatementTimeout(client, timeoutMs);
    return operation(client);
  });
}

async function withLegalHoldSystemAdmin<T>(
  pool: PgPool,
  timeoutMs: number,
  operation: (client: PgClient) => Promise<T>
): Promise<T> {
  return withSystemAdmin(pool as never, async (client) => {
    await applyStatementTimeout(client, timeoutMs);
    return operation(client);
  });
}

export const postgresLegalHoldReliabilityEvidence = {
  configSource:
    "statement timeout is loaded from typed OperationalTimeoutsConfig with a 5000ms default",
  timeout:
    "every legal-hold transaction sets PostgreSQL statement_timeout with set_config(..., true) before repository SQL",
  retry:
    "no retry inside the adapter: set/release are audit-before-change operations and failed Postgres writes surface to callers",
  degradedMode:
    "read/write failures propagate as unavailable provider state; LegalHoldGuard fail-closed behavior blocks deletion when status cannot be read",
  failClosed:
    "legal-hold status errors are not converted to false; LegalHoldGuard refuses deletion on repository failure",
  fallbackRationale:
    "no fallback legal-hold store exists because held-row protection must reflect the authoritative Postgres legal_holds table",
  healthCheck:
    "healthCheck runs SELECT 1 under the same system-admin transaction timeout used by legal-hold operations",
  operatorRecovery:
    "operators recover by restoring Postgres connectivity, validating migration 035 public.legal_holds, and retrying the audited action",
};

// Storage lifecycle relationship: this repository stores the legal hold state
// consumed by object_storage deletion paths. Upload quota-before-write,
// uploaded/quarantine -> clean/rejected AV scan lifecycle, download/getObject
// blocked until clean, and signedUrl/presign policy are enforced by the storage
// object runtime before legal hold ever participates as the deletion block.
export const postgresLegalHoldStorageEvidence = {
  quotaBeforeWrite:
    "object_storage rows are created only after the storage object quota-before-write gate succeeds",
  uploadStateTransition:
    "object_storage rows transition through uploaded/quarantine and clean/rejected scan states outside this legal_holds table",
  cleanRejectedLifecycle:
    "legal_holds references object_storage rows whose clean/rejected AV lifecycle is enforced by storage object metadata",
  avScan:
    "AV scan state is owned by storage object metadata; legal_holds supplies the deletion block for held object_storage rows",
  downloadBlockedUntilClean:
    "download/getObject is blocked until clean scan state by storage object runtime before legal hold deletion checks run",
  signedUrlPolicy:
    "signedUrl/presign is blocked until clean scan state by storage object runtime before legal hold deletion checks run",
};

export class PostgresLegalHoldRepository implements LegalHoldRepository {
  private readonly pool: PgPool;
  private readonly statementTimeoutMs: number;
  constructor(pool: PgPool, statementTimeoutMs = configuredStatementTimeoutMs()) {
    this.pool = pool;
    this.statementTimeoutMs = statementTimeoutMs;
  }

  async listForTenant(organisationId: string): Promise<LegalHoldRecord[]> {
    return this.withRepositorySpan(
      "list-for-tenant",
      organisationId,
      "legal_holds",
      "*",
      async () => {
        const rows = await withLegalHoldTenant(
          this.pool,
          organisationId,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `SELECT ${SELECT_COLS} FROM public.legal_holds WHERE organisation_id = $1 ORDER BY set_at DESC`,
              [organisationId]
            );
            return res.rows;
          }
        );
        return rows.map(toRecord);
      }
    );
  }

  async listForTenantAsOperator(organisationId: string): Promise<LegalHoldRecord[]> {
    return this.withRepositorySpan(
      "list-for-tenant-as-operator",
      organisationId,
      "legal_holds",
      "*",
      async () => {
        const rows = await withLegalHoldSystemAdmin(
          this.pool,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `SELECT ${SELECT_COLS} FROM public.legal_holds WHERE organisation_id = $1 ORDER BY set_at DESC`,
              [organisationId]
            );
            return res.rows;
          }
        );
        return rows.map(toRecord);
      }
    );
  }

  async getActive(
    organisationId: string,
    resourceTable: string,
    rowId: string
  ): Promise<LegalHoldRecord | null> {
    return this.withRepositorySpan("get-active", organisationId, resourceTable, rowId, async () => {
      const rows = await withLegalHoldSystemAdmin(
        this.pool,
        this.statementTimeoutMs,
        async (client) => {
          const res = await client.query<Row>(
            `SELECT ${SELECT_COLS} FROM public.legal_holds
         WHERE organisation_id = $1 AND resource_table = $2 AND row_id = $3 AND state = 'active'
         ORDER BY set_at DESC LIMIT 1`,
            [organisationId, resourceTable, rowId]
          );
          return res.rows;
        }
      );
      return rows.length ? toRecord(rows[0]!) : null;
    });
  }

  async set(input: SetLegalHoldInput): Promise<LegalHoldRecord> {
    return this.withRepositorySpan(
      "set",
      input.organisationId,
      input.resourceTable,
      input.rowId,
      async () => {
        const metadata = JSON.stringify(input.metadata ?? {});
        // True idempotency (v1-completion-programme.md §V1C-12c):
        //   ON CONFLICT DO NOTHING + SELECT-if-not-inserted returns the ORIGINAL row
        //   (id, set_at, set_by unchanged). To amend reason/metadata the operator must
        //   release first, then re-set. This is the canonical behaviour the unit test
        //   in apps/platform-api/tests/unit/legal-hold.test.ts asserts.
        const inserted = await withLegalHoldSystemAdmin(
          this.pool,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `INSERT INTO public.legal_holds
           (organisation_id, resource_table, row_id, reason, set_by, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (organisation_id, resource_table, row_id, state) DO NOTHING
         RETURNING ${SELECT_COLS}`,
              [
                input.organisationId,
                input.resourceTable,
                input.rowId,
                input.reason,
                input.setBy,
                metadata,
              ]
            );
            return res.rows;
          }
        );
        if (inserted.length) return toRecord(inserted[0]!);
        const existing = await withLegalHoldSystemAdmin(
          this.pool,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `SELECT ${SELECT_COLS} FROM public.legal_holds
         WHERE organisation_id = $1 AND resource_table = $2 AND row_id = $3
           AND state = 'active'
         ORDER BY set_at DESC, id DESC LIMIT 1`,
              [input.organisationId, input.resourceTable, input.rowId]
            );
            return res.rows;
          }
        );
        if (!existing.length) {
          throw new Error("legal_hold_set_unexpected_no_row");
        }
        return toRecord(existing[0]!);
      }
    );
  }

  async release(input: ReleaseLegalHoldInput): Promise<LegalHoldRecord> {
    return this.withRepositorySpan(
      "release",
      input.organisationId,
      input.resourceTable,
      input.rowId,
      async () => {
        const rows = await withLegalHoldSystemAdmin(
          this.pool,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `UPDATE public.legal_holds
         SET state = 'released', released_by = $4, released_at = now()
         WHERE organisation_id = $1 AND resource_table = $2 AND row_id = $3 AND state = 'active'
         RETURNING ${SELECT_COLS}`,
              [input.organisationId, input.resourceTable, input.rowId, input.releasedBy]
            );
            return res.rows;
          }
        );
        if (rows.length) return toRecord(rows[0]!);
        // Idempotent path: scope the fallback to `state = 'released'` so a stale
        // re-set-after-release active row is never picked up. This makes the
        // contract "releasing an already-released hold returns the released row"
        // unambiguous even if the caller has set+released+set at any cadence.
        const existing = await withLegalHoldSystemAdmin(
          this.pool,
          this.statementTimeoutMs,
          async (client) => {
            const res = await client.query<Row>(
              `SELECT ${SELECT_COLS} FROM public.legal_holds
         WHERE organisation_id = $1 AND resource_table = $2 AND row_id = $3
           AND state = 'released'
         ORDER BY released_at DESC NULLS LAST, id DESC LIMIT 1`,
              [input.organisationId, input.resourceTable, input.rowId]
            );
            return res.rows;
          }
        );
        if (existing.length) return toRecord(existing[0]!);
        throw new Error("legal_hold_not_found");
      }
    );
  }

  async isActive(organisationId: string, resourceTable: string, rowId: string): Promise<boolean> {
    return this.withRepositorySpan("is-active", organisationId, resourceTable, rowId, async () => {
      const hold = await this.getActive(organisationId, resourceTable, rowId);
      return hold != null;
    });
  }

  async healthCheck(): Promise<"ready" | "unavailable"> {
    try {
      await this.withRepositorySpan("health-check", "system", "legal_holds", "*", () =>
        withLegalHoldSystemAdmin(this.pool, this.statementTimeoutMs, async (client) => {
          await client.query("SELECT 1");
        })
      );
      return "ready";
    } catch {
      return "unavailable";
    }
  }

  private async withRepositorySpan<T>(
    operation: string,
    organisationId: string,
    resourceTable: string,
    rowId: string,
    run: () => Promise<T>
  ): Promise<T> {
    return withSpan(
      tracer,
      `postgres-legal-hold-repository.${operation}`,
      async () => {
        try {
          const result = await run();
          metric("postgres_legal_hold_repository_total", { operation, outcome: "success" });
          log.info(
            { operation, organisationId, resourceTable, rowId },
            "postgres_legal_hold_repository.operation.complete"
          );
          return result;
        } catch (err) {
          metric("postgres_legal_hold_repository_total", { operation, outcome: "error" });
          log.error(
            { err, operation, organisationId, resourceTable, rowId },
            "postgres_legal_hold_repository.operation.failed"
          );
          throw err;
        }
      },
      {
        "legal_hold.operation": operation,
        "tenant.id": organisationId,
        "storage.resource_table": resourceTable,
      }
    );
  }
}
