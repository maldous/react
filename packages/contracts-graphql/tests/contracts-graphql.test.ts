import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_SCHEMA_SDL, buildBaseTypeDefs } from "../src/index.ts";

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
