import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PostgresOrganisationRepository,
  PostgresReadinessAdapter,
  withTenant,
  withTenantActor,
  withSystemAdmin,
  queryTenantSchema,
  tenantSchemaIdentifier,
  UUID_V4_RE,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Fake pool for unit tests ? no real Postgres required
// ---------------------------------------------------------------------------

function makeFakePool(rows: Record<string, unknown>[]) {
  return {
    query: async () => ({ rows }),
    connect: async () => ({
      query: async () => ({ rows }),
      release: () => {},
    }),
  };
}

// ---------------------------------------------------------------------------
// PostgresOrganisationRepository ? unit tests
// ---------------------------------------------------------------------------

describe("PostgresOrganisationRepository", () => {
  it("getById returns null when no rows", async () => {
    const repo = new PostgresOrganisationRepository("", makeFakePool([]) as never);
    const result = await repo.getById("org-1");
    assert.strictEqual(result, null);
  });

  it("getById maps row to OrganisationProfile", async () => {
    const now = new Date();
    const repo = new PostgresOrganisationRepository(
      "",
      makeFakePool([
        { id: "org-1", slug: "acme", display_name: "Acme Corp", created_at: now, updated_at: now },
      ]) as never
    );
    const result = await repo.getById("org-1");
    assert.ok(result !== null);
    assert.strictEqual(result.id, "org-1");
    assert.strictEqual(result.slug, "acme");
    assert.strictEqual(result.displayName, "Acme Corp");
    assert.ok(typeof result.createdAt === "string");
  });

  it("updateDisplayName returns null when no rows", async () => {
    const repo = new PostgresOrganisationRepository("", makeFakePool([]) as never);
    const result = await repo.updateDisplayName("org-1", "New Name");
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// PostgresReadinessAdapter ? construction
// ---------------------------------------------------------------------------

describe("PostgresReadinessAdapter", () => {
  it("constructs without error", () => {
    const adapter = new PostgresReadinessAdapter("postgresql://localhost/test");
    assert.ok(adapter !== null);
  });
});

// ---------------------------------------------------------------------------
// tenantSchemaIdentifier ? validation
// ---------------------------------------------------------------------------

describe("tenantSchemaIdentifier", () => {
  it("rejects non-UUID input", () => {
    const fakeClient = { escapeIdentifier: (s: string) => `"${s}"` };
    assert.throws(() => tenantSchemaIdentifier(fakeClient as never, "not-a-uuid"), {
      message: /Invalid organisationId/,
    });
  });

  it("rejects empty string", () => {
    const fakeClient = { escapeIdentifier: (s: string) => `"${s}"` };
    assert.throws(() => tenantSchemaIdentifier(fakeClient as never, ""), { message: /Invalid/ });
  });

  it("accepts valid UUID v4 and returns quoted identifier", () => {
    const fakeClient = { escapeIdentifier: (s: string) => `"${s}"` };
    const id = "a1b2c3d4-e5f6-4000-8000-123456789abc";
    const result = tenantSchemaIdentifier(fakeClient as never, id);
    assert.ok(result.startsWith('"tenant_'));
    assert.ok(!result.includes("-")); // hyphens replaced by underscores
  });
});

// ---------------------------------------------------------------------------
// UUID_V4_RE ? exported pattern
// ---------------------------------------------------------------------------

describe("UUID_V4_RE", () => {
  it("accepts valid UUID v4", () => {
    assert.ok(UUID_V4_RE.test("a1b2c3d4-e5f6-4000-8000-123456789abc"));
  });
  it("rejects UUID v1", () => {
    assert.ok(!UUID_V4_RE.test("6ba7b810-9dad-11d1-80b4-00c04fd430c8"));
  });
  it("rejects arbitrary string", () => {
    assert.ok(!UUID_V4_RE.test("not-a-uuid"));
  });
});

// ---------------------------------------------------------------------------
// withTenant / withTenantActor / withSystemAdmin ? context setting
//
// These tests use a spy pool to verify the exact SQL SET LOCAL statements
// are issued in the correct order. No real Postgres required.
// ---------------------------------------------------------------------------

interface QueryCall {
  text: string;
  values?: unknown[];
}

function makeSpyPool(): { calls: QueryCall[]; pool: ReturnType<typeof makeFakePool> } {
  const calls: QueryCall[] = [];
  const pool = {
    connect: async () => ({
      calls,
      escapeIdentifier: (s: string) => `"${s}"`,
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  return { calls, pool: pool as never };
}

describe("withTenant", () => {
  it("sets search_path and app.current_tenant_id in order", async () => {
    const { calls, pool } = makeSpyPool();
    const organisationId = "a1b2c3d4-e5f6-4000-8000-123456789abc";
    await withTenant(pool as never, organisationId, async () => {});

    const setSearchPath = calls.find((c) => c.text.includes("search_path"));
    const setTenantId = calls.find((c) => c.text.includes("app.current_tenant_id"));

    assert.ok(setSearchPath, "SET LOCAL search_path must be called");
    assert.ok(setTenantId, "set_config app.current_tenant_id must be called");
    // set_config uses $1 parameter for the value
    assert.deepStrictEqual(setTenantId?.values, [organisationId]);
    // must use set_config, not SET LOCAL, for custom GUC values
    assert.ok(
      setTenantId?.text.includes("set_config"),
      "must use set_config() not SET LOCAL for custom GUC"
    );

    // search_path must come before current_tenant_id
    const spIdx = calls.indexOf(setSearchPath!);
    const tenantIdx = calls.indexOf(setTenantId!);
    assert.ok(spIdx < tenantIdx, "search_path must be set before current_tenant_id");
  });

  it("rolls back on error and re-throws", async () => {
    const { calls, pool } = makeSpyPool();
    const err = new Error("test error");
    await assert.rejects(
      () =>
        withTenant(pool as never, "a1b2c3d4-e5f6-4000-8000-123456789abc", async () => {
          throw err;
        }),
      { message: "test error" }
    );
    assert.ok(
      calls.some((c) => c.text === "ROLLBACK"),
      "ROLLBACK must be called on error"
    );
    assert.ok(!calls.some((c) => c.text === "COMMIT"), "COMMIT must not be called on error");
  });
});

describe("withTenantActor", () => {
  it("sets search_path, current_tenant_id, and current_user_id", async () => {
    const { calls, pool } = makeSpyPool();
    const orgId = "a1b2c3d4-e5f6-4000-8000-123456789abc";
    const userId = "b2c3d4e5-f6a7-4000-8000-abcdef123456";
    await withTenantActor(pool as never, orgId, userId, async () => {});

    const setUserId = calls.find((c) => c.text.includes("app.current_user_id"));
    assert.ok(setUserId, "set_config app.current_user_id must be called");
    assert.deepStrictEqual(setUserId?.values, [userId]);
    assert.ok(
      setUserId?.text.includes("set_config"),
      "must use set_config() not SET LOCAL for custom GUC"
    );
  });
});

describe("withSystemAdmin", () => {
  it("uses SET LOCAL ROLE rls_bypass — not set_config GUC (ADR-ACT-0184 / ADR-ACT-0189)", async () => {
    // RLS bypass is controlled by SET LOCAL ROLE rls_bypass (transaction-scoped role switch),
    // not by a user-settable session GUC. A GUC like set_config('app.bypass_rls', ...) could
    // be forged by any connection holder; SET LOCAL ROLE requires actual role membership.
    const { calls, pool } = makeSpyPool();
    await withSystemAdmin(pool as never, async () => {});

    // Must NOT use set_config to set any bypass variable
    const gucBypassCall = calls.find(
      (c) => c.text.toLowerCase().includes("set_config") && c.text.toLowerCase().includes("bypass")
    );
    assert.strictEqual(
      gucBypassCall,
      undefined,
      "withSystemAdmin must NOT use set_config to bypass RLS — use SET LOCAL ROLE instead"
    );

    // Must use SET LOCAL ROLE rls_bypass
    const roleSwitch = calls.find((c) =>
      c.text.toLowerCase().includes("set local role rls_bypass")
    );
    assert.ok(roleSwitch, "withSystemAdmin must SET LOCAL ROLE rls_bypass for RLS bypass");
  });

  it("does NOT set search_path (cross-tenant — no schema selected)", async () => {
    const { calls, pool } = makeSpyPool();
    await withSystemAdmin(pool as never, async () => {});
    assert.ok(
      !calls.some((c) => c.text.includes("search_path")),
      "withSystemAdmin must not set search_path"
    );
  });

  it("wraps fn in BEGIN/COMMIT and releases client", async () => {
    const { calls, pool } = makeSpyPool();
    let fnCalled = false;
    await withSystemAdmin(pool as never, async () => {
      fnCalled = true;
    });
    assert.ok(fnCalled, "callback must be called");
    assert.ok(
      calls.some((c) => c.text === "BEGIN"),
      "BEGIN must be issued"
    );
    assert.ok(
      calls.some((c) => c.text === "COMMIT"),
      "COMMIT must be issued"
    );
  });

  it("rolls back on error and re-throws", async () => {
    const { calls, pool } = makeSpyPool();
    await assert.rejects(
      () =>
        withSystemAdmin(pool as never, async () => {
          throw new Error("admin error");
        }),
      { message: "admin error" }
    );
    assert.ok(
      calls.some((c) => c.text === "ROLLBACK"),
      "ROLLBACK must be called on error"
    );
    assert.ok(!calls.some((c) => c.text === "COMMIT"), "COMMIT must not be called on error");
  });
});

// ---------------------------------------------------------------------------
// queryTenantSchema ? transaction order and rollback
// ---------------------------------------------------------------------------

describe("queryTenantSchema", () => {
  it("wraps query in BEGIN, SET LOCAL search_path, query, COMMIT order", async () => {
    const { calls, pool } = makeSpyPool();
    const orgId = "a1b2c3d4-e5f6-4000-8000-123456789abc";
    await queryTenantSchema(pool as never, orgId, "SELECT 1");

    const texts = calls.map((c) => c.text);
    const beginIdx = texts.indexOf("BEGIN");
    const setPathIdx = texts.findIndex((t) => t.includes("search_path"));
    const commitIdx = texts.indexOf("COMMIT");

    assert.ok(beginIdx !== -1, "BEGIN must be called");
    assert.ok(setPathIdx !== -1, "SET LOCAL search_path must be called");
    assert.ok(commitIdx !== -1, "COMMIT must be called");

    assert.ok(beginIdx < setPathIdx, "BEGIN must come before SET LOCAL search_path");
    assert.ok(setPathIdx < commitIdx, "SET LOCAL search_path must come before COMMIT");
  });

  it("issues ROLLBACK and re-throws on query error", async () => {
    const { calls, pool: basePool } = makeSpyPool();
    // Override pool to throw on the actual query (not on BEGIN/SET)
    let queryCount = 0;
    const errorPool = {
      connect: async () => {
        const client = await basePool.connect();
        const originalQuery = (client as unknown as { query: (...a: unknown[]) => unknown }).query;
        (client as unknown as { query: (...a: unknown[]) => unknown }).query = async function (
          text: unknown,
          ...rest: unknown[]
        ) {
          queryCount++;
          // Throw on the 3rd call (after BEGIN and SET LOCAL, before COMMIT)
          if (queryCount === 3) throw new Error("query failed");
          return originalQuery.call(this, text, ...rest);
        };
        return client;
      },
    };
    const orgId = "a1b2c3d4-e5f6-4000-8000-123456789abc";
    await assert.rejects(() => queryTenantSchema(errorPool as never, orgId, "SELECT 1"), {
      message: "query failed",
    });
    assert.ok(
      calls.some((c) => c.text === "ROLLBACK"),
      "ROLLBACK must be called on error"
    );
    assert.ok(!calls.some((c) => c.text === "COMMIT"), "COMMIT must not be called on error");
  });

  it("rejects non-UUID organisationId without issuing any SQL", async () => {
    const { calls, pool } = makeSpyPool();
    await assert.rejects(() => queryTenantSchema(pool as never, "not-a-uuid", "SELECT 1"), {
      message: /Invalid organisationId/,
    });
    assert.strictEqual(calls.length, 0, "No SQL must be issued for invalid organisationId");
  });
});

// ---------------------------------------------------------------------------
// Static migration content assertions (ADR-ACT-0184)
// Verify that migration 008 uses pg_has_role and that the adapter source
// no longer contains the user-settable app.bypass_rls GUC.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _dir = dirname(fileURLToPath(import.meta.url));

describe("ADR-ACT-0184 static assertions", () => {
  it("migration 008 uses pg_has_role for bypass — not app.bypass_rls GUC", () => {
    const migration = readFileSync(
      join(_dir, "../../../apps/platform-api/src/db/migrations/008-rls-bypass-role.sql"),
      "utf8"
    );
    assert.ok(
      migration.includes("pg_has_role"),
      "migration 008 must use pg_has_role for RLS bypass"
    );
    assert.ok(
      !migration.includes("set_config") || !migration.includes("bypass_rls"),
      "migration 008 must not set app.bypass_rls via set_config"
    );
  });

  it("adapters-postgres/src/index.ts does not call set_config for app.bypass_rls", () => {
    const source = readFileSync(join(_dir, "../src/index.ts"), "utf8");
    // Strip comment lines before checking — comments documenting the old approach are acceptable.
    const codeOnly = source
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    assert.ok(
      !codeOnly.includes("bypass_rls"),
      "adapters-postgres runtime code must not set app.bypass_rls GUC — bypass is via role membership"
    );
  });
});

// ---------------------------------------------------------------------------
// Static migration content assertions (ADR-ACT-0189)
// Verify migration 010 creates platform_app correctly and that the init
// script mirrors the role creation at fresh initdb time.
// ---------------------------------------------------------------------------

describe("ADR-ACT-0189 static assertions — migration 010 platform_app role", () => {
  const migration010 = readFileSync(
    join(_dir, "../../../apps/platform-api/src/db/migrations/010-platform-app-role.sql"),
    "utf8"
  );

  it("migration 010 creates platform_app with NOSUPERUSER", () => {
    assert.ok(
      migration010.includes("platform_app"),
      "migration 010 must reference platform_app role"
    );
    assert.ok(
      migration010.includes("NOSUPERUSER"),
      "migration 010 must create platform_app with NOSUPERUSER"
    );
  });

  it("migration 010 creates platform_app with NOBYPASSRLS", () => {
    assert.ok(
      migration010.includes("NOBYPASSRLS"),
      "migration 010 must create platform_app with NOBYPASSRLS"
    );
  });

  it("migration 010 grants rls_bypass to platform_app", () => {
    assert.ok(migration010.includes("rls_bypass"), "migration 010 must reference rls_bypass role");
    assert.ok(
      migration010.toLowerCase().includes("grant rls_bypass to platform_app"),
      "migration 010 must GRANT rls_bypass TO platform_app"
    );
  });

  it("migration 010 grants DML on all existing tables to platform_app", () => {
    assert.ok(
      migration010
        .toLowerCase()
        .includes(
          "grant select, insert, update, delete on all tables in schema public to platform_app"
        ),
      "migration 010 must GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform_app"
    );
  });

  it("migration 010 sets ALTER DEFAULT PRIVILEGES for future tables and sequences", () => {
    assert.ok(
      migration010.toLowerCase().includes("alter default privileges"),
      "migration 010 must set ALTER DEFAULT PRIVILEGES for future tables/sequences"
    );
  });

  it("init-extra-databases.sh creates platform_app at initdb with NOBYPASSRLS", () => {
    const initScript = readFileSync(
      join(_dir, "../../../docker/postgres/init-extra-databases.sh"),
      "utf8"
    );
    assert.ok(
      initScript.includes("platform_app"),
      "init-extra-databases.sh must create platform_app role at initdb"
    );
    assert.ok(
      initScript.includes("NOBYPASSRLS"),
      "init-extra-databases.sh must create platform_app with NOBYPASSRLS"
    );
  });
});
