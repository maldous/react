import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCtx, clone } from "./fixtures.mjs";
import { runRules } from "../src/index.mjs";
import r1 from "../src/rules/r1-placeholder.mjs";
import r2 from "../src/rules/r2-capability.mjs";
import r3 from "../src/rules/r3-zero-gap.mjs";
import r4 from "../src/rules/r4-vocabulary.mjs";
import r5 from "../src/rules/r5-count-buckets.mjs";
import r6 from "../src/rules/r6-package-removal.mjs";
import r7 from "../src/rules/r7-soft-mapping.mjs";
import r8 from "../src/rules/r8-runbook.mjs";
import r9 from "../src/rules/r9-blockers.mjs";

const fires = (rule, ctx, ruleId) => {
  const f = rule(ctx);
  assert.ok(f.length > 0, `${ruleId} should fire`);
  assert.ok(
    f.every((x) => x.ruleId === ruleId),
    `${ruleId} findings carry the right id`
  );
};

test("clean fixture passes every rule", () => {
  assert.deepEqual(runRules(cleanCtx()), []);
});

test("R1 fires on a hard placeholder; allows {{PINNED_V1_COMMIT}}", () => {
  const bad = clone(cleanCtx());
  bad.gapReport = "audited commit <undefined>";
  fires(r1, bad, "R1-placeholder");
  const ok = clone(cleanCtx());
  ok.gapReport = "freeze commit {{PINNED_V1_COMMIT}} pinned at cut time";
  assert.deepEqual(r1(ok), []);
});

test("R1 fires on unresolved pinned commit under --strict", () => {
  const bad = clone(cleanCtx());
  bad.pinnedV1Commit = "{{PINNED_V1_COMMIT}}";
  fires(r1, bad, "R1-placeholder");
});

test("R2 fires on delivered-and-proven with a missing route / must-close openAction", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].route = "missing";
  fires(r2, a, "R2-capability-integrity");
  const b = clone(cleanCtx());
  b.capabilities[0].openAction = "ADR-X — must close before V2 cut";
  fires(r2, b, "R2-capability-integrity");
});

test("R2 clears a partial route with acceptablePartialRoute; fires without it", () => {
  const part = clone(cleanCtx());
  part.capabilities[0].route = "provisioning (partial UI)";
  fires(r2, part, "R2-capability-integrity");
  part.capabilities[0].acceptablePartialRoute = true;
  assert.deepEqual(r2(part), []);
});

test("R2 fires on requires-v1-completion without completionAction", () => {
  const c = clone(cleanCtx());
  c.capabilities[0] = { capability: "C", status: "requires-v1-completion" };
  fires(r2, c, "R2-capability-integrity");
});

test("R3 fires on an affirmative zero-gap claim while gaps remain", () => {
  const c = clone(cleanCtx());
  c.capabilities.push({
    capability: "G",
    status: "requires-v1-completion",
    completionAction: "V1C-99",
  });
  c.reconciliation.verdict = "ZERO UNRESOLVED GAPS";
  fires(r3, c, "R3-zero-gap-honesty");
});

test("R3 does NOT fire on an honest negation", () => {
  const c = clone(cleanCtx());
  c.capabilities.push({
    capability: "G",
    status: "requires-v1-completion",
    completionAction: "V1C-99",
  });
  c.gapReport =
    "Verdict: NOT ZERO GAPS. `ZERO UNRESOLVED GAPS` may only be claimed when the gate passes.";
  assert.deepEqual(r3(c), []);
});

test("R4 fires on an off-vocabulary disposition / status", () => {
  const a = clone(cleanCtx());
  a.pathMap[0].disposition = "refine";
  fires(r4, a, "R4-vocabulary");
  const b = clone(cleanCtx());
  b.capabilities[0].status = "delivered";
  fires(r4, b, "R4-vocabulary");
});

test("R5 fires on a collapsed/aliased bucket", () => {
  const a = clone(cleanCtx());
  a.reconciliation.files.buckets = { reuse: 1239 };
  fires(r5, a, "R5-count-buckets");
});

test("R5 fires on a count mismatch", () => {
  const a = clone(cleanCtx());
  a.reconciliation.files.buckets["reuse-unchanged"] = 999;
  fires(r5, a, "R5-count-buckets");
});

test("R6 fires on delete-after-proof with a v2Path and on a surviving tree home", () => {
  const a = clone(cleanCtx());
  a.pathMap[1].v2Path = "packages/legacy-thing/package.json";
  fires(r6, a, "R6-package-removal");
  const b = clone(cleanCtx());
  b.targetTree += "\n    core/  # [~] was domain-core\n";
  fires(r6, b, "R6-package-removal");
});

test("R6 fires when a known deprecated package is not delete-after-proof", () => {
  const a = clone(cleanCtx());
  a.pathMap.push({
    v1Path: "packages/worker-runtime/package.json",
    disposition: "reuse-unchanged",
    v2Path: "x",
    deletionCondition: "n/a",
    decisionRefs: [],
  });
  fires(r6, a, "R6-package-removal");
});

test("R7 fires on a package delete-after-proof without decisionRefs", () => {
  const a = clone(cleanCtx());
  a.pathMap[1].decisionRefs = [];
  fires(r7, a, "R7-soft-mapping");
});

test("R8 fires when the v2:readiness script is missing", () => {
  const a = clone(cleanCtx());
  delete a.packageJsonScripts["v2:readiness"];
  fires(r8, a, "R8-runbook-tooling");
});

test("R9 reports requires-v1-completion and deprecated packages as blockers", () => {
  const a = clone(cleanCtx());
  a.capabilities.push({
    capability: "G",
    status: "requires-v1-completion",
    completionAction: "V1C-99",
  });
  a.pathMap.push({
    v1Path: "packages/domain-core/package.json",
    disposition: "delete-after-proof",
    v2Path: null,
    deletionCondition: "x (ADR-0006)",
    decisionRefs: ["ADR-0006"],
  });
  fires(r9, a, "R9-branch-cut-blocker");
});
