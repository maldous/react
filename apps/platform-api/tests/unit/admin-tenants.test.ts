import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookupTenants } from "../../src/usecases/admin-tenants.ts";

function fakePool(rows: { id: string; slug: string; display_name: string }[]) {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows };
    },
  };
}

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  slug: `org-${n}`,
  display_name: `Org ${n}`,
});

describe("admin tenant lookup", () => {
  it("maps rows to id/slug/displayName and reports not truncated under the cap", async () => {
    const pool = fakePool([row(1), row(2)]);
    const res = await lookupTenants(pool, undefined);
    assert.equal(res.truncated, false);
    assert.deepEqual(res.tenants, [
      { id: row(1).id, slug: "org-1", displayName: "Org 1" },
      { id: row(2).id, slug: "org-2", displayName: "Org 2" },
    ]);
  });

  it("flags truncation and caps at 50 when more than 50 rows return", async () => {
    const pool = fakePool(Array.from({ length: 51 }, (_, i) => row(i + 1)));
    const res = await lookupTenants(pool, undefined);
    assert.equal(res.truncated, true);
    assert.equal(res.tenants.length, 50);
  });

  it("passes a wildcarded ILIKE parameter when a query is supplied", async () => {
    const pool = fakePool([row(1)]);
    await lookupTenants(pool, "acme");
    assert.match(pool.calls[0]!.text, /ILIKE/i);
    assert.deepEqual(pool.calls[0]!.values, ["%acme%"]);
  });

  it("uses no parameters and lists when the query is empty", async () => {
    const pool = fakePool([row(1)]);
    await lookupTenants(pool, "   ");
    assert.equal(pool.calls[0]!.values, undefined);
  });
});
