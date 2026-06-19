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

export const RULES = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17];

export function runRules(ctx) {
  return RULES.flatMap((rule) => rule(ctx));
}

// Separate CONSISTENCY findings (artefacts not self-consistent — must be 0) from COMPLETION BLOCKERS
// (R9 — real outstanding V1 work). cutReady only when both are zero.
export function summarize(findings, strict = true) {
  const blockers = findings.filter((f) => f.ruleId === "R9-branch-cut-blocker");
  const consistency = findings.filter(
    (f) => f.ruleId !== "R9-branch-cut-blocker" && (f.severity === "error" || strict)
  );
  return {
    consistencyFindings: consistency.length,
    completionBlockers: blockers.length,
    cutReady: consistency.length === 0 && blockers.length === 0,
    ok: consistency.length === 0 && blockers.length === 0,
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
    // canonical report terminology (§6): consistency findings vs completion blockers vs cut readiness
    consistencyFindings: s.consistencyFindings,
    completionBlockers: s.completionBlockers,
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
      `\nconsistencyFindings=${s.consistencyFindings}  completionBlockers=${s.completionBlockers}  cutReady=${s.cutReady}`
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
