import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { print, parse, validate, buildSchema } from "graphql";
import {
  BASE_SCHEMA_SDL,
  buildBaseTypeDefs,
  OrganisationProfileDocument,
  UpdateOrganisationProfileDocument,
} from "../src/index.ts";

describe("BASE_SCHEMA_SDL", () => {
  it("is a non-empty string", () => {
    assert.ok(typeof BASE_SCHEMA_SDL === "string" && BASE_SCHEMA_SDL.length > 0);
  });
  it("contains Query type", () => {
    assert.ok(BASE_SCHEMA_SDL.includes("type Query"));
  });
  it("contains Organisation type", () => {
    assert.ok(BASE_SCHEMA_SDL.includes("type Organisation"));
  });
  it("contains Mutation type", () => {
    assert.ok(BASE_SCHEMA_SDL.includes("type Mutation"));
  });
});

describe("buildBaseTypeDefs", () => {
  it("returns the SDL string", () => {
    const typeDefs = buildBaseTypeDefs();
    assert.ok(typeDefs.includes("type Query"));
    assert.strictEqual(typeDefs, BASE_SCHEMA_SDL);
  });
});

// ADR-ACT-0203: the generated TypedDocumentNode artifacts are the single source
// of client-facing operations. These tests guard the codegen output contract so
// a stale or hand-edited generated file fails the architecture gate.
describe("generated operation documents", () => {
  const schema = buildSchema(BASE_SCHEMA_SDL);

  it("OrganisationProfileDocument is a named query document", () => {
    assert.strictEqual(OrganisationProfileDocument.kind, "Document");
    const printed = print(OrganisationProfileDocument);
    assert.match(printed, /query OrganisationProfile/);
    assert.match(printed, /organisationProfile/);
  });

  it("UpdateOrganisationProfileDocument is a named mutation with a displayName variable", () => {
    const printed = print(UpdateOrganisationProfileDocument);
    assert.match(printed, /mutation UpdateOrganisationProfile\(\$displayName: String!\)/);
    assert.match(printed, /updateOrganisationProfile/);
  });

  it("every generated operation validates against BASE_SCHEMA_SDL (no drift)", () => {
    for (const doc of [OrganisationProfileDocument, UpdateOrganisationProfileDocument]) {
      const errors = validate(schema, parse(print(doc)));
      assert.deepStrictEqual(
        errors.map((e) => e.message),
        [],
        `operation must validate against the schema: ${print(doc)}`
      );
    }
  });
});
