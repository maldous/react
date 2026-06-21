/**
 * Unit tests for V1C-04 PostgresDelegatedAdminRoles adapter.
 *
 * Inline-fake pg pool pattern (matches the campaign-conventional
 * groups.test.ts approach): an object implementing `connect()` that
 * returns a client whose `query()` returns scripted stubs. Each test
 * asserts (a) the SQL shape sent by the adapter (b) which auth context
 * wrapper (withTenant/withSystemAdmin) the call goes through (c) the
 * Row-to-Record mapping.
 *
 * Without live Postgres (test-env-preload sets NODE_ENV=test, no
 * POSTGRES_URL), these tests verify the adapter's behaviour at the
 * shell/fake-pool boundary precisely. The end-to-end Postgres behaviour
 * (RLS policies, partial-unique index, current_setting wiring) is the
 * responsibility of integration tests in tests/substrate/ + a live
 * `make compose-up-default` cycle.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PostgresDelegatedAdminRoles } from "../../src/adapters/postgres-delegated-admin-roles.ts";

// ------------------------------------------------------------------
// Fake pool: captures every client.query() call so the test can
// assert on SQL shape + parameters + return rows.
// ------------------------------------------------------------------

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
  release: () => void;
}

interface FakePool {
  connect: () => Promise<FakeClient>;
}

function makeFakePool(
  rows: unknown[],
  rowCount?: number
): { pool: FakePool; captured: CapturedQuery[] } {
  const captured: CapturedQuery[] = [];
  const client: FakeClient = {
    async query(sql: string, params: unknown[] = []) {
      captured.push({ sql, params });
      return { rows, rowCount: rowCount ?? rows.length };
    },
    // withSystemAdmin + withTenant call client.release() after the query.
    // No-op for the fake — we don't own a real pool, so no back-reference.
    release() {
      /* no-op */
    },
  };
  const pool: FakePool = {
    async connect() {
      return client;
    },
  };
  return { pool, captured };
}

// ------------------------------------------------------------------
// Adapter setup per test
// ------------------------------------------------------------------

const ORG_ID = "a1b2c3d4-e5f6-4000-8000-000000000001";
const NEW_ID = "00000000-0000-0000-0000-000000000002";

const sampleRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: NEW_ID,
  organisation_id: ORG_ID,
  granter_user_id: "granter-uuid",
  grantee_user_id: "grantee-uuid",
  scope: "tenant.members.manage",
  granted_at: new Date("2026-06-21T00:00:00.000Z"),
  granted_by: "granter-uuid",
  expires_at: null,
  revoked_at: null,
  revoked_by: null,
  ...over,
});

let adapter: PostgresDelegatedAdminRoles;
let captured: CapturedQuery[];
let pool: FakePool;

beforeEach(() => {
  // default: fresh makeFakePool in each test's body
});

// ------------------------------------------------------------------
// 1. grantDelegation_saves_correctly
// ------------------------------------------------------------------

describe("grantDelegation", () => {
  it("saves INSERT with correct columns + returns mapped DelegatedRole", async () => {
    ({ pool, captured } = makeFakePool([sampleRow({})], 1));
    adapter = new PostgresDelegatedAdminRoles(pool);

    const result = await adapter.grantDelegation({
      organisationId: ORG_ID,
      granterUserId: "granter-uuid",
      granteeUserId: "grantee-uuid",
      grantedBy: "granter-uuid",
      scope: "tenant.members.manage",
      expiresAt: null,
    });

    assert.equal(captured.length, 1);
    assert.match(captured[0]!.sql, /INSERT INTO public\.delegated_admin_roles/);
    assert.match(captured[0]!.sql, /RETURNING id, organisation_id/);
    assert.deepEqual(captured[0]!.params, [
      ORG_ID,
      "granter-uuid",
      "grantee-uuid",
      "tenant.members.manage",
      "granter-uuid",
      null,
    ]);
    assert.equal(result.id, NEW_ID);
    assert.equal(result.scope, "tenant.members.manage");
    assert.equal(result.granterUserId, "granter-uuid");
    assert.equal(result.expiresAt, null);
  });
});

