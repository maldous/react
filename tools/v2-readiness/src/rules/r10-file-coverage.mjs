import { finding } from "../vocab.mjs";

const pathOf = (e) => e.v1Path ?? e.path;
const diff = (a, b) => [...a].filter((x) => !b.has(x));

// Independent file bijection: git ls-tree(audited) == inventory == shards == path-map. Never trust
// declared counts alone.
export default function r10FileCoverage(ctx) {
  const out = [];
  const pm = new Set(ctx.pathMap.map(pathOf));
  const inv = new Set(ctx.fileInventory.map(pathOf));
  const shards = new Set(ctx.shards.map(pathOf));

  if (inv.size !== ctx.fileInventory.length)
    out.push(finding("R10-file-coverage", "v1-file-inventory.json", "duplicate path entries"));
  if (pm.size !== ctx.pathMap.length)
    out.push(finding("R10-file-coverage", "v1-to-v2-path-map.json", "duplicate v1Path entries"));

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
      out.push(finding("R10-file-coverage", p, `tracked at audited commit but unmapped`));
    for (const p of diff(pm, git))
      out.push(finding("R10-file-coverage", p, `mapped v1Path absent from the audited commit`));
  } else {
    out.push(
      finding(
        "R10-file-coverage",
        "git",
        "could not list the audited commit; file bijection not independently verified",
        "warning"
      )
    );
  }
  return out;
}
