import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PostgresOrganisationRepository, PostgresReadinessAdapter } from "../src/index.ts";

function makeFakePool(rows: Record<string, unknown>[]) {
  return {
    query: async () => ({ rows }),
    connect: async () => ({
      query: async () => ({ rows }),
      release: () => {},
    }),
  };
}

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

describe("PostgresReadinessAdapter", () => {
  it("constructs without error", () => {
    const adapter = new PostgresReadinessAdapter("postgresql://localhost/test");
    assert.ok(adapter !== null);
  });
});
