import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExecutableSchema, executeOperation } from "../src/index.ts";

describe("buildExecutableSchema", () => {
  it("builds a schema from SDL and resolvers", () => {
    const schema = buildExecutableSchema({
      typeDefs: `type Query { ping: String! }`,
      resolvers: { Query: { ping: () => "pong" } },
    });
    assert.ok(schema !== null);
  });
});

describe("executeOperation", () => {
  it("resolves a query", async () => {
    const schema = buildExecutableSchema({
      typeDefs: `type Query { greet(name: String!): String! }`,
      resolvers: {
        Query: { greet: (_: unknown, { name }: { name: string }) => `Hello ${name}` },
      },
    });
    const result = await executeOperation(schema, { query: `{ greet(name: "World") }` });
    assert.strictEqual((result.data as Record<string, string>)?.["greet"], "Hello World");
  });

  it("returns errors for invalid query", async () => {
    const schema = buildExecutableSchema({
      typeDefs: `type Query { ping: String! }`,
      resolvers: { Query: { ping: () => "pong" } },
    });
    const result = await executeOperation(schema, { query: `{ nonExistent }` });
    assert.ok(result.errors && result.errors.length > 0);
  });

  it("supports variables", async () => {
    const schema = buildExecutableSchema({
      typeDefs: `type Query { add(a: Int!, b: Int!): Int! }`,
      resolvers: {
        Query: { add: (_: unknown, { a, b }: { a: number; b: number }) => a + b },
      },
    });
    const result = await executeOperation(schema, {
      query: `query Add($a: Int!, $b: Int!) { add(a: $a, b: $b) }`,
      variables: { a: 3, b: 4 },
    });
    assert.strictEqual((result.data as Record<string, number>)?.["add"], 7);
  });
});
