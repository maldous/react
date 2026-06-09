import { describe, it, expect } from "vitest";
import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { createGraphQLClient, GraphQLClientError } from "../src/index.ts";

// A minimal, valid operation AST built by hand so this transport test imports
// neither `graphql` nor any @platform package (keeps the package dependency-free
// and honours its own import-boundary rule). `print()` only needs a valid AST.
const TestQueryDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TestQuery" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [{ kind: "Field", name: { kind: "Name", value: "thing" } }],
      },
    },
  ],
} as unknown as TypedDocumentNode<{ thing: string }, Record<string, never>>;

const TestMutationDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "TestMutation" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "name" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [{ kind: "Field", name: { kind: "Name", value: "thing" } }],
      },
    },
  ],
} as unknown as TypedDocumentNode<{ thing: string }, { name: string }>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createGraphQLClient", () => {
  it("prints the document to a query string and POSTs it to the endpoint", async () => {
    let captured: { url?: string; body?: { query?: string; variables?: unknown } } = {};
    const client = createGraphQLClient({
      endpoint: "/api/graphql",
      fetchImpl: async (url, init) => {
        captured = {
          url: String(url),
          body: JSON.parse(String(init?.body)),
        };
        return jsonResponse({ data: { thing: "ok" } });
      },
    });

    const data = await client.request(TestQueryDocument);

    expect(data).toEqual({ thing: "ok" });
    expect(captured.url).toBe("/api/graphql");
    expect(captured.body?.query).toContain("query TestQuery");
    expect(captured.body?.query).toContain("thing");
  });

  it("sends typed variables on the request body", async () => {
    let captured: { variables?: unknown } = {};
    const client = createGraphQLClient({
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        return jsonResponse({ data: { thing: "ok" } });
      },
    });

    await client.request(TestMutationDocument, { name: "Acme" });

    expect(captured.variables).toEqual({ name: "Acme" });
  });

  it("throws GraphQLClientError with code+status on a 403 transport failure", async () => {
    const client = createGraphQLClient({
      fetchImpl: async () => jsonResponse({ code: "FORBIDDEN", message: "nope" }, 403),
    });

    await expect(client.request(TestQueryDocument)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("throws with code UNAUTHORIZED on a 401", async () => {
    const client = createGraphQLClient({
      fetchImpl: async () => jsonResponse({ code: "UNAUTHORIZED", message: "sign in" }, 401),
    });

    const err = await client.request(TestQueryDocument).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphQLClientError);
    expect((err as GraphQLClientError).status).toBe(401);
    expect((err as GraphQLClientError).code).toBe("UNAUTHORIZED");
  });

  it("throws when the response carries GraphQL errors (200 + errors[])", async () => {
    const client = createGraphQLClient({
      fetchImpl: async () =>
        jsonResponse({ errors: [{ message: "Display name must be at least 2 characters" }] }),
    });

    await expect(client.request(TestMutationDocument, { name: "x" })).rejects.toThrow(
      /at least 2 characters/
    );
  });

  it("throws MALFORMED_RESPONSE when data is null and there are no errors", async () => {
    const client = createGraphQLClient({
      fetchImpl: async () => jsonResponse({ data: null }),
    });

    await expect(client.request(TestQueryDocument)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("maps a network failure to a NETWORK_ERROR with status 0", async () => {
    const client = createGraphQLClient({
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.request(TestQueryDocument)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
  });
});
