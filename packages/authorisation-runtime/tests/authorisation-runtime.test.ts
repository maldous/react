import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDenyAllAuthorisationPort,
  createAllowAllAuthorisationPort,
  DEFAULT_THEME,
  evaluateResourcePolicies,
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

describe("evaluateResourcePolicies", () => {
  it("grants on matching role policy", () => {
    const result = evaluateResourcePolicies(
      [
        {
          name: "allow-admins",
          type: "role",
          config: { roles: ["system_admin"] },
          enabled: true,
        },
      ],
      { actorId: "u1", actorRoles: ["system_admin"] }
    );
    assert.deepEqual(result, { granted: true, matchedPolicy: "allow-admins" });
  });

  it("returns no_matching_policy when nothing matches", () => {
    const result = evaluateResourcePolicies(
      [
        {
          name: "allow-admins",
          type: "role",
          config: { roles: ["system_admin"] },
          enabled: true,
        },
      ],
      { actorId: "u1", actorRoles: ["viewer"] }
    );
    assert.deepEqual(result, { granted: false, reason: "no_matching_policy" });
  });
});
