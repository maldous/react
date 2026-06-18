/**
 * Test-env preload contract (ADR-ACT-0290).
 *
 * Two preloads with distinct jobs:
 *   - preload-unit-env.mjs  → pure unit + architecture suites. HERMETIC: reads no
 *     files, sets only fixed fake values, never overrides explicit env.
 *   - preload-env.mjs       → integration / runtime-proof suites. Loads the managed
 *     .env/<stage>.env so DB/service tests get real credentials.
 *
 * These tests prove the four required behaviours:
 *   1. pure unit tests run with NO generated env files (fixed fakes, never file reads);
 *   2. explicit process env overrides remain authoritative;
 *   3. integration tests CAN load the intended stage environment;
 *   4. the hermetic preload never leaks the developer's on-disk secret values.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyUnitEnv, FIXED_TEST_ENV } from "../lib/preload-unit-env.mjs";

const unitPreloadUrl = new URL("../lib/preload-unit-env.mjs", import.meta.url);
const managedPreloadUrl = new URL("../lib/preload-env.mjs", import.meta.url);

describe("preload-unit-env (hermetic pure-unit env)", () => {
  it("fills a fixed fake value for a missing key, but never overrides an explicit one", () => {
    // Operate on a throwaway env object — no process.env mutation, no dynamic import.
    const env: NodeJS.ProcessEnv = {
      POSTGRES_URL: "postgresql://explicit:explicit@host/db",
      // TENANT_SECRET_ENCRYPTION_KEY intentionally absent → should be filled.
    };
    applyUnitEnv(env);
    // (2) explicit value preserved.
    assert.equal(env["POSTGRES_URL"], "postgresql://explicit:explicit@host/db");
    // (1)/(4) missing key filled with the FIXED fake — NOT whatever .env/test.env holds,
    // proving the preload depends on no file (the on-disk key is a real 64-hex, not all-'a').
    assert.equal(env["TENANT_SECRET_ENCRYPTION_KEY"], "a".repeat(64));
    assert.equal(FIXED_TEST_ENV.TENANT_SECRET_ENCRYPTION_KEY, "a".repeat(64));
  });

  it("reads no files (no fs import) — it cannot depend on the developer's .env", () => {
    const src = readFileSync(fileURLToPath(unitPreloadUrl), "utf8");
    assert.ok(!/from "node:fs"|require\(["']node:fs/.test(src), "unit preload must not import fs");
    assert.ok(!/readFileSync|statSync/.test(src), "unit preload must not read files");
  });
});

describe("preload-env (managed integration env)", () => {
  it("does load files (the managed stage env) for integration suites", () => {
    const src = readFileSync(fileURLToPath(managedPreloadUrl), "utf8");
    assert.ok(/readFileSync/.test(src), "managed preload must read the stage env file");
    // (2) it also guards on undefined, so an explicit override stays authoritative.
    assert.ok(/process\.env\[[^\]]+\] === undefined/.test(src), "must not override explicit env");
  });
});

describe("the pure suite is wired to the hermetic preload (no generated secrets)", () => {
  const pkgUrl = new URL("../../../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("test:platform-api:unit-safe uses the hermetic preload-unit-env, never the managed loader", () => {
    const suite = pkg.scripts["test:platform-api:unit-safe"];
    assert.ok(suite.includes("preload-unit-env.mjs"), "unit-safe must use the hermetic preload");
    assert.ok(
      !suite.includes("lib/preload-env.mjs"),
      "unit-safe must NOT load the managed preload-env (would read generated secrets)"
    );
  });

  it("mixed/integration suites keep the managed loader (they contain substrate DB tests)", () => {
    // test:architecture and test:coverage bundle substrate DB + runtime-proof tests
    // that genuinely require the managed stage credentials, so they keep preload-env.
    for (const suite of ["test:architecture", "test:platform-api", "test:coverage"]) {
      assert.ok(
        pkg.scripts[suite].includes("lib/preload-env.mjs"),
        `${suite} must keep the managed preload-env for integration credentials`
      );
    }
  });
});
