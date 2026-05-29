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

  it("outputs a summary line with [validate-i18n] marker", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], { encoding: "utf8" });
    assert.equal(r.status, 0, `Expected exit 0 in report-only mode, got ${r.status}: ${r.stderr}`);
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      combined.includes("[validate-i18n]"),
      `Expected [validate-i18n] marker, got: ${combined.slice(0, 200)}`
    );
  });

  it("correctly reads nested en-GB.json (no 'not found' warning)", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      !combined.includes("not found"),
      `en-GB.json should be found and parsed; got: ${combined.slice(0, 200)}`
    );
  });

  it("--strict flag: accepted without crashing", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1, `Unexpected exit code: ${r.status}`);
  });

  it("--strict flag exits 1 when missing keys found, with Strict mode banner", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    if (combined.includes("missing from")) {
      assert.equal(r.status, 1, "Strict mode must exit 1 when missing keys are found");
      assert.ok(combined.includes("Strict mode"), "Strict mode banner must appear");
    } else {
      assert.equal(r.status, 0);
    }
  });
});
