import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PostgresObservabilityRepository } from "../../src/adapters/postgres-observability-repository.ts";

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

describe("PostgresObservabilityRepository provider reliability", () => {
  it("applies a bounded statement timeout inside the system-admin health check", async () => {
    const fixture = makeProviderPool();
    const repo = new PostgresObservabilityRepository(fixture.pool, {
      statementTimeoutMs: 8642,
      retryAttempts: 0,
    });

    await repo.healthCheck();

    assert.deepEqual(fixture.queries.slice(0, 4), [
      "BEGIN",
      "SET LOCAL ROLE rls_bypass",
      "SET LOCAL statement_timeout = 8642",
      `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('metric_signals', 'metric_samples', 'alert_rules', 'incidents')
            LIMIT 1`,
    ]);
    assert.equal(fixture.queries.at(-1), "COMMIT");
  });

  it("retries unavailable Postgres and fails closed without a fallback", async () => {
    const fixture = makeProviderPool({ failSelect: true });
    const repo = new PostgresObservabilityRepository(fixture.pool, {
      statementTimeoutMs: 860,
      retryAttempts: 1,
      retryBackoffMs: 0,
    });

    await assert.rejects(
      () => repo.healthCheck(),
      /postgres-observability-repository unavailable; no fallback.*fail-closed.*retry/
    );
    assert.equal(
      fixture.queries.filter((q) => q === "SET LOCAL statement_timeout = 860").length,
      2
    );
    assert.equal(fixture.queries.filter((q) => q === "ROLLBACK").length, 2);
    assert.match(repo.recoveryAction(), /POSTGRES_APP_URL/);
  });
});
