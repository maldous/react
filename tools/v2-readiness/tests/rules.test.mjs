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
import r10 from "../src/rules/r10-file-coverage.mjs";
import r11 from "../src/rules/r11-command-coverage.mjs";
import r12 from "../src/rules/r12-test-coverage.mjs";
import r13 from "../src/rules/r13-decision-governance.mjs";
import r14 from "../src/rules/r14-foundation.mjs";
import r15 from "../src/rules/r15-app-path.mjs";
import r16 from "../src/rules/r16-services.mjs";
import r17 from "../src/rules/r17-migrations.mjs";
import r18 from "../src/rules/r18-environment-config.mjs";
import r19 from "../src/rules/r19-executable-assets.mjs";
import r20 from "../src/rules/r20-harness-semantics.mjs";
import r22 from "../src/rules/r22-semantic-completeness.mjs";
import r23 from "../src/rules/r23-proof-classification.mjs";
import r24 from "../src/rules/r24-environment-semantics.mjs";
import r25 from "../src/rules/r25-cross-capability-semantics.mjs";
import r26 from "../src/rules/r26-event-semantics.mjs";
import r27 from "../src/rules/r27-operational-semantics.mjs";
import r28 from "../src/rules/r28-semantic-source-transition.mjs";
import r30 from "../src/rules/r30-graph-integrity.mjs";
import r31 from "../src/rules/r31-state-machine-soundness.mjs";
import r32 from "../src/rules/r32-traceability-closure.mjs";
import r33 from "../src/rules/r33-environment-completeness.mjs";
import r34 from "../src/rules/r34-constraint-satisfaction.mjs";
import r35 from "../src/rules/r35-semantic-closure.mjs";
import r36 from "../src/rules/r36-regeneration-sufficiency.mjs";
import r37 from "../src/rules/r37-semantic-entropy.mjs";

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

test("R9 reports requires-v1-completion + live-present packages + open decisions as blockers", () => {
  const a = clone(cleanCtx());
  a.capabilities.push({
    capability: "G",
    status: "requires-v1-completion",
    completionAction: "V1C-99",
  });
  // package blockers come from LIVE status, not path-map membership (the bug fix)
  a.packageStatuses = [{ pkg: "worker-runtime", blocker: true, reasons: ["dir"] }];
  a.reconciliation.semanticGapsRemaining.openDecisions = [
    { subject: "packages/config-runtime", action: "V1C-PKG-CONFIG" },
  ];
  const f = r9(a);
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => x.subject).sort(), [
    "G",
    "packages/config-runtime",
    "packages/worker-runtime",
  ]);
});

test("R9 package blocker CLEARS when live status shows removed (path-map entry irrelevant)", () => {
  const a = clone(cleanCtx());
  // a permanent path-map record for a removed package must NOT keep the blocker alive
  a.pathMap.push({
    v1Path: "packages/worker-runtime/package.json",
    disposition: "delete-after-proof",
    v2Path: null,
    deletionCondition: "x (ADR-0006)",
    decisionRefs: ["ADR-0006"],
  });
  a.packageStatuses = []; // live: removed + evidence valid
  assert.deepEqual(r9(a), []);
});

test("R10 fires on a file-set mismatch (inventory vs path-map)", () => {
  const a = clone(cleanCtx());
  a.fileInventory.push({ v1Path: "ghost.ts" });
  a.shards.push({ v1Path: "ghost.ts" });
  fires(r10, a, "R10-file-coverage");
});

test("R10: a post-audit file at the cut-candidate FAILS until entered in the delta/map", () => {
  const a = clone(cleanCtx());
  a.candidateTracked.files.push("apps/new-after-audit.ts"); // present at candidate, unmapped, no delta
  fires(r10, a, "R10-file-coverage");
  // entering it in the delta with all required fields clears it
  a.postAuditDelta.additions.push({
    path: "apps/new-after-audit.ts",
    introducingCommit: "abc1234",
    purpose: "new V2 capability file",
    v2Disposition: "reuse-unchanged",
    v2Target: "apps/new-after-audit.ts",
    protectingTests: ["t.test.ts"],
    decisionRefs: ["ADR-ACT-0292"],
  });
  assert.deepEqual(r10(a), []);
});

