import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError, ValidationError } from "@platform/platform-errors";
import { PostgresMeteringRepository } from "../../src/adapters/postgres-metering-repository.ts";
import { getUsage, recordMeterEvent } from "../../src/usecases/metering.ts";
import type { MeteringRepository } from "../../src/ports/metering-repository.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
} from "../../src/ports/entitlement-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";

function fakeMetering(): MeteringRepository {
  const rows = new Map<string, { organisationId: string; meterKey: string; quantity: number }>();
  return {
    record: async (i) => {
      const k = `${i.organisationId}:${i.meterKey}:${i.idempotencyKey}`;
      if (rows.has(k)) return { recorded: false, deduplicated: true };
      rows.set(k, { organisationId: i.organisationId, meterKey: i.meterKey, quantity: i.quantity });
      return { recorded: true, deduplicated: false };
    },
    aggregate: async (org, meter) =>
      [...rows.values()]
        .filter((r) => r.organisationId === org && r.meterKey === meter)
        .reduce((s, r) => s + r.quantity, 0),
    aggregateAsOperator: async (org, meter) =>
      [...rows.values()]
        .filter((r) => r.organisationId === org && r.meterKey === meter)
        .reduce((s, r) => s + r.quantity, 0),
  };
}

function fakeEntitlements(granted: Set<string>): EntitlementRepository {
  const rec = (org: string, key: string): EntitlementGrantRecord => ({
    organisationId: org,
    entitlementKey: key,
    state: granted.has(key) ? "granted" : "revoked",
    source: "system",
    metadata: {},
    updatedAt: null,
    updatedBy: null,
  });
  return {
    listForTenant: async () => [],
    listForTenantAsOperator: async () => [],
    getGrant: async (org, key) => (granted.has(key) ? rec(org, key) : null),
    upsert: async (i) => rec(i.organisationId, i.entitlementKey),
  };
}

describe("metering usecase", () => {
  it("rejects an unknown meter key", async () => {
    const deps = {
      metering: fakeMetering(),
      entitlements: fakeEntitlements(new Set(["webhooks"])),
    };
    const r = await recordMeterEvent(
      { organisationId: ORG, meterKey: "nope", quantity: 1, idempotencyKey: "a" },
      deps
    );
    assert.equal(r.kind, "unknown_meter");
  });

  it("requires the meter's entitlement (deny-by-default)", async () => {
    const deps = { metering: fakeMetering(), entitlements: fakeEntitlements(new Set()) };
    await assert.rejects(
      recordMeterEvent(
        { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "a" },
        deps
      ),
      ForbiddenError
    );
  });

  it("rejects negative quantity unless an explicit adjustment", async () => {
    const deps = {
      metering: fakeMetering(),
      entitlements: fakeEntitlements(new Set(["webhooks"])),
    };
    await assert.rejects(
      recordMeterEvent(
        { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: -1, idempotencyKey: "a" },
        deps
      ),
      ValidationError
    );
    const adj = await recordMeterEvent(
      {
        organisationId: ORG,
        meterKey: "webhooks.deliveries",
        quantity: -1,
        idempotencyKey: "b",
        metadata: { adjustment: true },
      },
      deps
    );
    assert.equal(adj.kind === "ok" && adj.recorded, true);
  });

  it("is idempotent by tenant + meter + idempotency key", async () => {
    const deps = {
      metering: fakeMetering(),
      entitlements: fakeEntitlements(new Set(["webhooks"])),
    };
    const first = await recordMeterEvent(
      { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "k" },
      deps
    );
    const again = await recordMeterEvent(
      { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: 1, idempotencyKey: "k" },
      deps
    );
    assert.equal(first.kind === "ok" && first.recorded, true);
    assert.equal(again.kind === "ok" && again.deduplicated, true);
  });

  it("aggregates lifetime usage per meter", async () => {
    const deps = {
      metering: fakeMetering(),
      entitlements: fakeEntitlements(new Set(["webhooks"])),
    };
    await recordMeterEvent(
      { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: 2, idempotencyKey: "1" },
      deps
    );
    await recordMeterEvent(
      { organisationId: ORG, meterKey: "webhooks.deliveries", quantity: 3, idempotencyKey: "2" },
      deps
    );
    const usage = await getUsage(ORG, deps);
    assert.equal(usage.usage.find((u) => u.meterKey === "webhooks.deliveries")?.usage, 5);
  });
});

describe("PostgresMeteringRepository provider reliability", () => {
  function makeProviderPool(options: { failSelect?: boolean } = {}) {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (options.failSelect && sql.includes("information_schema.tables")) {
          throw new Error("db down");
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    return {
      queries,
      pool: {
        async connect() {
          return client;
        },
      },
    };
  }

  it("applies a bounded statement timeout inside the system-admin health check", async () => {
    const fixture = makeProviderPool();
    const repo = new PostgresMeteringRepository(fixture.pool, {
      statementTimeoutMs: 3456,
      retryAttempts: 0,
    });

    await repo.healthCheck();

    assert.deepEqual(fixture.queries.slice(0, 4), [
      "BEGIN",
      "SET LOCAL ROLE rls_bypass",
      "SET LOCAL statement_timeout = 3456",
      `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'meter_events'
            LIMIT 1`,
    ]);
    assert.equal(fixture.queries.at(-1), "COMMIT");
  });

  it("retries unavailable Postgres and fails closed without a fallback", async () => {
    const fixture = makeProviderPool({ failSelect: true });
    const repo = new PostgresMeteringRepository(fixture.pool, {
      statementTimeoutMs: 350,
      retryAttempts: 1,
      retryBackoffMs: 0,
    });

    await assert.rejects(
      () => repo.healthCheck(),
      /postgres-metering-repository unavailable; no fallback.*fail-closed.*retry/
    );
    assert.equal(
      fixture.queries.filter((q) => q === "SET LOCAL statement_timeout = 350").length,
      2
    );
    assert.equal(fixture.queries.filter((q) => q === "ROLLBACK").length, 2);
    assert.match(repo.recoveryAction(), /POSTGRES_APP_URL/);
  });
});
