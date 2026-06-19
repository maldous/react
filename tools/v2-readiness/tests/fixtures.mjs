import { AUDITED_V1_COMMIT } from "../src/vocab.mjs";

// A minimal context that passes ALL rules (R1–R15). Tests clone + mutate it to trigger one rule.
export function cleanCtx() {
  return {
    repoRoot: "/fixture",
    strict: true,
    historical: false,
    requireClean: false,
    auditBaseCommit: AUDITED_V1_COMMIT,
    cutCandidateCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    headCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    candidateResolves: true,
    treeClean: true,
    pinnedV1Commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    auditedCommit: AUDITED_V1_COMMIT,
    candidateTracked: { files: ["a.ts", "packages/legacy-thing/package.json"], ok: true },
    postAuditDelta: { schemaVersion: 1, additions: [], deletions: [] },
    completionActions: { schemaVersion: 1, actions: [] },
    pathMap: [
      {
        v1Path: "a.ts",
        disposition: "reuse-unchanged",
        v2Path: "a.ts",
        deletionCondition: "n/a",
        decisionRefs: [],
      },
      {
        v1Path: "packages/legacy-thing/package.json",
        disposition: "delete-after-proof",
        v2Path: null,
        deletionCondition: "remove after zero-consumer proof (ADR-0006)",
        decisionRefs: ["ADR-0006"],
      },
    ],
    fileInventory: [{ v1Path: "a.ts" }, { v1Path: "packages/legacy-thing/package.json" }],
    shards: [{ v1Path: "a.ts" }, { v1Path: "packages/legacy-thing/package.json" }],
    gitTracked: { files: ["a.ts", "packages/legacy-thing/package.json"], ok: true },
    commandCatalog: [
      { name: "make build", kind: "make" },
      { name: "npm test", kind: "npm" },
      { name: "npm v2:readiness", kind: "npm" },
    ],
    commandMap: [
      { v1Name: "make build", v2Name: "make build", disposition: "carry", retireReason: null },
      { v1Name: "npm test", v2Name: "npm test", disposition: "carry", retireReason: null },
      {
        v1Name: "npm v2:readiness",
        v2Name: "npm v2:readiness",
        disposition: "carry",
        retireReason: null,
      },
    ],
    makeTargets: ["build"],
    packageJsonScripts: {
      test: "node --test",
      "v2:readiness": "node tools/v2-readiness/src/index.mjs --strict",
    },
    testInventory: [{ path: "t.test.ts", kind: "unit" }],
    testMap: [
      {
        v1Path: "t.test.ts",
        v2Path: "t.test.ts",
        migrationType: "carry",
        retirementJustification: null,
      },
    ],
    listTestFiles: () => ["t.test.ts"],
    fileExists: () => true,
    capabilities: [
      {
        capability: "C1",
        status: "delivered-and-proven",
        route: "/admin/x",
        contract: "/api/x",
        permission: "p",
        readinessCheck: "invariant-ready",
        proof: "proof:x",
        openAction: null,
      },
    ],
    decisions: [{ v2AdrId: "V2-ADR-1", status: "Accepted" }],
    decisionLineage: [{ v2AdrId: "V2-ADR-1", v1Adrs: ["ADR-0001"], v1Actions: [] }],
    adrIds: new Set(["0001"]),
    actionMentions: new Set(["ADR-ACT-0288"]),
    actionRegister: {},
    directoryContracts: [
      {
        path: "apps/platform-api",
        allowedContents: [],
        forbiddenContents: [],
        dependencyDirection: "x",
      },
      { path: "apps/web", allowedContents: [], forbiddenContents: [], dependencyDirection: "x" },
    ],
    foundation: {
      "service-and-clickthrough-matrix.json": [{ ok: 1 }],
      "authentication-authorisation-matrix.json": [{ ok: 1 }],
      "environment-and-config-catalog.json": [{ ok: 1 }],
      "data-and-migration-plan.json": [{ ok: 1 }],
      "v1-knowledge-ledger.json": [
        { topic: "x", acceptedResolution: "x", originatingCommits: ["abc"], v2TargetDecision: "x" },
      ],
      "v2-directory-contracts.json": [{ ok: 1 }],
      "ui-definition.schema.json": { required: ["capabilityId"] },
      "ui-component-contracts.json": [{ ok: 1 }],
      "ui-capability-model.json": { capabilities: [{ capabilityId: "x" }] },
    },
    reconciliation: {
      verdict: "NOT-ZERO-GAPS — honest",
      files: { buckets: { "reuse-unchanged": 1, "delete-after-proof": 1 } },
      commands: { buckets: { carry: 3 } },
      tests: { buckets: { carry: 1 } },
      capabilities: { buckets: { "delivered-and-proven": 1 } },
      semanticGapsRemaining: { count: 0, openDecisions: [] },
    },
    targetTree: "react-v2/\n├── apps/\n│   ├── platform-api/\n│   └── web/\n└── packages/\n",
    gapReport: "# Gap report\nVerdict: honest — not zero gaps where work remains.\n",
    programme: "# Programme\nwork {{PINNED_V1_COMMIT}}.\n",
    runbook: `runbook depends on tools/v2-readiness; audited ${AUDITED_V1_COMMIT}.`,
    toolIndexExists: true,
    packageStatuses: [], // all deprecated packages removed + evidence valid
  };
}

export const clone = (ctx) => {
  // structuredClone preserves Set; functions can't be cloned, so carry them across by reference.
  const { listTestFiles, fileExists, ...rest } = ctx;
  const c = structuredClone(rest);
  c.listTestFiles = listTestFiles;
  c.fileExists = fileExists;
  return c;
};
