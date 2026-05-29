import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDenyAllAuthorisationPort,
  createAllowAllAuthorisationPort,
  DEFAULT_THEME,
} from "../src/index.ts";

describe("createDenyAllAuthorisationPort", () => {
  it("always returns granted=false", async () => {
    const port = createDenyAllAuthorisationPort();
    const result = await port.checkAccess({ name: "org:profile", scope: "write" }, "any-token");
    assert.strictEqual(result.granted, false);
    if (!result.granted) assert.strictEqual(result.reason, "policy_denied");
  });
});

describe("createAllowAllAuthorisationPort", () => {
  it("always returns granted=true with rpt", async () => {
    const port = createAllowAllAuthorisationPort();
    const result = await port.checkAccess({ name: "admin:sonar", scope: "read" }, "tok");
    assert.strictEqual(result.granted, true);
    if (result.granted) assert.ok(typeof result.rpt === "string");
  });
});

describe("DEFAULT_THEME", () => {
  it("has required fields", () => {
    assert.ok(typeof DEFAULT_THEME.displayName === "string");
    assert.ok(typeof DEFAULT_THEME.primaryColour === "string");
  });
});
