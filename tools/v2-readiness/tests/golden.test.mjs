import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../src/load.mjs";
import { runRules } from "../src/index.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Runs against the real docs/v2-foundation set. Asserts the artefacts are now honest and
// self-consistent: NO consistency violation fires (R1–R8), and the only RED is the honest
// outstanding work (R9 branch-cut blockers). The live tree is NOT green today.
test("golden: live artefacts have zero consistency violations; only R9 blockers remain", () => {
  const ctx = loadContext({ repoRoot, strict: true });
  const findings = runRules(ctx);
  const consistency = findings.filter((f) => f.ruleId !== "R9-branch-cut-blocker");
  assert.deepEqual(
    consistency,
    [],
    `consistency rules must be clean; got:\n${consistency.map((f) => `${f.ruleId} ${f.subject}: ${f.message}`).join("\n")}`
  );
  const blockers = findings.filter((f) => f.ruleId === "R9-branch-cut-blocker");
  assert.ok(
    blockers.length >= 25,
    "expected the 25 requires-v1-completion capabilities as blockers"
  );
});
