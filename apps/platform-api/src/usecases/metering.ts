// ---------------------------------------------------------------------------
// Metering usecase (ADR-0067 / ADR-ACT-0256)
//
// Records tenant-scoped usage and aggregates it. "How much usage was recorded?"
// Server-authoritative; idempotent by tenant + meter + idempotency key. Recording
// a metered event requires the meter's capability entitlement (deny-by-default).
// Negative quantity is rejected unless the event is an explicit adjustment.
// Metering never decides "what to charge" — that is billing (Phase 9, not delivered).
// ---------------------------------------------------------------------------

import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import {
  METER_KEYS,
  type MeterKey,
  type QuotaWindow,
  type UsageResponse,
} from "@platform/contracts-admin";
import type { MeteringRepository, RecordMeterEventInput } from "../ports/metering-repository.ts";
import type { EntitlementRepository } from "../ports/entitlement-repository.ts";

export interface MeteringDeps {
  metering: MeteringRepository;
  entitlements: EntitlementRepository;
}

/** Each meter maps to the capability entitlement that gates recording it. */
export interface MeterDefinition {
  key: MeterKey;
  entitlementKey: string;
  displayName: string;
  unit: string;
}

export const METER_CATALOG: readonly MeterDefinition[] = [
  {
    key: "webhooks.deliveries",
    entitlementKey: "webhooks",
    displayName: "Webhook deliveries",
    unit: "deliveries",
  },
  { key: "storage.bytes", entitlementKey: "storage", displayName: "Storage used", unit: "bytes" },
  {
    key: "custom_domains.count",
    entitlementKey: "custom_domains",
    displayName: "Custom domains",
    unit: "domains",
  },
  {
    key: "observability.log_queries",
    entitlementKey: "advanced_observability",
    displayName: "Log queries",
    unit: "queries",
  },
] as const;

const METER_BY_KEY = new Map<string, MeterDefinition>(METER_CATALOG.map((m) => [m.key, m]));

export function meterDefinition(meterKey: string): MeterDefinition | undefined {
  return METER_BY_KEY.get(meterKey);
}

export type RecordMeterEventResult =
  | { kind: "ok"; recorded: boolean; deduplicated: boolean }
  | { kind: "unknown_meter" };

async function isEntitled(
  entitlements: EntitlementRepository,
  organisationId: string,
  entitlementKey: string
): Promise<boolean> {
  return (await entitlements.getGrant(organisationId, entitlementKey))?.state === "granted";
}

/**
 * Record a metered usage event. Validates the meter key + quantity, enforces the
 * meter's entitlement, then records idempotently. Throws typed errors; never audits
 * individual events (events are the data, not a privileged action).
 */
export async function recordMeterEvent(
  input: {
    organisationId: string;
    meterKey: string;
    quantity: number;
    idempotencyKey: string;
    subjectId?: string;
    occurredAt?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  },
  deps: MeteringDeps
): Promise<RecordMeterEventResult> {
  const def = METER_BY_KEY.get(input.meterKey);
  if (!def) return { kind: "unknown_meter" };

  if (!Number.isFinite(input.quantity)) {
    throw new ValidationError("api.error.invalidMeterQuantity", {
      safeDetails: { meterKey: input.meterKey },
    });
  }
  const isAdjustment = input.metadata?.["adjustment"] === true;
  if (input.quantity < 0 && !isAdjustment) {
    throw new ValidationError("api.error.negativeMeterQuantity", {
      safeDetails: { meterKey: input.meterKey },
    });
  }

  // Deny-by-default: recording usage requires the meter's capability entitlement.
  if (!(await isEntitled(deps.entitlements, input.organisationId, def.entitlementKey))) {
    throw new ForbiddenError("api.error.notEntitled", {
      safeDetails: { entitlement: def.entitlementKey, meterKey: input.meterKey },
    });
  }

  const record: RecordMeterEventInput = {
    organisationId: input.organisationId,
    meterKey: def.key,
    quantity: input.quantity,
    idempotencyKey: input.idempotencyKey,
    subjectId: input.subjectId,
    occurredAt: input.occurredAt,
    source: input.source,
    metadata: input.metadata,
  };
  const result = await deps.metering.record(record);
  return { kind: "ok", ...result };
}

/** Lifetime usage per meter for a tenant (self-read RLS, or operator view). */
export async function getUsage(
  organisationId: string,
  deps: MeteringDeps,
  opts: { operator?: boolean } = {}
): Promise<UsageResponse> {
  const window: QuotaWindow = "lifetime";
  const usage = await Promise.all(
    METER_CATALOG.map(async (m) => ({
      meterKey: m.key,
      displayName: m.displayName,
      window,
      usage: opts.operator
        ? await deps.metering.aggregateAsOperator(organisationId, m.key, window)
        : await deps.metering.aggregate(organisationId, m.key, window),
    }))
  );
  return { usage };
}

export const KNOWN_METER_KEYS: readonly string[] = METER_KEYS;
