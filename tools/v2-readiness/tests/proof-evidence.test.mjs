import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilityProofReadinessReport,
  buildWeakProofBacklog,
  normalizeEvidenceRecord,
  observedLevelFromEvidence,
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
        realLocalProviderUsed: false,
        externalSandboxProviderUsed: true,
        externalSandboxRequestIds: ["sandbox-request-1", "sandbox-response-1"],
      })
    ),
    6
  );
  assert.equal(observedLevelFromEvidence(validRecord({ routeIds: [] })), 4);
  assert.equal(
    observedLevelFromEvidence(validRecord({ routeIds: [], realLocalProviderUsed: false })),
    3
  );
  assert.equal(observedLevelFromEvidence(validRecord({ beforeState: {} })), 2);
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
  assert.ok(gapKinds(validRecord({ proofLevelClaimed: "L5" })).includes("test-proof-claims-l5"));
  assert.ok(
    gapKinds(validRecord({ auditEventIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-l6-correlation"
    )
  );
  assert.ok(
    gapKinds(validRecord({ traceIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-l6-correlation"
    )
  );
  assert.ok(
    gapKinds(
      validRecord({ metricSamples: [], metricEvidence: [], proofLevelClaimed: "L6" })
    ).includes("missing-l6-correlation")
  );
  assert.ok(gapKinds(validRecord({ beforeState: {} })).includes("missing-before-after-state"));
  assert.ok(gapKinds(validRecord({ afterState: {} })).includes("missing-before-after-state"));
  assert.ok(
    gapKinds(validRecord({ failurePathExercised: false, failureMode: "not-exercised" })).includes(
      "missing-failure-path"
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

test("capability readiness fails until every proof band is evidenced", () => {
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
  assert.equal(partial.status, "FAIL");
  assert.equal(partial.capabilities[0].readiness, "SEMANTIC_PROVEN");
  assert.deepEqual(partial.capabilities[0].requiredBands, [
    "semantic-L3",
    "provider-L4",
    "sandbox-L5",
    "journey-L6",
  ]);
  assert.deepEqual(partial.capabilities[0].missingBands, [
    "provider-L4",
    "sandbox-L5",
    "journey-L6",
  ]);
  assert.deepEqual(partial.capabilities[0].missingRequiredBands, [
    "provider-L4",
    "sandbox-L5",
    "journey-L6",
  ]);
  assert.ok(partial.gaps.some((gap) => gap.kind === "capability-real-provider-proof-missing"));

  const fullyProven = buildCapabilityProofReadinessReport(capabilityCtx, [
    ...semanticOnly,
    validRecord({ proofId: "proof:fixture-provider" }),
    validRecord({
      proofId: "proof:fixture-journey",
      environmentMode: "staging",
      environment: "staging",
      providerMode: "external-sandbox",
      proofLevelClaimed: "L6",
      realLocalProviderUsed: false,
      externalSandboxProviderUsed: true,
      externalSandboxRequestIds: ["sandbox-request-1", "sandbox-response-1"],
    }),
  ]);
  assert.equal(fullyProven.status, "PASS");
  assert.equal(fullyProven.capabilities[0].readiness, "FULLY_PROVEN");
  assert.deepEqual(fullyProven.capabilities[0].missingBands, []);
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
          kind: "capability-real-provider-proof-missing",
          readiness: "SEMANTIC_PROVEN",
          missingBand: "provider-L4",
          message: "Fixture capability is SEMANTIC_PROVEN; missing provider-L4 runtime evidence",
        },
      ],
    }
  );
  assert.equal(backlog.status, "FAIL");
  assert.equal(backlog.capabilityProofGapCount, 1);
  assert.deepEqual(backlog.capabilityProofGaps, [
    {
      capability: "Fixture capability",
      kind: "capability-real-provider-proof-missing",
      readiness: "SEMANTIC_PROVEN",
      missingBand: "provider-L4",
      message: "Fixture capability is SEMANTIC_PROVEN; missing provider-L4 runtime evidence",
    },
  ]);
});
