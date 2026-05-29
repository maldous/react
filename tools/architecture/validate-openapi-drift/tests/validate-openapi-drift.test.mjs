import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
});