test("R10: a delta addition with a missing required field fails", () => {
  const a = clone(cleanCtx());
  a.candidateTracked.files.push("apps/x.ts");
  a.postAuditDelta.additions.push({ path: "apps/x.ts", introducingCommit: "abc" }); // missing fields
  fires(r10, a, "R10-file-coverage");
});

test("R10: under --strict a pinned non-HEAD candidate fails unless --historical", () => {
  const a = clone(cleanCtx());
  a.cutCandidateCommit = "feedface";
  a.headCommit = "deadbeef";
  fires(r10, a, "R10-file-coverage");
  a.historical = true; // historical mode permits a non-HEAD snapshot
  assert.deepEqual(r10(a), []);
});

test("R10: --require-clean fails on a dirty working tree", () => {
  const a = clone(cleanCtx());
  a.requireClean = true;
  a.treeClean = false;
  fires(r10, a, "R10-file-coverage");
});

test("R11 fires on an uncatalogued live npm script and on a stale catalogue entry", () => {
  const a = clone(cleanCtx());
  a.packageJsonScripts.newscript = "x";
  fires(r11, a, "R11-command-coverage");
  const b = clone(cleanCtx());
  b.commandCatalog.push({ name: "npm gone", kind: "npm" });
  fires(r11, b, "R11-command-coverage");
});

test("R12 fires on an uninventoried live test and a dangling map record", () => {
  const a = clone(cleanCtx());
  a.listTestFiles = () => ["t.test.ts", "new.test.ts"];
  fires(r12, a, "R12-test-coverage");
  const b = clone(cleanCtx());
  b.testMap.push({ v1Path: "orphan.test.ts", v2Path: "x", migrationType: "carry" });
  fires(r12, b, "R12-test-coverage");
});

test("R13 fires on missing lineage and unknown referenced action", () => {
  const a = clone(cleanCtx());
  a.decisionLineage = []; // V2-ADR-1 now has no lineage
  fires(r13, a, "R13-decision-governance");
  const b = clone(cleanCtx());
  b.capabilities.push({
    capability: "X",
    status: "requires-v1-completion",
    completionAction: "V1C-9",
    decisionRef: "ADR-ACT-9999",
  });
  fires(r13, b, "R13-decision-governance");
});

test("R14 fires on a missing foundation artefact", () => {
  const a = clone(cleanCtx());
  a.foundation["ui-capability-model.json"] = null;
  fires(r14, a, "R14-foundation");
});

test("R14 fires when a ui-capability-model record misses a schema-required field", () => {
  const a = clone(cleanCtx());
  a.foundation["ui-definition.schema.json"] = { required: ["capabilityId", "route", "a11y"] };
  a.foundation["ui-capability-model.json"] = { capabilities: [{ capabilityId: "x", route: "/x" }] }; // no a11y
  fires(r14, a, "R14-foundation");
});

test("R13 fires when a requires-v1-completion capability has no completion-actions entry", () => {
  const a = clone(cleanCtx());
  a.capabilities.push({
    capability: "Z",
    status: "requires-v1-completion",
    completionAction: "V1C-77",
  });
  // completionActions.actions is empty -> no entry for V1C-77
  fires(r13, a, "R13-decision-governance");
});

test("R13 passes when the completion-actions entry exists", () => {
  const a = clone(cleanCtx());
  a.capabilities.push({
    capability: "Z",
    status: "requires-v1-completion",
    completionAction: "V1C-77",
  });
  a.completionActions.actions.push({
    id: "V1C-77",
    parentCapability: "Z",
    status: "requires-v1-completion",
    decision: "build",
    stopCondition: "done",
  });
  assert.deepEqual(r13(a), []);
});

test("R15 fires on an apps/api reference anywhere", () => {
  const a = clone(cleanCtx());
  a.testMap[0].v2Path = "apps/api/tests/x.test.ts";
  fires(r15, a, "R15-app-path");
});

