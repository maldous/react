import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPlatformGraphQLSchema, GraphQLAdapter } from "../src/index.ts";

describe("createPlatformGraphQLSchema", () => {
  it("builds the platform schema without error", () => {
    const schema = createPlatformGraphQLSchema({
      Query: { health: () => ({ status: "ok" }) },
      Mutation: {},
    });
    assert.ok(schema !== null);
  });
});

describe("GraphQLAdapter", () => {
  it("executes a health query", async () => {
    const adapter = new GraphQLAdapter({
      Query: { health: () => ({ status: "ok" }), organisation: () => null },
      Mutation: { updateOrganisationDisplayName: () => null },
    });
    const result = await adapter.execute({ query: "{ health { status } }" });
    assert.strictEqual(
      (result.data as Record<string, { status: string }>)?.["health"]?.status,
      "ok"
    );
  });

  it("returns errors for unknown fields", async () => {
    const adapter = new GraphQLAdapter({
      Query: { health: () => ({ status: "ok" }), organisation: () => null },
      Mutation: {},
    });
    const result = await adapter.execute({ query: "{ nonExistent }" });
    assert.ok(result.errors && result.errors.length > 0);
  });
});
