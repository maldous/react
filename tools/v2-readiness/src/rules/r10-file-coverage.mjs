import { finding } from "../vocab.mjs";

const pathOf = (e) => e.v1Path ?? e.path;
const diff = (a, b) => [...a].filter((x) => !b.has(x));
const ADD_FIELDS = [
  "path",
  "introducingCommit",
  "purpose",
  "v2Disposition",
  "v2Target",
  "protectingTests",
  "decisionRefs",
];
const DEL_FIELDS = [
  "originalPath",
  "removalCommit",
  "deletionDecision",
  "replacementOrNa",
  "evidence",
];

// Independent file coverage against BOTH the audit-base commit (historical lineage) and the
// cut-candidate tree (what the cut actually freezes). Post-audit files must be recorded in the
// path-map or the post-audit delta — nothing escapes the V2 mapping.
export default function r10FileCoverage(ctx) {
  const out = [];
  const pm = new Set(ctx.pathMap.map(pathOf));
  const inv = new Set(ctx.fileInventory.map(pathOf));
  const shards = new Set(ctx.shards.map(pathOf));

  if (inv.size !== ctx.fileInventory.length)
    out.push(finding("R10-file-coverage", "v1-file-inventory.json", "duplicate path entries"));
  if (pm.size !== ctx.pathMap.length)
    out.push(finding("R10-file-coverage", "v1-to-v2-path-map.json", "duplicate v1Path entries"));

  // --- audit-base bijection: inventory == shards == path-map (== git@auditBase) ---
  for (const p of diff(inv, pm))
    out.push(finding("R10-file-coverage", p, "in file-inventory but not in path-map"));
  for (const p of diff(pm, inv))
    out.push(finding("R10-file-coverage", p, "in path-map but not in file-inventory"));
  for (const p of diff(shards, inv))
    out.push(finding("R10-file-coverage", p, "in inventory shards but not in file-inventory"));
  for (const p of diff(inv, shards))
    out.push(finding("R10-file-coverage", p, "in file-inventory but not in inventory shards"));
  if (ctx.gitTracked?.ok) {
    const git = new Set(ctx.gitTracked.files);
    for (const p of diff(git, pm))
      out.push(finding("R10-file-coverage", p, "tracked at audit-base commit but unmapped"));
    for (const p of diff(pm, git))
      out.push(finding("R10-file-coverage", p, "mapped v1Path absent from the audit-base commit"));
  } else {
    out.push(
      finding(
        "R10-file-coverage",
        "git",
        "could not list the audit-base commit; lineage not independently verified",
        "warning"
      )
    );
  }

  // --- candidate equation: candidate == path-map(surviving) + delta.additions - delta.deletions ---
  const delta = ctx.postAuditDelta;
  if (!delta) {
    out.push(
      finding("R10-file-coverage", "v1-post-audit-delta.json", "missing post-audit delta artefact")
    );
  } else {
    for (const a of delta.additions || [])
      for (const f of ADD_FIELDS)
        if (!(f in a))
          out.push(
            finding("R10-file-coverage", a.path || "<add>", `delta addition missing "${f}"`)
          );
    for (const d of delta.deletions || [])
      for (const f of DEL_FIELDS)
        if (!(f in d))
          out.push(
            finding("R10-file-coverage", d.originalPath || "<del>", `delta deletion missing "${f}"`)
          );

    if (ctx.candidateTracked?.ok) {
      const cand = new Set(ctx.candidateTracked.files);
      const additions = new Set((delta.additions || []).map((a) => a.path));
      const deletions = new Set((delta.deletions || []).map((d) => d.originalPath));
      const expected = new Set([...pm, ...additions].filter((p) => !deletions.has(p)));
      for (const p of diff(cand, expected))
        out.push(
          finding(
            "R10-file-coverage",
            p,
            "post-audit file at cut-candidate is neither path-mapped nor recorded in v1-post-audit-delta.json"
          )
        );
      for (const p of diff(expected, cand)) {
        if (additions.has(p))
          out.push(
            finding("R10-file-coverage", p, "delta addition not present at the cut-candidate tree")
          );
        else
          out.push(
            finding(
              "R10-file-coverage",
              p,
              "mapped file absent at cut-candidate without an evidence-backed deletion"
            )
          );
      }
    } else {
      out.push(
        finding(
          "R10-file-coverage",
          "git",
          "could not list the cut-candidate tree; candidate coverage not verified",
          "warning"
        )
      );
    }
  }

  // --- cut-candidate commit sanity (§1) ---
  if (ctx.strict && !ctx.candidateResolves)
    out.push(
      finding(
        "R10-file-coverage",
        "cutCandidateCommit",
        `candidate commit does not resolve: ${ctx.cutCandidateCommit}`
      )
    );
  if (ctx.strict && !ctx.historical && ctx.headCommit && ctx.cutCandidateCommit !== ctx.headCommit)
    out.push(
      finding(
        "R10-file-coverage",
        "cutCandidateCommit",
        `under --strict the candidate must equal HEAD (${ctx.headCommit}); got ${ctx.cutCandidateCommit}. Use --historical to validate a non-HEAD snapshot.`
      )
    );
  if (ctx.requireClean && !ctx.treeClean)
    out.push(
      finding(
        "R10-file-coverage",
        "worktree",
        "cut requires a clean working tree (uncommitted changes present)"
      )
    );
  return out;
}
