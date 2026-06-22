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
        category: "fixture",
        status: "delivered-and-proven",
        route: "/admin/x",
        contract: "/api/x",
        permission: "p",
        readinessCheck: "invariant-ready",
        proof: "proof:x",
        openAction: null,
        v2Target: "reuse-as-is",
        semanticCompleteness: {
          status: "complete",
          lifecycle: "fixture lifecycle",
          stateModel: "fixture state model",
          permissions: "fixture permissions",
          contracts: "fixture contracts",
          validation: "fixture validation",
          errorModel: "fixture error model",
          auditModel: "fixture audit model",
          readinessModel: "fixture readiness model",
          proof: "fixture proof. Proof level: 3 state-machine validation.",
          uiSemanticDefinition: "fixture UI semantics",
        },
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
    compose: {
      ok: true,
      services: [{ name: "postgres", profiles: [], image: "postgres", ports: [] }],
      profiles: [],
      volumes: ["postgres-data"],
    },
    caddyfile: "",
    migrations: [{ file: "001-x.sql", checksum: "abc0000000000000" }],
    observabilityV1C17: {
      files: 3,
      promRefs: 1,
      lokiRefs: 1,
      tempoRefs: 1,
      proofScripts: { metricsPrometheusExists: true, dashboardsExists: true },
    },
    configConsumption: {
      keys: [
        {
          key: "APP_BASE_URL",
          consumerCount: 1,
          sources: ["apps/platform-api/src/config/index.ts"],
          secret: false,
          testFixtureOnly: false,
          authoritativeSource: "manifest",
          generatedProjection: true,
          v2Disposition: "carry",
          directAccessOutsideComposition: 0,
        },
      ],
    },
    executableAssets: {
      shellScripts: [],
      nodeScripts: [],
      terraformRoots: [],
      terraformModules: [],
      playwrightSpecs: [],
      playwrightConfigs: [],
    },
    envManifests: { common: {}, dev: {}, test: {}, staging: {}, prod: {} },
    foundation: {
      "service-and-clickthrough-matrix.json": [
        {
          id: "postgres",
          classification: "built-in",
          caddyRoute: null,
          clickthroughUrl: null,
          permission: null,
          forwardAuthResource: "n/a",
          ssoMechanism: "n/a",
          readiness: "postgres probe",
          productionExposure: "internal",
          directLoginPolicy: "n/a (no UI)",
          tenantData: true,
          backupRestore: "pg_dump/pg_restore",
        },
      ],
      "authentication-authorisation-matrix.json": [{ ok: 1 }],
      "environment-and-config-catalog.json": [
        {
          key: "database-urls",
          consumer: "platform-api",
          secret: true,
          sourceOfTruth: "manifest",
          v2Location: "runtime/config",
        },
      ],
      "data-and-migration-plan.json": {
        postgres: {
          migrationChain: [{ file: "001-x.sql", intent: "core" }],
          schemaMigrationsTable: "schema_migrations",
        },
        v2FreshInstallBaseline: "fresh",
        backupRestore: { postgres: "pg_dump" },
      },
      "v1-knowledge-ledger.json": [
        { topic: "x", acceptedResolution: "x", originatingCommits: ["abc"], v2TargetDecision: "x" },
      ],
      "v2-directory-contracts.json": [{ ok: 1 }],
      "ui-definition.schema.json": { required: ["capabilityId"] },
      "ui-component-contracts.json": [{ ok: 1 }],
      "ui-capability-model.json": { capabilities: [{ capabilityId: "x" }] },
      "capability-definition.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "capability-state-machine.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "capability-permissions.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "capability-errors.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "capability-ui-contract.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "capability-proof-definition.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
      },
      "environment-capability-matrix.json": {
        mandatoryFoundationAsset: true,
        coverage: { statuses: ["delivered-and-proven"] },
        capabilities: [
          {
            capability: "C1",
            dev: {
              provider: "local",
              requiredProofs: ["proof:x"],
              promotionGate: "dev proofs pass",
            },
            test: {
              provider: "compose",
              requiredProofs: ["proof:x"],
              paidLiveOnlyProvider: false,
              liveProvidersRequired: false,
              promotionGate: "test proofs pass",
            },
            staging: {
              provider: "prod-like",
              requiredProofs: ["proof:x"],
              prodLikeProof: true,
              promotionGate: "staging proofs pass",
            },
            prod: {
              provider: "live",
              mocksAllowed: false,
              requiredProofs: ["current health"],
              destructiveProofsForbidden: true,
              destructiveProofProdSafe: false,
              smokeReadinessChecksAllowed: true,
              promotionGate: "prod health pass",
            },
          },
        ],
      },
      "cross-capability-interactions.json": {
        mandatoryFoundationAsset: true,
        interactions: [
          "entitlements-billing",
          "billing-workflow",
          "workflow-notifications",
          "storage-governance",
          "governance-tenant-lifecycle",
          "audit-privileged-access",
          "catalog-provider-readiness",
          "events-workers-dlq",
        ].map((id) => ({
          id,
          producerCapability: "C1",
          consumerCapability: "C1",
          sharedContract: "contract",
          ownershipBoundary: "boundary",
          failureBehaviour: "fail closed",
          orderingRequirement: "producer before consumer",
          retryIdempotencyBehaviour: "idempotent retry",
          proofReference: "proof:x",
        })),
      },
      "event-semantics.json": {
        mandatoryFoundationAsset: true,
        events: [
          {
            eventName: "thing.created",
            owner: "events",
            producer: "C1",
            consumers: ["worker"],
            schema: { version: 1 },
            version: 1,
            idempotencyKey: "org+event+key",
            orderingExpectation: "per tenant",
            retryPolicy: "retry then DLQ",
            dlqPolicy: "dead letter and redrive",
            retention: "policy",
            auditRelationship: "redrive audited",
            mutatingEvent: true,
            proof: "proof:x",
          },
        ],
      },
      "operational-semantics.json": {
        mandatoryFoundationAsset: true,
        capabilities: [
          {
            capability: "C1",
            deployBehaviour: "deploy",
            migrationBehaviour: "migration",
            rollbackBehaviour: "rollback",
            backupRestoreRelationship: "backup",
            partialFailureBehaviour: "partial failure",
            degradedMode: "degraded",
            recoveryAction: "recover",
            observabilitySignals: ["signal"],
            alertConditions: ["alert"],
          },
        ],
      },
      "semantic-source-of-truth-transition.json": {
        mandatoryFoundationAsset: true,
        policies: {
          v1Final: "V1-final is historical evidence",
          v2SourceOfTruth: "V2 semantic contracts are source of truth",
          driftPolicy: "V2 code must not drift from semantic artefacts",
          changePolicy: "semantic artefacts change in the same change",
          v1ReopenPolicy: "V1 reopens only for evidence correction",
        },
      },
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
