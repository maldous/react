import { AUDITED_V1_COMMIT, finding } from "../vocab.mjs";

// The runbook depends on tools/v2-readiness — it must be implemented and scripted, and its pinned
// audited commit must be resolved.
export default function r8Runbook(ctx) {
  const out = [];
  const dependsOnTool = ctx.runbook.includes("tools/v2-readiness");
  if (dependsOnTool) {
    if (!ctx.toolIndexExists)
      out.push(
        finding(
          "R8-runbook-tooling",
          "tools/v2-readiness/src/index.mjs",
          "runbook depends on the validator but src/index.mjs is absent"
        )
      );
    if (!ctx.packageJsonScripts["v2:readiness"])
      out.push(
        finding(
          "R8-runbook-tooling",
          "package.json#scripts",
          'runbook depends on the validator but the "v2:readiness" npm script is missing'
        )
      );
  }
  if (ctx.runbook && !ctx.runbook.includes(AUDITED_V1_COMMIT))
    out.push(
      finding(
        "R8-runbook-tooling",
        "v2-branch-cut-runbook.md",
        "runbook does not record the resolved audited V1 commit"
      )
    );
  return out;
}
