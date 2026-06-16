import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findMissing, findExtra, decideExit } from "../src/index.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL = path.join(REPO_ROOT, "tools/architecture/validate-openapi-drift/src/index.mjs");

describe("validate-openapi-drift", () => {
  it("exits 0 in report-only mode", () => {
    const result = execFileSync(process.execPath, [TOOL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(result, /\[validate-openapi-drift]/);
  });

  it("reports matching routes for the current repo", () => {
    const r = spawnSync(process.execPath, [TOOL], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `Expected exit 0, got ${r.status}: ${r.stderr}`);
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      combined.includes("match docs/api/openapi.json"),
      `Expected success summary, got: ${combined.slice(0, 200)}`
    );
  });

  it("exits 0 in --strict mode when the repo has no drift", () => {
    const r = spawnSync(process.execPath, [TOOL, "--strict"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `Expected exit 0 for a clean repo, got ${r.status}: ${r.stderr}`);
  });
});

describe("validate-openapi-drift — drift detection", () => {
  const definedPaths = new Map([
    ["/healthz", { get: {} }],
    ["/api/widgets", { get: {}, post: {} }],
    ["/api/legacy", { get: {} }],
  ]);

  it("findMissing flags a code route absent from the spec", () => {
    const routes = [
      { method: "get", path: "/healthz" },
      { method: "delete", path: "/api/widgets" }, // method not in spec
      { method: "get", path: "/api/new" }, // path not in spec
    ];
    const missing = findMissing(routes, definedPaths);
    assert.deepEqual(missing.map((r) => `${r.method} ${r.path}`).sort(), [
      "delete /api/widgets",
      "get /api/new",
    ]);
  });

  it("findExtra flags a documented route with no code route", () => {
    const routes = [
      { method: "get", path: "/healthz" },
      { method: "get", path: "/api/widgets" },
      { method: "post", path: "/api/widgets" },
    ];
    const extra = findExtra(routes, definedPaths);
    assert.deepEqual(
      extra.map((r) => `${r.method} ${r.path}`),
      ["get /api/legacy"]
    );
  });

  it("decideExit returns 1 under --strict when drift exists, 0 otherwise", () => {
    const clean = { missing: [], extra: [] };
    const drifted = { missing: [{ method: "get", path: "/x" }], extra: [] };
    assert.equal(decideExit(clean, true), 0);
    assert.equal(decideExit(clean, false), 0);
    assert.equal(decideExit(drifted, false), 0, "report-only never fails");
    assert.equal(decideExit(drifted, true), 1, "strict fails on drift");
  });
});
