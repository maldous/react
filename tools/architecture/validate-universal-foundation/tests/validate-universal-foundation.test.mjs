import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, validate, renderTables } from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("universal-service-foundation registry", () => {
  it("loads and has capability rows across every declared domain", () => {
    const reg = loadRegistry(REPO_ROOT);
    assert.ok(reg.capabilities.length >= 40, "expected a substantial set of capabilities");
    const domainsUsed = new Set(reg.capabilities.map((c) => c.domain));
    for (const d of reg.domains) {
      assert.ok(domainsUsed.has(d), `domain "${d}" is declared but has no capability rows`);
    }
  });

  it("passes every Phase-8 invariant (status, decision, env, isolation, local-free, delivered-proof, ADR/ADR-ACT links)", () => {
    const result = validate(REPO_ROOT);
    assert.equal(result.ok, true, `registry/matrix problems:\n${result.problems.join("\n")}`);
  });

  it("renders the matrix tables deterministically without throwing", () => {
    const md = renderTables(REPO_ROOT);
    assert.match(md, /\| Capability \| Status \|/);
    assert.match(md, /\| Capability \| Tenant isolation \|/);
  });
});
