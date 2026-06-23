import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../src/load.mjs";
import { runRules } from "../src/index.mjs";
import { collectImportMap, packageRemovalStatus } from "../src/package-status.mjs";
import { DEPRECATED_REMOVE_PACKAGES } from "../src/vocab.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Independently derive the EXACT expected blocker set and assert R9 matches it exactly. A missing
// package blocker or open decision (or a stray extra) fails this test.
function expectedBlockerSubjects(ctx) {
  const caps = ctx.capabilities
    .filter((c) => c.status === "requires-v1-completion")
    .map((c) => c.capability);
  const importMap = collectImportMap(repoRoot);
  const pkgs = DEPRECATED_REMOVE_PACKAGES.filter(
    (p) => packageRemovalStatus(repoRoot, p, { importMap }).blocker
  ).map((p) => `packages/${p}`);
  const decisions = (ctx.reconciliation?.semanticGapsRemaining?.openDecisions || []).map(
    (d) => d.subject
  );
  return [...caps, ...pkgs, ...decisions].sort();
}

const adversarialRule = (ruleId) => /^R5[1-9]-|^R6[0-1]-/.test(ruleId);

test("golden: base consistency clean; formal proof gaps truthfully reported; R9 exact", () => {
  const ctx = loadContext({ repoRoot, strict: true });
  const findings = runRules(ctx);

  const consistency = findings.filter(
    (f) =>
      f.ruleId !== "R9-branch-cut-blocker" &&
      f.ruleId !== "R22-semantic-completeness" &&
      f.ruleId !== "R23-proof-classification" &&
      f.ruleId !== "R62-formal-proof-evidence-assurance" &&
      !adversarialRule(f.ruleId)
  );
  assert.deepEqual(
    consistency,
    [],
    `base consistency rules must be clean; got:\n${consistency.map((f) => `${f.ruleId} ${f.subject}: ${f.message}`).join("\n")}`
  );

  const formalProof = findings.filter((f) => f.ruleId === "R62-formal-proof-evidence-assurance");
  assert.ok(
    formalProof.length > 100,
    "formal proof assurance must report runtime evidence gaps instead of accepting generated proof constants"
  );
  assert.ok(
    formalProof.some(
      (f) =>
        f.subject === "apps/platform-api/scripts/alert-incident-closure-runtime-proof.ts" &&
        f.message.includes("proof command exited")
    ),
    "formal proof assurance must fail real provider proof commands that cannot reach their substrate"
  );
  assert.ok(
    formalProof.some(
      (f) =>
        f.subject === "apps/platform-api/scripts/alert-notification-bridge-runtime-proof.ts" &&
        f.message.includes("claimed L4 exceeds observed L1")
    ),
    "formal proof assurance must fail proof level overclaims from proof-process evidence"
  );

  const adversarial = findings.filter((f) => adversarialRule(f.ruleId));
  assert.deepEqual(
    adversarial,
    [],
    `adversarial runtime audit must remain closed; got:\n${adversarial.map((f) => `${f.ruleId} ${f.subject}: ${f.message}`).join("\n")}`
  );

  const actual = findings
    .filter((f) => f.ruleId === "R9-branch-cut-blocker")
    .map((f) => f.subject)
    .sort();
  const expected = expectedBlockerSubjects(ctx);
  assert.deepEqual(actual, expected, "R9 blocker subjects must exactly equal the derived set");
  assert.equal(actual.length, expected.length);
});