test("R16 fires on a compose service missing from the matrix", () => {
  const a = clone(cleanCtx());
  a.compose.services.push({ name: "ghostsvc", profiles: [], image: "x", ports: [] });
  fires(r16, a, "R16-services");
});

test("R16 fires on a forward-auth resource without a permission", () => {
  const a = clone(cleanCtx());
  a.foundation["service-and-clickthrough-matrix.json"][0].forwardAuthResource = "admin:postgres";
  a.foundation["service-and-clickthrough-matrix.json"][0].permission = null;
  fires(r16, a, "R16-services");
});

test("R17 fires on an on-disk migration absent from the plan", () => {
  const a = clone(cleanCtx());
  a.migrations.push({ file: "099-rogue.sql", checksum: "z" });
  fires(r17, a, "R17-migrations");
});

test("R17 fires on a tenant-data service with no backup decision", () => {
  const a = clone(cleanCtx());
  a.foundation["service-and-clickthrough-matrix.json"][0].backupRestore = null;
  fires(r17, a, "R17-migrations");
});

test("R18 fires on a secret-named key not classified secret", () => {
  const a = clone(cleanCtx());
  a.configConsumption.keys.push({
    key: "DB_PASSWORD",
    consumerCount: 1,
    sources: ["x"],
    secret: false,
    testFixtureOnly: false,
    authoritativeSource: "m",
    v2Disposition: "carry",
    directAccessOutsideComposition: 0,
  });
  fires(r18, a, "R18-environment-config");
});

test("R18 fires on a forbidden mock mode enabled in prod, and an unsafe secret default", () => {
  const a = clone(cleanCtx());
  a.envManifests.prod = { ALLOW_MOCK_IDP_IN_PROD_UNTIL_REAL_PROVIDERS: true };
  fires(r18, a, "R18-environment-config");
  const b = clone(cleanCtx());
  b.envManifests.staging = { API_KEY_PEPPER: "changeme" };
  fires(r18, b, "R18-environment-config");
});

test("R19 fires on a Playwright spec missing the inventory and an unmapped executable", () => {
  const a = clone(cleanCtx());
  a.executableAssets.playwrightSpecs = ["e2e/orphan.spec.ts"]; // not in test inventory
  fires(r19, a, "R19-executable-assets");
  const b = clone(cleanCtx());
  b.executableAssets.shellScripts = ["scripts/orphan.sh"]; // not in path-map/delta
  fires(r19, b, "R19-executable-assets");
});

test("R19 fires on a Terraform root with an unrecognised stage", () => {
  const a = clone(cleanCtx());
  a.executableAssets.terraformRoots = ["infra/env/wonderland"];
  a.pathMap.push({
    v1Path: "infra/env/wonderland/main.tf",
    disposition: "reuse-unchanged",
    v2Path: "infra/env/wonderland/main.tf",
    deletionCondition: "n/a",
    decisionRefs: [],
  });
  fires(r19, a, "R19-executable-assets");
});

test("R20 ignores capabilities without a harness block (clean model passes)", () => {
  assert.deepEqual(r20(cleanCtx()), []);
});

test("R20 fires on an inconsistent harness definition", () => {
  const a = clone(cleanCtx());
  a.foundation["ui-capability-model.json"].capabilities.push({
    capabilityId: "x-broken",
    harness: {
      capabilityKey: "broken",
      personas: [{ personaId: "admin", permissions: ["b.read"] }],
      // permission missing denied-persona coverage → must fire (#5)
      permissions: [{ permission: "b.read", allowedPersonas: ["admin"], deniedPersonas: [] }],
      queries: [
        { queryId: "list", method: "GET", endpoint: "/api/b", requiredPermission: "b.read" },
      ],
      commands: [],
      fields: [],
      validation: [],
      states: ["loaded"],
      transitions: [],
      fixtures: [],
      accessibleNames: [],
      keyboardBehaviour: [],
      errorPresentation: {},
      journeys: [],
    },
  });
  fires(r20, a, "R20-harness-semantics");
});

test("R22 fires when a semantic foundation asset is missing", () => {
  const a = clone(cleanCtx());
  a.foundation["capability-ui-contract.json"] = null;
  fires(r22, a, "R22-semantic-completeness");
});

