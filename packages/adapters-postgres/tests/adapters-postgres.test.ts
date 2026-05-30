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
  it("sets app.bypass_rls = true", async () => {
    const { calls, pool } = makeSpyPool();
    await withSystemAdmin(pool as never, async () => {});

    const setBypass = calls.find((c) => c.text.includes("app.bypass_rls"));
    assert.ok(setBypass, "set_config app.bypass_rls must be called");
    assert.ok(
      setBypass?.text.includes("set_config"),
      "must use set_config() not SET LOCAL for custom GUC"
    );
    assert.ok(setBypass?.text.includes("true"), "bypass_rls must be set to true");
  });

  it("does NOT set search_path (cross-tenant ? no schema selected)", async () => {
    const { calls, pool } = makeSpyPool();
    await withSystemAdmin(pool as never, async () => {});
    assert.ok(
      !calls.some((c) => c.text.includes("search_path")),
      "withSystemAdmin must not set search_path"
    );
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
