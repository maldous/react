import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRbacPolicy,
  createAllowAllPolicy,
  createDenyAllPolicy,
  combineAny,
  combineAll,
} from "../src/index.ts";

const ROLE_MAP = {
  admin: ["read", "write", "delete"],
  editor: ["read", "write"],
  viewer: ["read"],
};

describe("createRbacPolicy", () => {
  const policy = createRbacPolicy(ROLE_MAP);

  it("allows a permitted action for role", () => {
    assert.ok(policy.can({ roles: ["editor"] }, "write"));
  });
  it("denies an action not in role permissions", () => {
    assert.ok(!policy.can({ roles: ["viewer"] }, "write"));
  });
  it("allows when actor has any matching role", () => {
    assert.ok(policy.can({ roles: ["viewer", "admin"] }, "delete"));
  });
  it("denies actor with no matching roles", () => {
    assert.ok(!policy.can({ roles: ["unknown"] }, "read"));
  });
  it("denies actor with empty roles", () => {
    assert.ok(!policy.can({ roles: [] }, "read"));
  });
});

describe("createAllowAllPolicy", () => {
  it("always returns true", () => {
    const policy = createAllowAllPolicy();
    assert.ok(policy.can({ roles: [] }, "anything"));
  });
});

describe("createDenyAllPolicy", () => {
  it("always returns false", () => {
    const policy = createDenyAllPolicy();
    assert.ok(!policy.can({ roles: ["admin"] }, "read"));
  });
});

describe("combineAny", () => {
  it("allows when at least one policy allows", () => {
    const combined = combineAny(createDenyAllPolicy(), createAllowAllPolicy());
    assert.ok(combined.can({ roles: [] }, "action"));
  });
  it("denies when all policies deny", () => {
    const combined = combineAny(createDenyAllPolicy(), createDenyAllPolicy());
    assert.ok(!combined.can({ roles: [] }, "action"));
  });
});

describe("combineAll", () => {
  it("allows only when all policies allow", () => {
    const combined = combineAll(createAllowAllPolicy(), createAllowAllPolicy());
    assert.ok(combined.can({ roles: [] }, "action"));
  });
  it("denies when any policy denies", () => {
    const combined = combineAll(createAllowAllPolicy(), createDenyAllPolicy());
    assert.ok(!combined.can({ roles: [] }, "action"));
  });
});