test("R22 fires when a delivered capability lacks semantic completeness evidence", () => {
  const a = clone(cleanCtx());
  delete a.capabilities[0].semanticCompleteness;
  fires(r22, a, "R22-semantic-completeness");
});

test("R22 fires when a delivered capability misses one required semantic facet", () => {
  const a = clone(cleanCtx());
  delete a.capabilities[0].semanticCompleteness.errorModel;
  const findings = r22(a);
  assert.deepEqual(findings, [
    {
      ruleId: "R22-semantic-completeness",
      severity: "error",
      subject: "C1",
      message: 'semanticCompleteness missing required facet "errorModel"',
    },
  ]);
});

test("R23 fires when a runtime proof script is not inventoried", () => {
  const a = clone(cleanCtx());
  a.candidateTracked.files.push("apps/platform-api/scripts/orphan-runtime-proof.ts");
  fires(r23, a, "R23-proof-classification");
});

test("R23 fires when an inventoried runtime proof lacks level classification", () => {
  const a = clone(cleanCtx());
  a.packageJsonScripts["proof:x"] =
    'node --loader "$(pwd)/apps/platform-api/loader.mjs" apps/platform-api/scripts/x-runtime-proof.ts';
  a.candidateTracked.files.push("apps/platform-api/scripts/x-runtime-proof.ts");
  a.testInventory.push({
    id: "package.json#proof:x",
    path: "package.json#proof:x",
    kind: "proof-script",
  });
  fires(r23, a, "R23-proof-classification");
});

test("R23 accepts a proof script with level and rationale", () => {
  const a = clone(cleanCtx());
  a.packageJsonScripts["proof:x"] =
    'node --loader "$(pwd)/apps/platform-api/loader.mjs" apps/platform-api/scripts/x-runtime-proof.ts';
  a.candidateTracked.files.push("apps/platform-api/scripts/x-runtime-proof.ts");
  a.testInventory.push({
    id: "package.json#proof:x",
    path: "package.json#proof:x",
    kind: "proof-script",
    proofLevel: 3,
    proofLevelRationale: "state-machine validation",
    capabilitiesProven: ["C1"],
    semanticFacetsProven: ["contracts", "stateModel", "readinessModel"],
    environment: "test",
    providerClass: "compose-local",
    liveSubstrateUsed: true,
    destructive: false,
    prodSafe: true,
    sourceCommand: "npm run proof:x",
    expectedFailureMode: "runtime proof exits non-zero",
  });
  assert.deepEqual(r23(a), []);
});

test("R23 fires when a delivered capability omits semantic proof level", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].semanticCompleteness.proof = "fixture proof without a level";
  assert.deepEqual(r23(a), [
    {
      ruleId: "R23-proof-classification",
      severity: "error",
      subject: "C1",
      message: "delivered-and-proven capability semantic proof must declare Proof level 3..5",
    },
  ]);
});

test("R23 fires when a delivered capability proof level is below the delivered floor", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].semanticCompleteness.proof = "fixture proof. Proof level: 2 behavior only.";
  assert.deepEqual(r23(a), [
    {
      ruleId: "R23-proof-classification",
      severity: "error",
      subject: "C1",
      message: "delivered-and-proven capability proof level 2 is below required minimum 3",
    },
  ]);
});

test("R23 fires when a live-provider delivered capability proof level is below the provider floor", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].proofTier = "live-composed-provider";
  a.capabilities[0].semanticCompleteness.proof =
    "fixture provider proof. Proof level: 3 state-machine only.";
  assert.deepEqual(r23(a), [
    {
      ruleId: "R23-proof-classification",
      severity: "error",
      subject: "C1",
      message: "provider-backed delivered capability proof level 3 is below required minimum 4",
    },
  ]);
});

test("R24 fires when a delivered capability has no environment row", () => {
  const a = clone(cleanCtx());
  a.foundation["environment-capability-matrix.json"].capabilities = [];
  fires(r24, a, "R24-environment-semantics");
});

