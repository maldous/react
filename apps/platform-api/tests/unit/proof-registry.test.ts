/**
 * Proof-ladder registry reconciliation (ADR-ACT-0235).
 *
 * PROOF_LADDER (@platform/contracts-admin) is the single source of truth for the
 * repeatable local runtime proofs. This gate keeps it honest against reality:
 *   - every registry entry has a matching package.json `proof:*` script
 *   - every package.json `proof:*` script is registered (no silent additions)
 *   - the README proof-ladder section mentions every entry
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PROOF_LADDER } from "@platform/contracts-admin";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

describe("PROOF_LADDER registry (ADR-ACT-0235)", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scriptProofs = Object.keys(pkg.scripts).filter((s) => s.startsWith("proof:"));

  it("matches the package.json proof:* scripts exactly (no drift either way)", () => {
    assert.deepEqual([...PROOF_LADDER].sort(), scriptProofs.sort());
  });

  it("includes proof:backup-local and proof:platform-services", () => {
    assert.ok(PROOF_LADDER.includes("proof:backup-local"));
    assert.ok(PROOF_LADDER.includes("proof:platform-services"));
  });

  it("is mentioned in README.md (every entry)", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    for (const proof of PROOF_LADDER) {
      assert.ok(readme.includes(proof), `README.md must mention ${proof}`);
    }
  });

  it("has no duplicates", () => {
    assert.equal(new Set(PROOF_LADDER).size, PROOF_LADDER.length);
  });
});
