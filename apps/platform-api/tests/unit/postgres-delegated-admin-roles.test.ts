// Substrate tests: PostgresDelegatedAdminRoles adapter (ADR-0063 / V1C-04).
//
// Re-authored for node:test with a faithful fake pool. The prior file had two
// structural gaps now fixed here:
//   (a) the fake client implements escapeIdentifier (withTenant calls
//       tenantSchemaIdentifier → client.escapeIdentifier);
//   (b) capture indices are wrapper-aware, not a naive [0]=BEGIN shift:
//         withSystemAdmin emits [BEGIN, SET LOCAL ROLE rls_bypass, <SQL>, COMMIT]
//           → business SQL at index 2
//         withTenant emits [BEGIN, SET LOCAL search_path…, SELECT set_config…, <SQL>, COMMIT]
//           → business SQL at index 3
//
// Asserts each of the 5 port methods runs under the correct auth wrapper, the
// active-row predicate is applied on the read paths, soft-delete revoke maps
// rowCount→boolean, and toRecord maps snake_case rows (incl. revoked_by TEXT).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PostgresDelegatedAdminRoles } from "../../src/adapters/postgres-delegated-admin-roles.ts";
import type { GrantDelegationInput } from "../../src/ports/delegated-admin-roles.ts";

interface Captured {
  text: string;
  params: unknown[] | undefined;
}

// A fake pg client/pool that records every statement and returns canned results
// keyed off the statement text. release() is a no-op (single shared client).
function fakePool(
  opts: {
    selectRows?: Record<string, unknown>[];
    insertRow?: Record<string, unknown>;
    updateRowCount?: number;
  } = {}
) {
  const captured: Captured[] = [];
  const client = {
    escapeIdentifier(name: string): string {
      return `"${name.replaceAll('"', '""')}"`;
    },
    async query(text: string, params?: unknown[]) {
      captured.push({ text, params });
      const t = text.trimStart();
      if (t.startsWith("INSERT"))
        return { rows: opts.insertRow ? [opts.insertRow] : [], rowCount: 1 };
      if (t.startsWith("UPDATE")) return { rows: [], rowCount: opts.updateRowCount ?? 0 };
      if (t.startsWith("SELECT id"))
        return { rows: opts.selectRows ?? [], rowCount: (opts.selectRows ?? []).length };
      return { rows: [], rowCount: 0 }; // BEGIN/COMMIT/SET LOCAL/SELECT set_config
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  return { pool, captured };
}

const ORG = "11111111-1111-4111-8111-111111111111";

function dbRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "del-1",
    organisation_id: ORG,
    granter_user_id: "op-1",
    grantee_user_id: "grantee-1",
    scope: "tenant.members.manage",
    granted_at: new Date("2026-01-01T00:00:00.000Z"),
    granted_by: "op-1",
    expires_at: null,
    revoked_at: null,
    revoked_by: null,
    ...over,
  };
}

const grantInput = (over: Partial<GrantDelegationInput> = {}): GrantDelegationInput => ({
  organisationId: ORG,
  granterUserId: "op-1",
  granteeUserId: "grantee-1",
  grantedBy: "op-1",
  scope: "tenant.members.manage",
  expiresAt: null,
  ...over,
});

describe("PostgresDelegatedAdminRoles (V1C-04) — grant", () => {
  it("runs the INSERT under withSystemAdmin and maps the returned row", async () => {
    const { pool, captured } = fakePool({ insertRow: dbRow() });
    const out = await new PostgresDelegatedAdminRoles(pool as never).grantDelegation(grantInput());
    // withSystemAdmin wrapper: BEGIN, SET LOCAL ROLE rls_bypass, INSERT, COMMIT
    assert.equal(captured[0]!.text, "BEGIN");
    assert.equal(captured[1]!.text, "SET LOCAL ROLE rls_bypass");
    assert.match(captured[2]!.text, /^INSERT INTO public\.delegated_admin_roles/);
    assert.equal(captured[3]!.text, "COMMIT");
    assert.equal(out.id, "del-1");
    assert.equal(out.organisationId, ORG);
    assert.equal(out.revokedBy, null);
  });
});

describe("PostgresDelegatedAdminRoles (V1C-04) — revoke", () => {
  it("maps rowCount>0 → true (a row was soft-deleted)", async () => {
    const { pool, captured } = fakePool({ updateRowCount: 1 });
    const ok = await new PostgresDelegatedAdminRoles(pool as never).revokeDelegation(
      "del-1",
      "op-1"
    );
    assert.equal(ok, true);
    assert.match(captured[2]!.text, /UPDATE public\.delegated_admin_roles/);
    assert.match(captured[2]!.text, /revoked_at IS NULL/, "must only revoke still-active rows");
  });

  it("maps rowCount 0 → false (already revoked / unknown id)", async () => {
    const { pool } = fakePool({ updateRowCount: 0 });
    const ok = await new PostgresDelegatedAdminRoles(pool as never).revokeDelegation(
      "nope",
      "op-1"
    );
    assert.equal(ok, false);
  });
});

describe("PostgresDelegatedAdminRoles (V1C-04) — listForTenant", () => {
  it("runs the SELECT under withTenant (SQL at capture index 3, escapeIdentifier used)", async () => {
    const { pool, captured } = fakePool({ selectRows: [dbRow(), dbRow({ id: "del-2" })] });
    const rows = await new PostgresDelegatedAdminRoles(pool as never).listForTenant(ORG);
    assert.equal(captured[0]!.text, "BEGIN");
    assert.match(captured[1]!.text, /^SET LOCAL search_path = "tenant_/);
    assert.match(captured[2]!.text, /set_config\('app\.current_tenant_id'/);
    assert.match(captured[3]!.text, /SELECT id[\s\S]*FROM public\.delegated_admin_roles/);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]!.id, "del-2");
  });
});

describe("PostgresDelegatedAdminRoles (V1C-04) — active-only reads", () => {
  it("listActiveForGrantee filters on the active predicate under withSystemAdmin", async () => {
    const { pool, captured } = fakePool({ selectRows: [dbRow()] });
    const rows = await new PostgresDelegatedAdminRoles(pool as never).listActiveForGrantee(
      "grantee-1"
    );
    assert.equal(captured[1]!.text, "SET LOCAL ROLE rls_bypass");
    assert.match(
      captured[2]!.text,
      /revoked_at IS NULL AND \(expires_at IS NULL OR expires_at > now\(\)\)/
    );
    assert.equal(rows.length, 1);
  });

  it("findActiveForGranteeAndScope returns a record or null", async () => {
    const hit = fakePool({ selectRows: [dbRow()] });
    const found = await new PostgresDelegatedAdminRoles(
      hit.pool as never
    ).findActiveForGranteeAndScope("grantee-1", "tenant.members.manage");
    assert.equal(found?.id, "del-1");
    assert.match(hit.captured[2]!.text, /LIMIT 1/);

    const miss = fakePool({ selectRows: [] });
    const none = await new PostgresDelegatedAdminRoles(
      miss.pool as never
    ).findActiveForGranteeAndScope("grantee-x", "tenant.members.manage");
    assert.equal(none, null);
  });
});
