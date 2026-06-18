import { DEPRECATED_REMOVE_PACKAGES, FORBIDDEN_TREE_MARKERS, finding } from "../vocab.mjs";

const pkgOf = (p) => {
  const m = /^packages\/([^/]+)\//.exec(p || "");
  return m ? m[1] : null;
};

export default function r6PackageRemoval(ctx) {
  const out = [];
  // delete-after-proof must have no V2 home
  for (const e of ctx.pathMap) {
    if (e.disposition === "delete-after-proof" && e.v2Path !== null)
      out.push(
        finding(
          "R6-package-removal",
          e.v1Path,
          `delete-after-proof must carry v2Path:null, found "${e.v2Path}"`
        )
      );
  }
  // every file of a to-remove deprecated package must be delete-after-proof
  for (const e of ctx.pathMap) {
    const pkg = pkgOf(e.v1Path);
    if (pkg && DEPRECATED_REMOVE_PACKAGES.includes(pkg) && e.disposition !== "delete-after-proof")
      out.push(
        finding(
          "R6-package-removal",
          e.v1Path,
          `deprecated package "${pkg}" file has disposition "${e.disposition}" — must be delete-after-proof or carry a final keep decision`
        )
      );
  }
  // no kept-as-canonical home for a removed package survives in the tree
  for (const marker of FORBIDDEN_TREE_MARKERS) {
    if (ctx.targetTree.includes(marker))
      out.push(
        finding(
          "R6-package-removal",
          "v2-target-tree.txt",
          `removed package home still present in tree: "${marker}"`
        )
      );
  }
  return out;
}
