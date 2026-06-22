import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditAction, type AuditEvent, type AuditEventPort } from "@platform/audit-events";
import {
  getPostgresQuotaRepositoryMetric,
  PostgresQuotaRepository,
} from "../../src/adapters/postgres-quota-repository.ts";
import { assertQuota, evaluateQuota, listQuotas, setQuota } from "../../src/usecases/quota.ts";
import type { MeteringRepository } from "../../src/ports/metering-repository.ts";
import type {
  QuotaRecord,
  QuotaRepository,
  UpsertQuotaInput,
} from "../../src/ports/quota-repository.ts";
import type {
  EntitlementGrantRecord,
  EntitlementRepository,
} from "../../src/ports/entitlement-repository.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const ACTOR = { actorId: "op", actorRoles: ["system_operator"] };

function fakeMetering(usage: number): MeteringRepository {
  return {
    record: async () => ({ recorded: true, deduplicated: false }),
    aggregate: async () => usage,
    aggregateAsOperator: async () => usage,
  };
}
function fakeEntitlements(granted: boolean): EntitlementRepository {
  const rec: EntitlementGrantRecord = {
    organisationId: ORG,
    entitlementKey: "webhooks",
    state: granted ? "granted" : "revoked",
    source: "system",
    metadata: {},
    updatedAt: null,
    updatedBy: null,
  };
  return {
    listForTenant: async () => [],
    listForTenantAsOperator: async () => [],
    getGrant: async () => (granted ? rec : null),
    upsert: async () => rec,
  };
}
function fakeQuota(initial?: QuotaRecord): QuotaRepository {
  let row = initial ?? null;
  return {
    listForTenant: async () => (row ? [row] : []),
    listForTenantAsOperator: async () => (row ? [row] : []),
    getByKey: async (_o, k) => (row && row.quotaKey === k ? row : null),
    upsert: async (i: UpsertQuotaInput) => {
      row = { ...i, updatedAt: null, updatedBy: i.updatedBy };
      return row;
    },
  };
}
function capturingAudit(): { port: AuditEventPort; events: AuditEvent[]; fail: () => void } {
  const events: AuditEvent[] = [];
  let f = false;
  return {
    events,
    fail: () => (f = true),
    port: {
      emit: async (e) => {
        if (f) throw new Error("audit down");
        events.push(e);
      },
      query: async () => events,
    },
  };
}

const quota = (): QuotaRecord => ({
  organisationId: ORG,
  quotaKey: "webhooks.deliveries",
  entitlementKey: "webhooks",
  meterKey: "webhooks.deliveries",
  limit: 3,
  window: "lifetime",
  action: "deny",
  updatedAt: null,
  updatedBy: null,
});

