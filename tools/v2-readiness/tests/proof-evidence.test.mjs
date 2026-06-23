import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilityProofReadinessReport,
  buildFormalProofGapTaxonomyReport,
  buildWeakProofBacklog,
  normalizeEvidenceRecord,
  observedLevelFromEvidence,
  requiredRuntimeProofs,
  signRecord,
  validateEvidenceSet,
} from "../src/proof-evidence.mjs";

const ctx = {
  headCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
};

function validRecord(overrides = {}) {
  return normalizeEvidenceRecord(
    signRecord({
      proofId: "proof:fixture",
      subjectType: "runtime-proof",
      subjectIds: ["apps/platform-api/scripts/fixture-runtime-proof.ts", "proof:fixture"],
      subjectId: "apps/platform-api/scripts/fixture-runtime-proof.ts",
      capabilityId: "capability:fixture",
      providerId: "provider:fixture",
      routeIds: ["route:get-api-fixture"],
      workflowIds: ["workflow:fixture"],
      eventIds: ["event:fixture"],
      storageIds: ["storage:fixture"],
      environmentMode: "test",
      providerMode: "compose-local",
      proofLevelClaimed: "L4",
      commandExecuted: "npm run proof:fixture",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      exitStatus: 0,
      commit: ctx.headCommit,
      realImplementationPathExecuted: "apps/platform-api/scripts/fixture-runtime-proof.ts",
      mockProviderUsed: false,
      fakeProviderUsed: false,
      inMemoryProviderUsed: false,
      realLocalProviderUsed: true,
      externalSandboxProviderUsed: false,
      externalSandboxRequestIds: [],
      beforeState: { rows: 0 },
      afterState: { rows: 1 },
      assertedStateDiff: { rows: { before: 0, after: 1 } },
      failurePathExercised: true,
      sideEffectsAsserted: true,
      tenantBoundaryAsserted: true,
      securityBoundaryAsserted: true,
      auditEventIds: ["audit-1"],
      traceIds: ["0123456789abcdef0123456789abcdef"],
      metricSamples: [{ name: "proof.fixture", value: 1 }],
      logCorrelationIds: ["log-1"],
      cleanupResult: { status: "verified" },
      deterministicReplaySupported: true,
      skipped: false,
      skipReason: null,
      generatedAt: "2026-01-01T00:00:01.000Z",
      sourceFileRefs: ["apps/platform-api/scripts/fixture-runtime-proof.ts"],
      evidenceEmitter: "proof-process",
      collectorRunId: "test-run",
      assertionsObserved: true,
      expectedOutputsAsserted: true,
      ...overrides,
    })
  );
}

function gapKinds(record, extra = {}) {
  return validateEvidenceSet({
    ctx,
    records: [record],
    requiredProofs: [],
    routeSubjectMap: { routes: [] },
    ...extra,
  }).gaps.map((gap) => gap.kind);
}

test("observed level is calculated from emitted evidence fields only", () => {
  assert.equal(observedLevelFromEvidence(validRecord()), 4);
  assert.equal(
    observedLevelFromEvidence(
      validRecord({
        environmentMode: "staging",
        environment: "staging",
        providerMode: "external-sandbox",
        proofLevelClaimed: "L5",
        realLocalProviderUsed: false,
        externalSandboxProviderUsed: true,
        externalSandboxRequestIds: ["sandbox-request-1", "sandbox-response-1"],
        substrateProofIds: ["proof:fixture-substrate-l4"],
        restartEvidence: { status: "verified" },
        timeoutEvidence: { status: "verified" },
        retryEvidence: { status: "verified" },
        concurrencyEvidence: { status: "verified" },
        recoveryEvidence: { status: "verified" },
        backupRestoreEvidence: { status: "verified" },
        degradedModeEvidence: { status: "verified" },
        failureInjectionEvidence: { status: "verified" },
      })
    ),
    5,
    "L5 resilience is a staging proof that cites prior L4 substrate evidence"
  );
  assert.equal(
    observedLevelFromEvidence(
      validRecord({
        environmentMode: "staging",
        environment: "staging",
        providerMode: "external-sandbox",
        realLocalProviderUsed: false,
        externalSandboxProviderUsed: true,
        externalSandboxRequestIds: ["sandbox-request-1", "sandbox-response-1"],
      })
    ),
    3
  );
  assert.equal(observedLevelFromEvidence(validRecord({ routeIds: [] })), 4);
  assert.equal(
    observedLevelFromEvidence(validRecord({ routeIds: [], realLocalProviderUsed: false })),
    3
  );
  assert.equal(observedLevelFromEvidence(validRecord({ beforeState: {} })), 2);
  assert.equal(
    observedLevelFromEvidence(
      validRecord({
        beforeState: {},
        afterState: {},
        assertedStateDiff: {},
        stateDiff: {},
        failurePathExercised: false,
        failureMode: "not-exercised",
        sideEffectsAsserted: false,
        assertionsObserved: false,
        expectedOutputsAsserted: false,
      })
    ),
    1,
    "exit-zero execution receipt alone is only L1 shape evidence"
  );
});

