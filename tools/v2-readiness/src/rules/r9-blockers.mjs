import { DEPRECATED_REMOVE_PACKAGES, finding } from "../vocab.mjs";

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
  // any deprecated package still present on the V1 tree is a pending delete-after-proof execution
  const removedPkgsWithEntries = new Set(
    ctx.pathMap
      .map((e) => /^packages\/([^/]+)\//.exec(e.v1Path || "")?.[1])
      .filter((p) => DEPRECATED_REMOVE_PACKAGES.includes(p))
  );
  for (const pkg of removedPkgsWithEntries)
    out.push(
      finding(
        "R9-branch-cut-blocker",
        `packages/${pkg}`,
        "deprecated zero-consumer package pending delete-after-proof execution"
      )
    );
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
