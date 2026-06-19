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

export const RULES = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15];

export function runRules(ctx) {
  return RULES.flatMap((rule) => rule(ctx));
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
  const errors = findings.filter((f) => f.severity === "error" || args.strict);
  const report = {
    auditBaseCommit: ctx.auditBaseCommit,
    cutCandidateCommit: ctx.cutCandidateCommit,
    pinnedV1Commit: ctx.pinnedV1Commit,
    ranAt: new Date().toISOString(),
    totalRules: RULES.length,
    findings,
    ok: errors.length === 0,
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
      report.ok
        ? "\nv2-readiness: GREEN — semantic closure is total and self-consistent."
        : `\nv2-readiness: RED — ${findings.length} finding(s); the V2 branch cut is BLOCKED.`
    );
  }
  process.exit(report.ok ? 0 : 1);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