test("R24 fires when prod allows mocks or staging lacks prod-like proof", () => {
  const a = clone(cleanCtx());
  a.foundation["environment-capability-matrix.json"].capabilities[0].prod.mocksAllowed = true;
  fires(r24, a, "R24-environment-semantics");
  const b = clone(cleanCtx());
  b.foundation["environment-capability-matrix.json"].capabilities[0].staging.prodLikeProof = false;
  fires(r24, b, "R24-environment-semantics");
});

test("R25 fires when a known interaction lacks failure semantics", () => {
  const a = clone(cleanCtx());
  delete a.foundation["cross-capability-interactions.json"].interactions[0].failureBehaviour;
  fires(r25, a, "R25-cross-capability-semantics");
});

test("R26 fires when an emitted event is absent from event semantics", () => {
  const a = clone(cleanCtx());
  a.platformEventNames = ["missing.event"];
  fires(r26, a, "R26-event-semantics");
});

test("R26 fires when a mutating event lacks idempotency semantics", () => {
  const a = clone(cleanCtx());
  delete a.foundation["event-semantics.json"].events[0].idempotencyKey;
  fires(r26, a, "R26-event-semantics");
});

test("R27 fires when a provider-backed capability has no degraded mode", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].proofTier = "live-composed-provider";
  delete a.foundation["operational-semantics.json"].capabilities[0].degradedMode;
  fires(r27, a, "R27-operational-semantics");
});

test("R28 fires when no post-V2 source-of-truth policy exists", () => {
  const a = clone(cleanCtx());
  a.foundation["semantic-source-of-truth-transition.json"] = null;
  fires(r28, a, "R28-semantic-source-transition");
});

test("R28 fires when capability behaviour changes are not tied to semantic artefacts", () => {
  const a = clone(cleanCtx());
  a.foundation["semantic-source-of-truth-transition.json"].policies.changePolicy =
    "update code eventually";
  fires(r28, a, "R28-semantic-source-transition");
});

test("R30 fires on an orphan committed formal graph node", () => {
  const a = clone(cleanCtx());
  a.formalModel = {
    "traceability-graph.json": {
      artefact: "traceability-graph",
      nodes: [{ id: "capability:orphan", kind: "capability", label: "orphan" }],
      edges: [],
    },
  };
  fires(r30, a, "R30-graph-integrity");
});

test("R31 fires on an unreachable committed state machine state", () => {
  const a = clone(cleanCtx());
  a.formalModel = {
    "state-machines.json": {
      machines: [
        {
          id: "state-machine:c1",
          capability: "C1",
          states: ["defined", "ready", "dead"],
          initialState: "defined",
          transitions: [{ from: "defined", to: "ready" }],
          terminalStates: ["ready"],
        },
      ],
    },
  };
  fires(r31, a, "R31-state-machine-soundness");
});

test("R32 fires when a capability loses traceability to contract", () => {
  const a = clone(cleanCtx());
  a.capabilities[0].contract = "";
  fires(r32, a, "R32-traceability-closure");
});

test("R33 fires when a delivered capability is missing a prod environment cell", () => {
  const a = clone(cleanCtx());
  delete a.foundation["environment-capability-matrix.json"].capabilities[0].prod;
  fires(r33, a, "R33-environment-completeness");
});

test("R34 fires when a mutating event lacks idempotency", () => {
  const a = clone(cleanCtx());
  delete a.foundation["event-semantics.json"].events[0].idempotencyKey;
  fires(r34, a, "R34-constraint-satisfaction");
});

test("R35 fires when runtime event behaviour lacks semantic definition", () => {
  const a = clone(cleanCtx());
  a.platformEventNames = ["missing.event"];
  fires(r35, a, "R35-semantic-closure");
});

test("R36 fires when regeneration lacks an operational row", () => {
  const a = clone(cleanCtx());
  a.foundation["operational-semantics.json"].capabilities = [];
  fires(r36, a, "R36-regeneration-sufficiency");
});

test("R37 fires on duplicate event definitions", () => {
  const a = clone(cleanCtx());
  a.foundation["event-semantics.json"].events.push({
    ...a.foundation["event-semantics.json"].events[0],
  });
  fires(r37, a, "R37-semantic-entropy");
});
