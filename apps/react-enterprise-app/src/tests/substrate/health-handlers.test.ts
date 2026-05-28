import { describe, it, expect } from "vitest";
import { getHealth, getVersion } from "../../server/health";

describe("health handlers", () => {
  it("getHealth returns status ok", () => {
    const res = getHealth();
    expect(res.status).toBe("ok");
  });

  it("getVersion returns an object with version field", () => {
    const res = getVersion();
    expect(typeof res.version).toBe("string");
    expect(typeof res.environment).toBe("string");
  });
});
