#!/usr/bin/env node
import { loadContext } from "./load.mjs";
import r1 from "./rules/r1-placeholder.mjs";
import r2 from "./rules/r2-capability.mjs";
import r3 from "./rules/r3-zero-gap.mjs";
import r4 from "./rules/r4-vocabulary.mjs";
import r5 from "./rules/r5-count-buckets.mjs";
import r6 from "./rules/r6-package-removal.mjs";
import r7 from "./rules/r7-soft-mapping.mjs";
import r8 from "./rules/r8-runbook.mjs";
import r9 from "./rules/r9-blockers.mjs";
import r10 from "./rules/r10-file-coverage.mjs";
import r11 from "./rules/r11-command-coverage.mjs";
import r12 from "./rules/r12-test-coverage.mjs";
import r13 from "./rules/r13-decision-governance.mjs";
import r14 from "./rules/r14-foundation.mjs";
import r15 from "./rules/r15-app-path.mjs";

import r16 from "./rules/r16-services.mjs";
import r17 from "./rules/r17-migrations.mjs";
import r18 from "./rules/r18-environment-config.mjs";
import r19 from "./rules/r19-executable-assets.mjs";
import r20 from "./rules/r20-harness-semantics.mjs";
import r21 from "./rules/r21-v1c17-observability.mjs";
import r22 from "./rules/r22-semantic-completeness.mjs";
import r23 from "./rules/r23-proof-classification.mjs";
import r24 from "./rules/r24-environment-semantics.mjs";
import r25 from "./rules/r25-cross-capability-semantics.mjs";
import r26 from "./rules/r26-event-semantics.mjs";
import r27 from "./rules/r27-operational-semantics.mjs";
import r28 from "./rules/r28-semantic-source-transition.mjs";
import r29 from "./rules/r29-environment-readiness-gates.mjs";
import r30 from "./rules/r30-graph-integrity.mjs";
import r31 from "./rules/r31-state-machine-soundness.mjs";
import r32 from "./rules/r32-traceability-closure.mjs";
import r33 from "./rules/r33-environment-completeness.mjs";
import r34 from "./rules/r34-constraint-satisfaction.mjs";
import r35 from "./rules/r35-semantic-closure.mjs";
import r36 from "./rules/r36-regeneration-sufficiency.mjs";
import r37 from "./rules/r37-semantic-entropy.mjs";
import r40 from "./rules/r40-operational-assurance.mjs";
import r41 from "./rules/r41-observability-assurance.mjs";
import r42 from "./rules/r42-security-assurance.mjs";
import r43 from "./rules/r43-audit-assurance.mjs";
import r44 from "./rules/r44-event-assurance.mjs";
import r45 from "./rules/r45-environment-assurance.mjs";
import r46 from "./rules/r46-data-assurance.mjs";
import r47 from "./rules/r47-dependency-assurance.mjs";
import r48 from "./rules/r48-reliability-assurance.mjs";
import r49 from "./rules/r49-capability-coverage.mjs";
import r50 from "./rules/r50-runtime-alignment.mjs";
import r51 from "./rules/r51-route-observability-assurance.mjs";
import r52 from "./rules/r52-route-security-assurance.mjs";
import r53 from "./rules/r53-ownership-assurance.mjs";
import r54 from "./rules/r54-proof-behaviour-assurance.mjs";
import r55 from "./rules/r55-storage-assurance.mjs";
import r56 from "./rules/r56-workflow-assurance.mjs";
import r57 from "./rules/r57-event-runtime-assurance.mjs";
import r58 from "./rules/r58-metrics-alerts-assurance.mjs";
import r59 from "./rules/r59-data-governance-runtime-assurance.mjs";
import r60 from "./rules/r60-provider-reliability-runtime-assurance.mjs";
import r61 from "./rules/r61-semantic-orphan-runtime-assurance.mjs";
import r62 from "./rules/r62-formal-proof-evidence-assurance.mjs";

export const RULES = [
  r1,
  r2,
  r3,
  r4,
  r5,
  r6,
  r7,
  r8,
  r9,
  r10,
  r11,
  r12,
  r13,
  r14,
  r15,
  r16,
  r17,
  r18,
  r19,
  r20,
  r21,
  r22,
  r23,
  r24,
  r25,
  r26,
  r27,
  r28,
  r29,
  r30,
  r31,
  r32,
  r33,
  r34,
  r35,
  r36,
  r37,
  r40,
  r41,
  r42,
  r43,
  r44,
  r45,
  r46,
  r47,
  r48,
  r49,
  r50,
  r51,
  r52,
  r53,
  r54,
  r55,
  r56,
  r57,
  r58,
  r59,
  r60,
  r61,
  r62,
];

export function runRules(ctx) {
  return RULES.flatMap((rule) => rule(ctx));
}

