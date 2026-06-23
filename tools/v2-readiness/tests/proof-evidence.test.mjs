import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.equal(observedLevelFromEvidence(validRecord()), 6);
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
    gapKinds(validRecord({ auditEventIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-l6-correlation"
    )
  );
  assert.ok(
    gapKinds(validRecord({ traceIds: [], proofLevelClaimed: "L6" })).includes(
      "missing-l6-correlation"
    )
  );
  assert.ok(gapKinds(validRecord({ beforeState: {} })).includes("missing-before-after-state"));
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
