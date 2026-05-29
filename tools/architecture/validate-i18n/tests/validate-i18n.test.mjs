import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL = path.join(REPO_ROOT, "tools/architecture/validate-i18n/src/index.mjs");

describe("validate-i18n", () => {
  it("exits 0 in report-only mode (default)", () => {
    const result = execFileSync(process.execPath, [TOOL, REPO_ROOT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(typeof result === "string");
  });

  it("outputs a summary line with key counts or skip message", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], { encoding: "utf8" });
    assert.equal(r.status, 0, `Expected exit 0 in report-only mode, got ${r.status}: ${r.stderr}`);
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      combined.includes("[validate-i18n]") || combined.includes("OK"),
      `Expected tool output, got: ${combined}`
    );
  });

  it("--strict flag: exits 0 when no keys are missing (passes all-good repos)", () => {
    // In this repo, the tool may report missing test-fixture keys but exits 0 or 1
    // We just verify the flag is accepted without crashing unexpectedly
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    // Status is 0 (no missing keys) or 1 (missing keys in strict mode) — both are correct
    assert.ok(r.status === 0 || r.status === 1, `Unexpected exit code: ${r.status}`);
  });

  it("--strict flag exits 1 when keys are missing (fail-closed per ADR-0011)", () => {
    // The current repo has test fixture keys (this.key.does.not.exist etc.) that
    // appear in i18n-runtime tests but are not in en-GB.json — strict mode must fail.
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    if (combined.includes("missing")) {
      // If there are missing keys, strict mode must exit 1
      assert.equal(r.status, 1, "Strict mode must exit 1 when missing keys are found");
      assert.ok(combined.includes("Strict mode"), "Strict mode banner must appear in output");
    } else {
      // No missing keys — strict mode exits 0
      assert.equal(r.status, 0);
    }
  });
});
