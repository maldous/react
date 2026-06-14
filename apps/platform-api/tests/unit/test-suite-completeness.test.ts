/**
 * Completeness guard: every *.test.ts file under apps/platform-api/tests/
 * must appear as a substring of the test:platform-api npm script.
 *
 * Node's test runner does not expand globs, so the file list is hand-maintained.
 * This test fails CI if a test file is added to disk but forgotten in the script.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Resolve the repo-root package.json relative to this test file.
// apps/platform-api/tests/unit/ → up 4 levels → repo root
const pkgPath = fileURLToPath(new URL("../../../../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  scripts: Record<string, string>;
};
const scriptValue: string = pkg.scripts["test:platform-api"];

// Enumerate every *.test.ts file under apps/platform-api/tests/ recursively.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const testsDir = join(repoRoot, "apps", "platform-api", "tests");

function collectTestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const allTestFiles = collectTestFiles(testsDir);

describe("test-suite completeness", () => {
  it("every apps/platform-api test file is referenced in the test:platform-api script", () => {
    const missing = allTestFiles
      .map((f) => f.replace(repoRoot, ""))
      .filter((rel) => !scriptValue.includes(rel));

    assert.ok(
      missing.length === 0,
      "These test files are not in the test:platform-api script and will never run in CI: " +
        missing.join(", ")
    );
  });
});
