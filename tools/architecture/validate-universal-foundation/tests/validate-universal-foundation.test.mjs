import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, validate, renderTables, validateDelivery } from "../src/index.mjs";

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

  it("exposes warnings (Proposed-ADR maturity report) without failing", () => {
    const result = validate(REPO_ROOT);
    assert.ok(Array.isArray(result.warnings), "warnings is an array");
    assert.equal(result.ok, true, "warnings never flip ok to false");
  });

  it("delivery spine covers every capability with a phase + dependency row", () => {
    const reg = loadRegistry(REPO_ROOT);
    const keys = new Set(reg.capabilities.map((c) => c.capability));
    const problems = validateDelivery(reg.delivery, keys);
    assert.deepEqual(problems, [], `delivery problems:\n${problems.join("\n")}`);
  });
});

describe("validateDelivery (pure) catches broken delivery graphs", () => {
  const keys = new Set(["a", "b", "c"]);
  const base = {
    phaseOrder: ["phase-0", "phase-1"],
    requiredDependencyTruths: [{ from: "b", dependsOn: "a", truth: "a precedes b" }],
    requiredUiPrecedence: [],
    dependencies: [
      { capability: "a", phase: "phase-0", dependsOn: [], parallelWith: [], mustPrecedeUi: false },
      {
        capability: "b",
        phase: "phase-1",
        dependsOn: ["a"],
        parallelWith: [],
        mustPrecedeUi: false,
      },
      {
        capability: "c",
        phase: "phase-1",
        dependsOn: ["b"],
        parallelWith: [],
        mustPrecedeUi: false,
      },
    ],
  };

  it("accepts a well-formed graph", () => {
    assert.deepEqual(validateDelivery(base, keys), []);
  });

  it("detects missing coverage", () => {
    const broken = { ...base, dependencies: base.dependencies.slice(0, 2) };
    assert.ok(validateDelivery(broken, keys).some((p) => /capability c has no/.test(p)));
  });

  it("detects an unknown dependency reference", () => {
    const broken = {
      ...base,
      dependencies: base.dependencies.map((r) =>
        r.capability === "c" ? { ...r, dependsOn: ["nope"] } : r
      ),
    };
    assert.ok(
      validateDelivery(broken, keys).some((p) => /dependsOn unknown capability nope/.test(p))
    );
  });

  it("detects a dependency cycle", () => {
    const broken = {
      ...base,
      dependencies: base.dependencies.map((r) =>
        r.capability === "a" ? { ...r, dependsOn: ["c"] } : r
      ),
    };
    assert.ok(validateDelivery(broken, keys).some((p) => /dependency cycle/.test(p)));
  });

  it("detects an unknown phase", () => {
    const broken = {
      ...base,
      dependencies: base.dependencies.map((r) =>
        r.capability === "c" ? { ...r, phase: "phase-99" } : r
      ),
    };
    assert.ok(validateDelivery(broken, keys).some((p) => /phase "phase-99"/.test(p)));
  });

  it("detects a violated required-dependency truth (even transitively)", () => {
    const broken = {
      ...base,
      dependencies: base.dependencies.map((r) =>
        r.capability === "b" ? { ...r, dependsOn: [] } : r
      ),
    };
    assert.ok(
      validateDelivery(broken, keys).some((p) => /required dependency truth violated/.test(p))
    );
  });
});
