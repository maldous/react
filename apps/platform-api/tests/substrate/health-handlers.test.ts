import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getHealth, getVersion } from "../../src/server/health.ts";

describe("health handlers", () => {
  it("getHealth returns status ok", () => {
    const res = getHealth();
    assert.equal(res.status, "ok");
  });

  it("getVersion returns an object with version field", () => {
    const res = getVersion();
    assert.equal(typeof res.version, "string");
    assert.equal(typeof res.environment, "string");
  });
});
