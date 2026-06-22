import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PostgresEnvironmentRegistryRepository } from "../../src/adapters/postgres-environment-registry-repository.ts";
import { PostgresProviderConfigRepository } from "../../src/adapters/postgres-provider-config-repository.ts";

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

describe("PostgresEnvironmentRegistryRepository provider reliability", () => {
  it("applies a bounded statement timeout inside the system-admin health check", async () => {
    const fixture = makeProviderPool();
    const repo = new PostgresEnvironmentRegistryRepository(fixture.pool, {
      statementTimeoutMs: 6789,
      retryAttempts: 0,
    });

    await repo.healthCheck();

    assert.deepEqual(fixture.queries.slice(0, 4), [
      "BEGIN",
      "SET LOCAL ROLE rls_bypass",
      "SET LOCAL statement_timeout = 6789",
      `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'environment_registry'
            LIMIT 1`,
    ]);
    assert.equal(fixture.queries.at(-1), "COMMIT");
  });

  it("retries unavailable Postgres and fails closed without a fallback", async () => {
    const fixture = makeProviderPool({ failSelect: true });
    const repo = new PostgresEnvironmentRegistryRepository(fixture.pool, {
      statementTimeoutMs: 650,
      retryAttempts: 1,
      retryBackoffMs: 0,
    });

    await assert.rejects(
      () => repo.healthCheck(),
      /postgres-environment-registry-repository unavailable; no fallback.*fail-closed.*retry/
    );
    assert.equal(
      fixture.queries.filter((q) => q === "SET LOCAL statement_timeout = 650").length,
      2
    );
    assert.equal(fixture.queries.filter((q) => q === "ROLLBACK").length, 2);
    assert.match(repo.recoveryAction(), /POSTGRES_APP_URL/);
  });
});

describe("PostgresProviderConfigRepository provider reliability", () => {
  it("applies a bounded statement timeout inside the system-admin health check", async () => {
    const fixture = makeProviderPool();
    const repo = new PostgresProviderConfigRepository(fixture.pool, {
      statementTimeoutMs: 7890,
      retryAttempts: 0,
    });

    await repo.healthCheck();

    assert.deepEqual(fixture.queries.slice(0, 4), [
      "BEGIN",
      "SET LOCAL ROLE rls_bypass",
      "SET LOCAL statement_timeout = 7890",
      `SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'provider_configs'
            LIMIT 1`,
    ]);
    assert.equal(fixture.queries.at(-1), "COMMIT");
  });

  it("retries unavailable Postgres and fails closed without a fallback", async () => {
    const fixture = makeProviderPool({ failSelect: true });
    const repo = new PostgresProviderConfigRepository(fixture.pool, {
      statementTimeoutMs: 750,
      retryAttempts: 1,
      retryBackoffMs: 0,
    });

    await assert.rejects(
      () => repo.healthCheck(),
      /postgres-provider-config-repository unavailable; no fallback.*fail-closed.*retry/
    );
    assert.equal(
      fixture.queries.filter((q) => q === "SET LOCAL statement_timeout = 750").length,
      2
    );
    assert.equal(fixture.queries.filter((q) => q === "ROLLBACK").length, 2);
    assert.match(repo.recoveryAction(), /POSTGRES_APP_URL/);
  });
});
