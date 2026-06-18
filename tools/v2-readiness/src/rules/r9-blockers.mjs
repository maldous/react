import { DEPRECATED_REMOVE_PACKAGES, finding } from "../vocab.mjs";
import { collectImportMap, packageRemovalStatus } from "../package-status.mjs";

// Live package-removal status for the 10 deprecated packages. Determined from the CURRENT repo +
// committed removal evidence — NOT from path-map membership (which is permanent historical lineage).
// Tests/clean fixtures may inject ctx.packageStatuses to bypass the FS walk.
function packageStatuses(ctx) {
  if (Array.isArray(ctx.packageStatuses)) return ctx.packageStatuses;
  const importMap = collectImportMap(ctx.repoRoot);
  return DEPRECATED_REMOVE_PACKAGES.map((pkg) =>
    packageRemovalStatus(ctx.repoRoot, pkg, { importMap })
  );
}

// Fail-closed cut gate: while any branch-cut blocker remains, the validator is RED, so
// `v2:readiness` exiting 0 truly means "ready to cut / ready to claim zero gaps". These are NOT
// honesty violations (the artefacts record them correctly) — they are outstanding work.
export default function r9Blockers(ctx) {
  const out = [];
  for (const c of ctx.capabilities) {
    if (c.status === "requires-v1-completion")
      out.push(
        finding(
          "R9-branch-cut-blocker",
          c.capability,
          `requires V1 completion (${c.completionAction || "no action"}) before the cut`
        )
      );
  }
  for (const s of packageStatuses(ctx)) {
    if (s.blocker)
      out.push(
        finding(
          "R9-branch-cut-blocker",
          `packages/${s.pkg}`,
          `deprecated package not yet removed (${(s.reasons || []).join(", ") || "present"})`
        )
      );
  }
  const open = ctx.reconciliation?.semanticGapsRemaining?.openDecisions || [];
  for (const d of open)
    out.push(
      finding(
        "R9-branch-cut-blocker",
        d.subject || "open-decision",
        `open decision: ${d.action || ""}`
      )
    );
  return out;
}
