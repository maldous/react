import { finding } from "../vocab.mjs";

const isPackageFile = (p) => /^packages\/[^/]+\//.test(p) && !p.endsWith("/.gitkeep");

// Metadata/README/package files may not be cleared as "no runtime behaviour" without an explicit
// final decision: a delete-after-proof needs a real deletionCondition, and package files need decisionRefs.
export default function r7SoftMapping(ctx) {
  const out = [];
  for (const e of ctx.pathMap) {
    if (e.disposition !== "delete-after-proof") continue;
    const cond = (e.deletionCondition || "").trim().toLowerCase();
    if (!cond || cond === "n/a")
      out.push(
        finding("R7-soft-mapping", e.v1Path, "delete-after-proof without a real deletionCondition")
      );
    if (isPackageFile(e.v1Path) && (!Array.isArray(e.decisionRefs) || e.decisionRefs.length === 0))
      out.push(
        finding(
          "R7-soft-mapping",
          e.v1Path,
          "delete-after-proof package file cleared without decisionRefs (final decision reference)"
        )
      );
  }
  return out;
}