describe("quota usecase", () => {
  it("allows when no quota is configured (no_quota)", async () => {
    const deps = {
      quota: fakeQuota(),
      metering: fakeMetering(0),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const r = await evaluateQuota(ORG, "webhooks.deliveries", deps);
    assert.equal(r.allowed, true);
    assert.equal(r.decidedBy, "no_quota");
  });

  it("allows when usage is below the limit", async () => {
    const deps = {
      quota: fakeQuota(quota()),
      metering: fakeMetering(2),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const r = await evaluateQuota(ORG, "webhooks.deliveries", deps);
    assert.equal(r.allowed, true);
    assert.equal(r.state, "within");
  });

  it("denies (by quota) when usage reaches the limit", async () => {
    const deps = {
      quota: fakeQuota(quota()),
      metering: fakeMetering(3),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const r = await evaluateQuota(ORG, "webhooks.deliveries", deps);
    assert.equal(r.allowed, false);
    assert.equal(r.decidedBy, "quota");
    assert.equal(r.state, "exceeded");
  });

  it("denies by ENTITLEMENT before quota when not entitled", async () => {
    const deps = {
      quota: fakeQuota(quota()),
      metering: fakeMetering(0),
      entitlements: fakeEntitlements(false),
      audit: capturingAudit().port,
    };
    const r = await evaluateQuota(ORG, "webhooks.deliveries", deps);
    assert.equal(r.allowed, false);
    assert.equal(r.decidedBy, "entitlement");
  });

  it("assertQuota throws a typed error when denied", async () => {
    const deps = {
      quota: fakeQuota(quota()),
      metering: fakeMetering(3),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    await assert.rejects(assertQuota(ORG, "webhooks.deliveries", deps));
  });

  it("setQuota audits before the write (failure aborts)", async () => {
    const audit = capturingAudit();
    const q = fakeQuota();
    const deps = {
      quota: q,
      metering: fakeMetering(0),
      entitlements: fakeEntitlements(true),
      audit: audit.port,
    };
    audit.fail();
    await assert.rejects(
      setQuota(
        {
          organisationId: ORG,
          quotaKey: "webhooks.deliveries",
          entitlementKey: "webhooks",
          meterKey: "webhooks.deliveries",
          limit: 3,
          window: "lifetime",
          actor: ACTOR,
        },
        deps
      )
    );
    assert.deepEqual(await q.listForTenant(ORG), []);
  });

  it("setQuota emits a quota.set audit event then upserts", async () => {
    const audit = capturingAudit();
    const deps = {
      quota: fakeQuota(),
      metering: fakeMetering(0),
      entitlements: fakeEntitlements(true),
      audit: audit.port,
    };
    const r = await setQuota(
      {
        organisationId: ORG,
        quotaKey: "webhooks.deliveries",
        entitlementKey: "webhooks",
        meterKey: "webhooks.deliveries",
        limit: 5,
        window: "lifetime",
        actor: ACTOR,
      },
      deps
    );
    assert.equal(r.kind, "ok");
    assert.equal(audit.events[0]?.action, AuditAction.QuotaSet);
    assert.equal(audit.events[0]?.resource, "quota");
  });

  it("listQuotas reports usage + live state", async () => {
    const deps = {
      quota: fakeQuota(quota()),
      metering: fakeMetering(3),
      entitlements: fakeEntitlements(true),
      audit: capturingAudit().port,
    };
    const res = await listQuotas(ORG, deps);
    assert.equal(res.quotas[0]?.state, "exceeded");
    assert.equal(res.quotas[0]?.allowed, false);
  });
});

describe("PostgresQuotaRepository provider reliability", () => {
  function makeProviderPool(options: { failSelect?: boolean } = {}) {
    const queries: string[] = [];
    const quotaRow = {
      organisation_id: ORG,
      quota_key: "storage.bytes",
      entitlement_key: "storage",
      meter_key: "storage.bytes",
      limit_value: "100",
      window_kind: "lifetime",
      action: "deny",
      updated_at: null,
      updated_by: "op",
    };
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (options.failSelect && sql.includes("information_schema.tables")) {
          throw new Error("db down");
        }
        if (sql.includes("INSERT INTO public.tenant_quotas")) return { rows: [quotaRow] };
        if (sql.includes("SELECT") && sql.includes("public.tenant_quotas")) {
          return { rows: [quotaRow] };
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
    const repo = new PostgresQuotaRepository(fixture.pool, {
      statementTimeoutMs: 4567,
      retryAttempts: 0,
    });

    await repo.healthCheck();

    assert.deepEqual(fixture.queries.slice(0, 4), [
      "BEGIN",
      "SET LOCAL ROLE rls_bypass",
      "SET LOCAL statement_timeout = 4567",
      `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'tenant_quotas'
            LIMIT 1`,
    ]);
    assert.equal(fixture.queries.at(-1), "COMMIT");
  });

  it("retries unavailable Postgres and fails closed without a fallback", async () => {
    const fixture = makeProviderPool({ failSelect: true });
    const repo = new PostgresQuotaRepository(fixture.pool, {
      statementTimeoutMs: 450,
      retryAttempts: 1,
      retryBackoffMs: 0,
    });

    await assert.rejects(
      () => repo.healthCheck(),
      /postgres-quota-repository unavailable; no fallback.*fail-closed.*retry/
    );
    assert.equal(
      fixture.queries.filter((q) => q === "SET LOCAL statement_timeout = 450").length,
      2
    );
    assert.equal(fixture.queries.filter((q) => q === "ROLLBACK").length, 2);
    assert.match(repo.recoveryAction(), /POSTGRES_APP_URL/);
  });

  it("emits audit and metric evidence around quota repository reads and writes", async () => {
    const fixture = makeProviderPool();
    const audit: string[] = [];
    const before = getPostgresQuotaRepositoryMetric("postgres_quota_repository_total", {
      operation: "upsert",
      outcome: "success",
    });
    const repo = new PostgresQuotaRepository(fixture.pool, {
      retryAttempts: 0,
      auditEvent: async (event) => {
        audit.push(`${event.action}:${event.quotaKey ?? "all"}`);
      },
    });

    await repo.upsert({
      organisationId: ORG,
      quotaKey: "storage.bytes",
      entitlementKey: "storage",
      meterKey: "storage.bytes",
      limit: 100,
      window: "lifetime",
      action: "deny",
      updatedBy: "op",
    });
    await repo.listForTenantAsOperator(ORG);

    assert.deepEqual(audit, ["quota.repository.upsert:storage.bytes", "quota.repository.read:all"]);
    assert.equal(
      getPostgresQuotaRepositoryMetric("postgres_quota_repository_total", {
        operation: "upsert",
        outcome: "success",
      }),
      before + 1
    );
    assert.ok(
      repo
        .recoveryAction()
        .includes("storage quota-before-write policy before uploaded/quarantined/clean/rejected")
    );
  });
});