test("negative controls are caught by emitted-evidence validation", () => {
  assert.ok(gapKinds(validRecord({ fakeProviderUsed: true })).includes("fake-http-labelled-l4"));
  assert.ok(
    gapKinds(
      validRecord({
        inMemoryProviderUsed: true,
        realLocalProviderUsed: true,
        providerMode: "compose-local",
      })
    ).includes("in-memory-labelled-real-provider")
  );
  assert.ok(
    gapKinds(
      validRecord({
        environmentMode: "dev",
        environment: "dev",
        providerMode: "semantic-dev",
        proofLevelClaimed: "L4",
        inMemoryProviderUsed: true,
        realLocalProviderUsed: false,
      })
    ).includes("dev-proof-claims-l4")
  );
  assert.ok(
    gapKinds(validRecord({ proofLevelClaimed: "L5" })).includes("missing-restart-evidence")
  );
  assert.ok(
    gapKinds(validRecord({ proofLevelClaimed: "L5" })).includes("environment-level-forbidden")
  );
  assert.ok(
    gapKinds(validRecord({ auditEventIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-audit-evidence"
    )
  );
  assert.ok(
    gapKinds(validRecord({ traceIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-trace-evidence"
    )
  );
  assert.ok(
    gapKinds(
      validRecord({ metricSamples: [], metricEvidence: [], proofLevelClaimed: "L6" })
    ).includes("missing-metric-evidence")
  );
  assert.ok(gapKinds(validRecord({ beforeState: {} })).includes("missing-before-state"));
  assert.ok(gapKinds(validRecord({ afterState: {} })).includes("missing-after-state"));
  assert.ok(
    gapKinds(validRecord({ failurePathExercised: false, failureMode: "not-exercised" })).includes(
      "missing-failure-path-evidence"
    )
  );
  assert.ok(gapKinds(validRecord({ commit: "old" })).includes("stale-evidence"));
  assert.ok(
    gapKinds(validRecord({ proofLevelClaimed: "L6", routeIds: [] })).includes(
      "proof-claim-overstated"
    )
  );
  assert.ok(
    gapKinds(validRecord({ subjectIds: ["/"], subjectId: "/" })).includes("broad-route-mapping")
  );
  assert.ok(
    gapKinds(validRecord({ skipped: true, skipReason: "", proofLevelClaimed: "L4" })).includes(
      "skipped-proof-marked-pass"
    )
  );
  assert.ok(
    gapKinds(validRecord({ evidenceEmitter: "collector" })).includes(
      "collector-fabricated-evidence"
    )
  );
  assert.ok(gapKinds(validRecord({ collectorRunId: null })).includes("missing-collector-run-id"));
});

test("required runtime proof with deleted evidence fails", () => {
  const gaps = validateEvidenceSet({
    ctx,
    records: [],
    requiredProofs: [
      {
        file: "apps/platform-api/scripts/fixture-runtime-proof.ts",
        subjectIds: ["apps/platform-api/scripts/fixture-runtime-proof.ts", "proof:fixture"],
        commandExecuted: "npm run proof:fixture",
      },
    ],
    routeSubjectMap: { routes: [] },
  }).gaps;
  assert.ok(gaps.some((gap) => gap.kind === "missing-evidence"));
});

test("mutation route evidence must name the exact route state transition", () => {
  const routeSubjectMap = {
    routes: [
      {
        routeId: "route:post-api-fixture",
        method: "POST",
        path: "/api/fixture",
        proofRefs: ["proof:fixture"],
        mutationBeforeAfterRequired: true,
      },
    ],
  };
  const genericState = validateEvidenceSet({
    ctx,
    records: [validRecord({ subjectIds: ["proof:fixture"], routeIds: [] })],
    requiredProofs: [],
    routeSubjectMap,
  }).gaps;
  assert.ok(genericState.some((gap) => gap.kind === "mutation-state-evidence"));

  const routeSpecificState = validateEvidenceSet({
    ctx,
    records: [
      validRecord({
        subjectIds: ["proof:fixture"],
        routeIds: ["route:post-api-fixture"],
        beforeState: { routeMutations: { "route:post-api-fixture": { rows: 0 } } },
        afterState: { routeMutations: { "route:post-api-fixture": { rows: 1 } } },
        assertedStateDiff: {
          routeMutations: { "route:post-api-fixture": { rows: { before: 0, after: 1 } } },
        },
      }),
    ],
    requiredProofs: [],
    routeSubjectMap,
  }).gaps;
  assert.equal(
    routeSpecificState.some((gap) => gap.kind === "mutation-state-evidence"),
    false
  );
});

test("capability readiness locks on Behaviour Proven before future substrate work", () => {
  const capabilityCtx = {
    foundation: {
      "environment-capability-matrix.json": {
        capabilities: [
          {
            capability: "Fixture capability",
            category: "test",
            dev: { requiredProofs: ["proof:fixture"] },
            test: {
              provider: "fixture-real-provider",
              providerClass: "compose-local",
              requiredProofs: ["proof:fixture"],
            },
            staging: {
              providerClass: "sandbox-external",
              proofLevelRequired: 6,
              requiredProofs: ["proof:fixture"],
            },
          },
        ],
      },
    },
  };
  const semanticOnly = [
    validRecord({
      proofId: "proof:fixture-semantic",
      environmentMode: "dev",
      environment: "dev",
      providerMode: "semantic-dev",
      proofLevelClaimed: "L3",
      inMemoryProviderUsed: true,
      realLocalProviderUsed: false,
      externalSandboxProviderUsed: false,
    }),
  ];
  const partial = buildCapabilityProofReadinessReport(capabilityCtx, semanticOnly);
  assert.equal(partial.status, "PASS");
  assert.equal(partial.capabilities[0].readiness, "BEHAVIOUR_PROVEN");
  assert.equal(partial.capabilities[0].l3BehaviourComplete, true);
  assert.equal(partial.capabilities[0].eligibleForSubstrateProvenWork, true);
  assert.deepEqual(partial.capabilities[0].missingRequiredBands, []);
  assert.deepEqual(partial.gaps, []);
  assert.ok(partial.capabilities[0].futureBlockedLevels.includes("resilience-L5-blocked-until-L4"));

  const incompleteBehaviour = buildCapabilityProofReadinessReport(capabilityCtx, [
    validRecord({
      proofId: "proof:fixture-incomplete",
      beforeState: {},
      proofLevelClaimed: "L3",
    }),
  ]);
  assert.equal(incompleteBehaviour.status, "FAIL");
  assert.equal(incompleteBehaviour.capabilities[0].readiness, "CONTRACT_PROVEN");
  assert.deepEqual(incompleteBehaviour.capabilities[0].missingRequiredBands, ["behaviour-L3"]);
  assert.ok(
    incompleteBehaviour.gaps.some((gap) => gap.kind === "capability-behaviour-proof-missing")
  );
});

test("weak proof backlog includes capability-level proof gaps", () => {
  const backlog = buildWeakProofBacklog(
    [],
    { gaps: [], records: [] },
    { mismatchCount: 0 },
    {
      gaps: [
        {
          capability: "Fixture capability",
          kind: "capability-behaviour-proof-missing",
          readiness: "CONTRACT_PROVEN",
          missingBand: "behaviour-L3",
          message: "Fixture capability is CONTRACT_PROVEN; missing behaviour-L3 runtime evidence",
        },
      ],
    }
  );
  assert.equal(backlog.status, "FAIL");
  assert.equal(backlog.capabilityProofGapCount, 1);
  assert.deepEqual(backlog.capabilityProofGaps, [
    {
      capability: "Fixture capability",
      kind: "capability-behaviour-proof-missing",
      readiness: "CONTRACT_PROVEN",
      missingBand: "behaviour-L3",
      message: "Fixture capability is CONTRACT_PROVEN; missing behaviour-L3 runtime evidence",
    },
  ]);
});

test("formal proof gap taxonomy separates L3 closure from future formal backlog", () => {
  const taxonomy = buildFormalProofGapTaxonomyReport({
    evidence: {
      gaps: [
        {
          kind: "proof-command-failed",
          subject: "apps/platform-api/scripts/failing-runtime-proof.ts",
          message: "proof command exited 1",
        },
        {
          kind: "observability-proof-signal",
          subject: "observability:fixture",
          message: "observability proof lacks captured trace/log/metric evidence",
        },
        {
          kind: "route-proof-evidence-missing",
          subject: "POST /api/fixture",
          message: "route proof has explicit subject refs but no emitted evidence record",
        },
        {
          kind: "mutation-state-evidence",
          subject: "POST /api/fixture",
          message: "mutation proof lacks emitted before/after state evidence",
        },
      ],
    },
    claimVsObserved: { mismatches: [] },
    ladderCompliance: { gaps: [] },
    environmentConsistency: { gaps: [] },
    behaviourLocking: { gaps: [] },
    behaviourReadiness: { status: "PASS", remainingClosureWork: [], closurePercentage: 100 },
    capabilityReadiness: { gaps: [] },
    inMemoryParity: { status: "PASS", gaps: [] },
    routeSubjectMap: { gaps: [] },
    negativeControls: { failed: [] },
  });

  assert.equal(taxonomy.status, "FAIL");
  assert.equal(taxonomy.totalGapCount, 4);
  assert.equal(taxonomy.currentL3MilestoneBlocked, false);
  assert.equal(taxonomy.futureSubstrateExpansionBlocked, true);
  assert.deepEqual(taxonomy.gapsByKind, {
    "mutation-state-evidence": 1,
    "observability-proof-signal": 1,
    "proof-command-failed": 1,
    "route-proof-evidence-missing": 1,
  });
  assert.deepEqual(
    taxonomy.byClosureTrack.map((track) => [track.closureTrack, track.gapCount]),
    [
      ["execution", 1],
      ["mutation-state", 1],
      ["observability", 1],
      ["route-evidence", 1],
    ]
  );

  const behaviourBlocking = buildFormalProofGapTaxonomyReport({
    ...taxonomyFixture(),
    behaviourReadiness: {
      status: "FAIL",
      closurePercentage: 99,
      remainingClosureWork: [
        {
          kind: "capability-behaviour-proof-missing",
          capability: "Fixture capability",
          message: "Fixture capability has incomplete L3 Behaviour Proven evidence",
        },
      ],
    },
  });
  assert.equal(behaviourBlocking.currentL3MilestoneBlocked, true);
});

test("required runtime proofs include explicit UI proof scripts with route-proof aliases", () => {
  const proofs = requiredRuntimeProofs(
    {
      packageJsonScripts: {
        "proof:ui-semantic-groups":
          "playwright test --config tools/ui-reference-harness/playwright.config.ts tools/ui-reference-harness/playwright/groups.spec.ts",
        "proof:tenant-domain-canonical":
          'node --loader "$(pwd)/apps/platform-api/loader.mjs" apps/platform-api/scripts/tenant-domain-canonical-runtime-proof.ts',
        "proof:route-contracts":
          'node --loader "$(pwd)/apps/platform-api/loader.mjs" apps/platform-api/scripts/route-contracts-runtime-proof.ts',
      },
    },
    { inventory: { proofs: [] } }
  );

  const groups = proofs.find(
    (proof) => proof.file === "tools/ui-reference-harness/playwright/groups.spec.ts"
  );
  assert.equal(groups.commandExecuted, "npm run proof:ui-semantic-groups");
  assert.equal(groups.proofLevelClaimed, "L1");
  assert.ok(groups.subjectIds.includes("proof:ui-semantic-groups"));
  assert.ok(groups.subjectIds.includes("proof:ui-semantic-groups (headless journey)"));

  const canonical = proofs.find(
    (proof) => proof.file === "apps/platform-api/scripts/tenant-domain-canonical-runtime-proof.ts"
  );
  assert.equal(canonical.proofLevelClaimed, "L3");
  assert.ok(canonical.subjectIds.includes("proof:tenant-domain-canonical"));
  assert.ok(canonical.subjectIds.includes("proof:tenant-domain-canonical (local routing only)"));

  const routeContracts = proofs.find(
    (proof) => proof.file === "apps/platform-api/scripts/route-contracts-runtime-proof.ts"
  );
  assert.equal(routeContracts.commandExecuted, "npm run proof:route-contracts");
  assert.equal(routeContracts.proofLevelClaimed, "L3");
  assert.ok(routeContracts.subjectIds.includes("proof:route-contracts"));
  assert.ok(routeContracts.subjectIds.includes("members unit + substrate tests"));
  assert.ok(routeContracts.subjectIds.includes("platform-config + config-contracts tests"));
});

function taxonomyFixture() {
  return {
    evidence: { gaps: [] },
    claimVsObserved: { mismatches: [] },
    ladderCompliance: { gaps: [] },
    environmentConsistency: { gaps: [] },
    behaviourLocking: { gaps: [] },
    behaviourReadiness: { status: "PASS", remainingClosureWork: [], closurePercentage: 100 },
    capabilityReadiness: { gaps: [] },
    inMemoryParity: { status: "PASS", gaps: [] },
    routeSubjectMap: { gaps: [] },
    negativeControls: { failed: [] },
  };
}