// Separate CONSISTENCY findings (artefacts not self-consistent — must be 0) from COMPLETION BLOCKERS
// (R9 — real outstanding V1 work). cutReady only when both are zero.
// Audit surfaces the validator independently reconciles. Each maps to an implemented rule; any
// surface without a live rule is reported as unexamined (must be 0 before the closure is exhaustive).
const AUDIT_SURFACES = {
  "file-coverage": "R10",
  commands: "R11",
  "tests-proofs": "R12",
  "decisions-governance": "R13",
  "foundation-artefacts": "R14",
  "app-roots": "R15",
  "services-clickthrough-sso": "R16",
  "migrations-data": "R17",
  "environment-config": "R18",
  "executables-terraform-playwright": "R19",
  "ui-semantic-harness": "R20",
  "capability-semantic-completeness": "R22",
  "proof-strength-classification": "R23",
  "environment-semantics": "R24",
  "cross-capability-semantics": "R25",
  "event-semantics": "R26",
  "operational-semantics": "R27",
  "semantic-source-transition": "R28",
  "environment-readiness-gates": "R29",
  "graph-integrity": "R30",
  "state-machine-soundness": "R31",
  "traceability-closure": "R32",
  "environment-completeness": "R33",
  "constraint-satisfaction": "R34",
  "semantic-closure": "R35",
  "regeneration-sufficiency": "R36",
  "semantic-entropy": "R37",
  "operational-assurance": "R40",
  "observability-assurance": "R41",
  "security-assurance": "R42",
  "audit-assurance": "R43",
  "event-assurance": "R44",
  "environment-assurance": "R45",
  "data-assurance": "R46",
  "dependency-assurance": "R47",
  "reliability-assurance": "R48",
  "capability-coverage": "R49",
  "runtime-alignment": "R50",
  "route-observability-assurance": "R51",
  "route-security-assurance": "R52",
  "ownership-assurance": "R53",
  "proof-behaviour-assurance": "R54",
  "storage-assurance": "R55",
  "workflow-assurance": "R56",
  "event-runtime-assurance": "R57",
  "metrics-alerts-assurance": "R58",
  "data-governance-runtime-assurance": "R59",
  "provider-reliability-runtime-assurance": "R60",
  "semantic-orphan-runtime-assurance": "R61",
  "formal-proof-evidence-assurance": "R62",
};
// Surface rules wired into RULES. Keep in sync with the imports above.
const IMPLEMENTED_SURFACE_RULES = [
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R22",
  "R23",
  "R24",
  "R25",
  "R26",
  "R27",
  "R28",
  "R29",
  "R30",
  "R31",
  "R32",
  "R33",
  "R34",
  "R35",
  "R36",
  "R37",
  "R40",
  "R41",
  "R42",
  "R43",
  "R44",
  "R45",
  "R46",
  "R47",
  "R48",
  "R49",
  "R50",
  "R51",
  "R52",
  "R53",
  "R54",
  "R55",
  "R56",
  "R57",
  "R58",
  "R59",
  "R60",
  "R61",
  "R62",
];

export function summarize(
  findings,
  strict = true,
  implementedRuleNumbers = IMPLEMENTED_SURFACE_RULES
) {
  const blockerFindings = findings.filter((f) => f.ruleId === "R9-branch-cut-blocker");
  const consistency = findings.filter(
    (f) => f.ruleId !== "R9-branch-cut-blocker" && (f.severity === "error" || strict)
  );
  const ruleSet = new Set(implementedRuleNumbers);
  const unexamined = Object.entries(AUDIT_SURFACES)
    .filter(([, ruleNum]) => !ruleSet.has(ruleNum))
    .map(([surface]) => surface);
  return {
    consistencyFindings: consistency.length,
    completionBlockers: blockerFindings.map((f) => f.subject),
    completionBlockerCount: blockerFindings.length,
    unexaminedAuditSurfaces: unexamined,
    cutReady: consistency.length === 0 && blockerFindings.length === 0 && unexamined.length === 0,
    ok: consistency.length === 0 && blockerFindings.length === 0,
  };
}

function parseArgs(argv) {
  const a = {
    strict: false,
    json: false,
    repo: process.cwd(),
    pinned: undefined,
    historical: false,
    requireClean: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--strict") a.strict = true;
    else if (v === "--json") a.json = true;
    else if (v === "--historical") a.historical = true;
    else if (v === "--require-clean") a.requireClean = true;
    else if (v === "--repo") a.repo = argv[++i];
    else if (v === "--pinned") a.pinned = argv[++i];
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let ctx;
  try {
    ctx = loadContext({ repoRoot: args.repo, strict: args.strict, pinned: args.pinned });
    ctx.historical = args.historical;
    ctx.requireClean = args.requireClean;
  } catch (err) {
    console.error(`v2-readiness: cannot load artefacts: ${err.message}`);
    process.exit(2);
  }
  const findings = runRules(ctx);
  const s = summarize(findings, args.strict);
  const report = {
    auditBaseCommit: ctx.auditBaseCommit,
    cutCandidateCommit: ctx.cutCandidateCommit,
    pinnedV1Commit: ctx.pinnedV1Commit,
    ranAt: new Date().toISOString(),
    totalRules: RULES.length,
    findings,
    // canonical report terminology (§4/§6): consistency findings vs completion blockers vs cut readiness
    consistencyFindings: s.consistencyFindings,
    completionBlockers: s.completionBlockers,
    completionBlockerCount: s.completionBlockerCount,
    unexaminedAuditSurfaces: s.unexaminedAuditSurfaces,
    cutReady: s.cutReady,
    ok: s.ok,
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const byRule = {};
    for (const f of findings) (byRule[f.ruleId] ||= []).push(f);
    for (const [rule, fs] of Object.entries(byRule)) {
      console.log(`\n${rule} — ${fs.length} finding(s):`);
      for (const f of fs) console.log(`  [${f.severity}] ${f.subject}: ${f.message}`);
    }
    console.log(
      `\nconsistencyFindings=${s.consistencyFindings}  completionBlockerCount=${s.completionBlockerCount}  unexaminedAuditSurfaces=${s.unexaminedAuditSurfaces.length}  cutReady=${s.cutReady}`
    );
    console.log(
      s.cutReady
        ? "v2-readiness: GREEN — consistent AND no completion blockers; the cut may proceed."
        : s.consistencyFindings === 0
          ? "v2-readiness: RED — consistent, but completion blockers remain; cut BLOCKED."
          : "v2-readiness: RED — consistency findings present; artefacts are not self-consistent."
    );
  }
  process.exit(report.ok ? 0 : 1);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
