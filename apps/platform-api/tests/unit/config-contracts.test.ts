/**
 * Unit tests for the config registry value validation (ADR-0039), in
 * @platform/contracts-admin. Pure — covers each value type + enum bounds.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfigValue,
  CONFIG_VALUE_TYPES,
  CONFIG_CATEGORIES,
} from "@platform/contracts-admin";

describe("validateConfigValue", () => {
  it("boolean accepts only booleans", () => {
    assert.deepEqual(validateConfigValue({ valueType: "boolean", value: true }), []);
    assert.ok(validateConfigValue({ valueType: "boolean", value: "true" }).length > 0);
  });
  it("string accepts only strings", () => {
    assert.deepEqual(validateConfigValue({ valueType: "string", value: "x" }), []);
    assert.ok(validateConfigValue({ valueType: "string", value: 1 }).length > 0);
  });
  it("number accepts finite numbers, rejects NaN/non-numbers", () => {
    assert.deepEqual(validateConfigValue({ valueType: "number", value: 5 }), []);
    assert.ok(validateConfigValue({ valueType: "number", value: Number.NaN }).length > 0);
    assert.ok(validateConfigValue({ valueType: "number", value: "5" }).length > 0);
  });
  it("enum enforces allowedValues", () => {
    const allowed = ["light", "dark"];
    assert.deepEqual(
      validateConfigValue({ valueType: "enum", allowedValues: allowed, value: "dark" }),
      []
    );
    assert.ok(
      validateConfigValue({ valueType: "enum", allowedValues: allowed, value: "blue" }).length > 0
    );
    assert.ok(
      validateConfigValue({ valueType: "enum", allowedValues: null, value: "dark" }).length > 0
    );
  });
  it("json accepts serialisable values, rejects undefined", () => {
    assert.deepEqual(validateConfigValue({ valueType: "json", value: { a: 1 } }), []);
    assert.ok(validateConfigValue({ valueType: "json", value: undefined }).length > 0);
  });
  it("the literal sets are stable", () => {
    assert.equal(CONFIG_VALUE_TYPES.length, 5);
    assert.ok(CONFIG_CATEGORIES.includes("features"));
  });
});
