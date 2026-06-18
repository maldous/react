// ---------------------------------------------------------------------------
// Metering repository port (ADR-0067 / ADR-ACT-0256)
//
// Tenant-scoped, append-safe usage records, idempotent by tenant + meter +
// idempotency key. "How much usage was recorded?" — never "what to charge".
// Built-in Postgres adapter today; ClickHouse/OpenMeter providerisation follows
// behind this same port (Phase 2.5). No secret fields.
// ---------------------------------------------------------------------------

import type { QuotaWindow } from "@platform/contracts-admin";

export interface RecordMeterEventInput {
  organisationId: string;
  meterKey: string;
  quantity: number;
  idempotencyKey: string;
  subjectId?: string;
  occurredAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MeteringRepository {
  /** Idempotent insert. `deduplicated` = a row with the same (tenant, meter, key) already existed. */
  record(input: RecordMeterEventInput): Promise<{ recorded: boolean; deduplicated: boolean }>;
  /** Sum of quantity for the tenant + meter within the window (tenant self-read, RLS-scoped). */
  aggregate(organisationId: string, meterKey: string, window: QuotaWindow): Promise<number>;
  /** Operator aggregate (rls_bypass) for a target tenant. */
  aggregateAsOperator(
    organisationId: string,
    meterKey: string,
    window: QuotaWindow
  ): Promise<number>;
}
