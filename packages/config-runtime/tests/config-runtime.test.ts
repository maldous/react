import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadConfig,
  getEnv,
  getEnvRequired,
  getEnvInt,
  getEnvBool,
  ConfigError,
} from "../src/index.ts";

describe("getEnv", () => {
  it("returns the env var value", () => {
    process.env["TEST_CFG_VAR"] = "hello";
    assert.strictEqual(getEnv("TEST_CFG_VAR"), "hello");
    delete process.env["TEST_CFG_VAR"];
  });
  it("returns the default when var is absent", () => {
    delete process.env["MISSING_CFG_VAR"];
    assert.strictEqual(getEnv("MISSING_CFG_VAR", "default"), "default");
  });
  it("returns undefined when absent with no default", () => {
    delete process.env["MISSING_CFG_VAR"];
    assert.strictEqual(getEnv("MISSING_CFG_VAR"), undefined);
  });
});

describe("getEnvRequired", () => {
  it("returns the value when present", () => {
    process.env["REQUIRED_CFG_VAR"] = "value";
    assert.strictEqual(getEnvRequired("REQUIRED_CFG_VAR"), "value");
    delete process.env["REQUIRED_CFG_VAR"];
  });
  it("throws ConfigError when absent", () => {
    delete process.env["REQUIRED_CFG_VAR"];
    assert.throws(() => getEnvRequired("REQUIRED_CFG_VAR"), ConfigError);
  });
});

describe("getEnvInt", () => {
  it("parses integer", () => {
    process.env["INT_VAR"] = "42";
    assert.strictEqual(getEnvInt("INT_VAR"), 42);
    delete process.env["INT_VAR"];
  });
  it("returns default when absent", () => {
    delete process.env["INT_VAR"];
    assert.strictEqual(getEnvInt("INT_VAR", 99), 99);
  });
  it("throws on non-integer", () => {
    process.env["INT_VAR"] = "abc";
    assert.throws(() => getEnvInt("INT_VAR"), ConfigError);
    delete process.env["INT_VAR"];
  });
});

describe("getEnvBool", () => {
  it("parses true", () => {
    process.env["BOOL_VAR"] = "true";
    assert.strictEqual(getEnvBool("BOOL_VAR"), true);
    delete process.env["BOOL_VAR"];
  });
  it("parses 0 as false", () => {
    process.env["BOOL_VAR"] = "0";
    assert.strictEqual(getEnvBool("BOOL_VAR"), false);
    delete process.env["BOOL_VAR"];
  });
  it("throws on invalid value", () => {
    process.env["BOOL_VAR"] = "maybe";
    assert.throws(() => getEnvBool("BOOL_VAR"), ConfigError);
    delete process.env["BOOL_VAR"];
  });
});

describe("loadConfig", () => {
  it("loads and returns typed config", () => {
    process.env["CFG_PORT"] = "8080";
    process.env["CFG_DB_URL"] = "postgres://localhost/test";
    const config = loadConfig({
      port: { key: "CFG_PORT", type: "number", default: 3000 },
      dbUrl: { key: "CFG_DB_URL", type: "string" },
    });
    assert.strictEqual(config.port, 8080);
    assert.strictEqual(config.dbUrl, "postgres://localhost/test");
    delete process.env["CFG_PORT"];
    delete process.env["CFG_DB_URL"];
  });
  it("uses defaults when vars absent", () => {
    delete process.env["CFG_PORT"];
    const config = loadConfig({ port: { key: "CFG_PORT", type: "number", default: 3000 } });
    assert.strictEqual(config.port, 3000);
  });
  it("throws ConfigError when required var is missing", () => {
    delete process.env["CFG_DB_URL"];
    assert.throws(() => loadConfig({ dbUrl: { key: "CFG_DB_URL", type: "string" } }), ConfigError);
  });
  it("loads boolean config", () => {
    process.env["CFG_ENABLED"] = "true";
    const config = loadConfig({ enabled: { key: "CFG_ENABLED", type: "boolean", default: false } });
    assert.strictEqual(config.enabled, true);
    delete process.env["CFG_ENABLED"];
  });
});
