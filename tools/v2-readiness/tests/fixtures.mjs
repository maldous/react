import { AUDITED_V1_COMMIT } from "../src/vocab.mjs";

// A minimal context that passes ALL rules. Tests clone + mutate it to trigger one rule.
export function cleanCtx() {
  return {
    repoRoot: "/fixture",
    strict: true,
    pinnedV1Commit: AUDITED_V1_COMMIT,
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
    commandMap: [{ v1Name: "x", v2Name: "x", disposition: "carry" }],
    testMap: [{ v1Path: "t.ts", migrationType: "carry" }],
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
    reconciliation: {
      verdict: "NOT-ZERO-GAPS — honest",
      files: { buckets: { "reuse-unchanged": 1, "delete-after-proof": 1 } },
      commands: { buckets: { carry: 1 } },
      tests: { buckets: { carry: 1 } },
      capabilities: { buckets: { "delivered-and-proven": 1 } },
      semanticGapsRemaining: { count: 0, openDecisions: [] },
    },
    targetTree: "packages/\n  domain/\n    identity/\n",
    gapReport: "# Gap report\nVerdict: honest — not zero gaps where work remains.\n",
    programme: "# Programme\nwork.\n",
    runbook: `runbook depends on tools/v2-readiness; audited ${AUDITED_V1_COMMIT}.`,
    packageJsonScripts: { "v2:readiness": "node tools/v2-readiness/src/index.mjs --strict" },
    toolIndexExists: true,
  };
}

export const clone = (ctx) => JSON.parse(JSON.stringify(ctx));
