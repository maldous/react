import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL = path.join(REPO_ROOT, "tools/architecture/validate-i18n/src/index.mjs");

describe("validate-i18n", () => {
  it("exits 0 against the repo root (report-only mode)", () => {
    const result = execFileSync(process.execPath, [TOOL, REPO_ROOT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Tool runs without crashing — result is stdout
    assert.ok(typeof result === "string");
  });

  it("outputs a summary line containing key counts or skip message", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], {
      encoding: "utf8",
    });
    // Tool always exits 0 (report-only)
    assert.equal(r.status, 0, `Tool exited non-zero: ${r.stderr}`);
    // Combined output must contain the tool's marker or OK summary
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      combined.includes("[validate-i18n]") || combined.includes("OK"),
      `Expected tool output, got: ${combined}`
    );
  });
});