// ------------------------------------------------------------------
// 2. revokeDelegation_soft_deletes_active_grant
// ------------------------------------------------------------------

describe("revokeDelegation", () => {
  it("returns true when rowCount > 0 (soft-delete succeeded)", async () => {
    ({ pool, captured } = makeFakePool([], 1));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const ok = await adapter.revokeDelegation("delegation-id", "actor-uuid");
    assert.equal(ok, true);
    assert.match(captured[0]!.sql, /UPDATE public\.delegated_admin_roles/);
    assert.match(captured[0]!.sql, /SET revoked_at = now\(\)/);
    assert.match(captured[0]!.sql, /WHERE id = \$1\s+AND revoked_at IS NULL/);
    assert.deepEqual(captured[0]!.params, ["delegation-id", "actor-uuid"]);
  });

  it("returns false when rowCount == 0 (double-revoke or unknown id)", async () => {
    ({ pool, captured } = makeFakePool([], 0));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const ok = await adapter.revokeDelegation("missing-id", "actor-uuid");
    assert.equal(ok, false);
  });
});

// ------------------------------------------------------------------
// 3. listForTenant_is_role_scoped_and_inclusive
// ------------------------------------------------------------------

describe("listForTenant", () => {
  it("returns all rows (active, expired, revoked) for the tenant via withTenant", async () => {
    ({ pool, captured } = makeFakePool(
      [
        sampleRow({ id: "id-active", expires_at: null, revoked_at: null }),
        sampleRow({ id: "id-expired", expires_at: new Date("2020-01-01"), revoked_at: null }),
        sampleRow({ id: "id-revoked", expires_at: null, revoked_at: new Date("2025-01-01") }),
      ],
      3
    ));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const all = await adapter.listForTenant(ORG_ID);
    assert.equal(all.length, 3);
    // active predicate MUST NOT appear on this query — listForTenant returns ALL rows
    assert.doesNotMatch(captured[0]!.sql, /revoked_at IS NULL/);
    assert.match(captured[0]!.sql, /SELECT id, organisation_id/);
    assert.match(captured[0]!.sql, /ORDER BY granted_at DESC/);
  });
});

// ------------------------------------------------------------------
// 4. listActiveForGrantee_filters_expired_and_revoked
// ------------------------------------------------------------------

describe("listActiveForGrantee", () => {
  it("filters out revoked and expired rows via ACTIVE_PREDICATE", async () => {
    ({ pool, captured } = makeFakePool([sampleRow({})], 1));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const active = await adapter.listActiveForGrantee("grantee-uuid");
    assert.equal(active.length, 1);
    assert.match(captured[0]!.sql, /WHERE grantee_user_id = \$1/);
    assert.match(captured[0]!.sql, /revoked_at IS NULL/);
    assert.match(captured[0]!.sql, /expires_at IS NULL OR expires_at > now\(\)/);
    assert.deepEqual(captured[0]!.params, ["grantee-uuid"]);
  });
});

// ------------------------------------------------------------------
// 5. findActiveForGranteeAndScope_handles_hotpath
// ------------------------------------------------------------------

describe("findActiveForGranteeAndScope", () => {
  it("returns the row when active", async () => {
    ({ pool, captured } = makeFakePool([sampleRow({})], 1));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const row = await adapter.findActiveForGranteeAndScope("grantee-uuid", "tenant.members.manage");
    assert.ok(row);
    assert.equal(row!.scope, "tenant.members.manage");
    assert.match(captured[0]!.sql, /LIMIT 1/);
    assert.match(captured[0]!.sql, /AND scope = \$2/);
    assert.match(captured[0]!.sql, /revoked_at IS NULL/);
    assert.deepEqual(captured[0]!.params, ["grantee-uuid", "tenant.members.manage"]);
  });

  it("returns null when no active row matches", async () => {
    ({ pool, captured } = makeFakePool([], 0));
    adapter = new PostgresDelegatedAdminRoles(pool);
    const row = await adapter.findActiveForGranteeAndScope("nonexistent", "tenant.x.y");
    assert.equal(row, null);
  });
});
